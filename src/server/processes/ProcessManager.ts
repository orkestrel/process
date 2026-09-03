import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	ProcessExit,
	ProcessInterface,
	ProcessManagerEventMap,
	ProcessManagerInterface,
	ProcessManagerOptions,
	ProcessOptions,
} from '@src/core'
import { Emitter } from '@orkestrel/emitter'
import { createDuplicateError, createProtocolError } from '@src/core'
import { Process } from './Process.js'

/**
 * Represents a keyed registry of live supervised child processes.
 *
 * @remarks
 * A child launched under an id joins the registry and emits `launch`; when it settles it removes
 * itself and emits `exit`, so `count` and `processes` reflect only live children. The id is reserved
 * before the child is constructed and released when construction throws, so a refused launch never
 * strands its key. Eviction follows the child's own `exit` promise, which no listener can forge, so
 * it lands one microtask after the child's public `exit` event: a listener on that event still sees
 * the child registered. `launch` throws a {@link createDuplicateError} when the id is already live
 * and a {@link createProtocolError} after `destroy` has begun, including when the caller's own option
 * getter begins that teardown mid-construction — a spawn fault surfaces through the returned child's
 * `exit`, never from `launch`. `destroy` awaits every child's own teardown, including the teardown
 * of a child a lost race refused, which destroys each child's observation emitter and leaves every
 * subscription on it silently inert, then destroys the registry emitter last.
 *
 * @example
 * ```ts
 * import { ProcessManager } from '@orkestrel/process/server'
 *
 * const manager = new ProcessManager()
 * const child = manager.launch('build', {
 * 	command: { file: 'node', arguments: ['build.js'] },
 * 	workspace: process.cwd(),
 * })
 * await child.exit
 * await manager.destroy()
 * ```
 */
export class ProcessManager implements ProcessManagerInterface {
	readonly #emitter: Emitter<ProcessManagerEventMap>
	readonly #children = new Map<string, ProcessInterface>()
	readonly #ids = new Set<string>()
	// The children a launch spawned into a registry that was already being destroyed. They are never
	// registered, so `#teardown` cannot reach them through `#children`, and it drains this set instead.
	readonly #orphans = new Set<ProcessInterface>()
	// A guard reads `#destroying`, never `#ending !== undefined`. `destroy` assigns the boolean before
	// it assigns the barrier, so the boolean also covers the synchronous prefix of the teardown, which
	// runs while `#ending` is still `undefined`.
	#destroying = false
	#ending: Promise<void> | undefined

	/**
	 * Constructs a process registry.
	 *
	 * @param options - Initial fleet-level observation hooks and listener-error handling
	 */
	constructor(options?: ProcessManagerOptions) {
		const on = options?.on
		const error = options?.error
		this.#emitter = new Emitter<ProcessManagerEventMap>({
			...(on === undefined ? {} : { on }),
			...(error === undefined ? {} : { error }),
		})
	}

	/** Holds the typed fleet-level observation surface. */
	get emitter(): EmitterInterface<ProcessManagerEventMap> {
		return this.#emitter
	}

	/** Counts the live children. */
	get count(): number {
		return this.#children.size
	}

	/**
	 * Returns the live child under `id`, or `undefined` when none is.
	 *
	 * @param id - The registry key
	 * @returns The child, or `undefined`
	 */
	process(id: string): ProcessInterface | undefined {
		return this.#children.get(id)
	}

	/**
	 * Returns a snapshot of every live child.
	 *
	 * @returns The live children in launch order
	 */
	processes(): readonly ProcessInterface[] {
		return [...this.#children.values()]
	}

	/**
	 * Spawns and registers one child under `id`.
	 *
	 * @remarks
	 * {@link Process} reads every option before it spawns, so a caller's own option getter runs while
	 * nothing has started and a throw from one strands no process. A getter that begins `destroy`
	 * without throwing is the one remaining race: the child is already spawned, so the launch is
	 * refused with a {@link createProtocolError} and that child is destroyed rather than adopted, its
	 * teardown bounded by `grace` plus the confirmation window. The `protocol` refusal throws
	 * synchronously, and the `destroy` barrier covers that teardown, so the refused child reaches its
	 * terminal moment before the barrier resolves.
	 *
	 * @param id - The registry key, unique among live children
	 * @param options - The child construction options
	 * @returns The launched child
	 * @throws A {@link ProcessError} coded `duplicate` when `id` is already live, `protocol` when the registry is being destroyed, or `invalid` when an option or command string is malformed
	 */
	launch(id: string, options: ProcessOptions): ProcessInterface {
		if (this.#destroying) throw createProtocolError(id)
		if (this.#ids.has(id)) throw createDuplicateError(id)
		this.#ids.add(id)
		const child = this.#construct(id, options)
		// Reading an option runs the caller's own code, so teardown can begin between the check above
		// and the child that is now spawned. A registry being destroyed adopts nothing: the child is
		// torn down here, the reservation goes back, and the launch is refused. The child joins
		// `#orphans` before its teardown starts, so `#teardown` covers it however far that teardown
		// has already progressed.
		if (this.#destroying) {
			this.#ids.delete(id)
			this.#orphans.add(child)
			void child.destroy()
			throw createProtocolError(id)
		}
		this.#children.set(id, child)
		void child.exit.then((exit) => this.#evict(id, child, exit))
		this.#emitter.emit('launch', id)
		return child
	}

	/**
	 * Terminates the named children and awaits their exit.
	 *
	 * @param ids - The registry keys to stop
	 * @returns True if every named child was live and its exit was confirmed; false otherwise
	 */
	stop(ids: readonly string[]): Promise<boolean>
	/**
	 * Terminates one child and awaits its exit.
	 *
	 * @param id - The registry key to stop
	 * @returns True if the child was live and its exit was confirmed; false otherwise (the id was not live, or the confirmation deadline elapsed)
	 */
	stop(id: string): Promise<boolean>
	/**
	 * Terminates every live child and awaits their exit.
	 *
	 * @returns A promise that resolves after every child stops
	 */
	stop(): Promise<void>
	stop(target?: string | readonly string[]): Promise<boolean | void> {
		if (target === undefined) return this.#stopAll()
		if (typeof target === 'string') return this.#stopOne(target)
		return this.#stopMany(target)
	}

	/**
	 * Stops every child, then destroys the registry emitter last.
	 *
	 * @remarks
	 * Always resolves, and refuses a later `launch` with a {@link createProtocolError}. Each child is
	 * destroyed rather than merely stopped, so its own observation emitter is destroyed too and every
	 * subscription on it goes silently inert.
	 *
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void> {
		if (this.#ending !== undefined) return this.#ending
		this.#destroying = true
		this.#ending = this.#teardown()
		return this.#ending
	}

	// Releases the reservation when construction throws, so a refused launch strands no id.
	#construct(id: string, options: ProcessOptions): ProcessInterface {
		try {
			return new Process(options)
		} catch (error) {
			this.#ids.delete(id)
			throw error
		}
	}

	#evict(id: string, child: ProcessInterface, exit: ProcessExit): void {
		if (this.#children.get(id) !== child) return
		this.#children.delete(id)
		this.#ids.delete(id)
		this.#emitter.emit('exit', id, exit)
	}

	async #stopOne(id: string): Promise<boolean> {
		const child = this.#children.get(id)
		if (child === undefined) return false
		return child.stop()
	}

	async #stopMany(ids: readonly string[]): Promise<boolean> {
		const stopped = await Promise.all(ids.map((id) => this.#stopOne(id)))
		return stopped.every((ok) => ok)
	}

	async #stopAll(): Promise<void> {
		await Promise.allSettled([...this.#children.values()].map((child) => child.stop()))
	}

	async #teardown(): Promise<void> {
		await Promise.allSettled([...this.#children.values()].map((child) => child.destroy()))
		// A launch that lost the race spawns its child after the line above read the registry, so the
		// barrier picks those children up here. Each pass takes the whole set and empties it, so a
		// child that arrives while an earlier pass is still awaiting is covered by the next one and no
		// child is awaited twice; the loop ends only on a pass that found the set empty. `destroy` on
		// a child is idempotent, so awaiting it here joins the teardown `launch` already began rather
		// than starting a second one. Every loser of the race is therefore covered, however many of
		// them one turn produces: a loser can only be a `launch` that passed the guard before
		// `#destroying` was set, and every such call is already on the stack when this runs.
		while (this.#orphans.size > 0) {
			const orphans = [...this.#orphans]
			this.#orphans.clear()
			await Promise.allSettled(orphans.map((child) => child.destroy()))
		}
		// A destroyed registry holds nothing: a child whose stdio a descendant still holds would
		// otherwise linger here until a close event that may never arrive.
		this.#children.clear()
		this.#ids.clear()
		this.#emitter.destroy()
	}
}
