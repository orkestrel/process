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
 * A keyed registry of live supervised child processes.
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
 * `exit`, never from `launch`. `destroy` awaits every child's own teardown, which destroys each
 * child's observation emitter and leaves every subscription on it silently inert, then destroys the
 * registry emitter last.
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
	// A guard reads `#destroying`, never `#ending !== undefined`. `destroy` assigns the boolean before
	// it assigns the barrier, so the boolean also covers the synchronous prefix of the teardown, which
	// runs while `#ending` is still `undefined`.
	#destroying = false
	#ending: Promise<void> | undefined

	/**
	 * Construct a process registry.
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

	/** The typed fleet-level observation surface. */
	get emitter(): EmitterInterface<ProcessManagerEventMap> {
		return this.#emitter
	}

	/** The number of live children. */
	get count(): number {
		return this.#children.size
	}

	/**
	 * The live child under `id`, or `undefined` when none is.
	 *
	 * @param id - The registry key
	 * @returns The child, or `undefined`
	 */
	process(id: string): ProcessInterface | undefined {
		return this.#children.get(id)
	}

	/**
	 * A snapshot of every live child.
	 *
	 * @returns The live children in launch order
	 */
	processes(): readonly ProcessInterface[] {
		return [...this.#children.values()]
	}

	/**
	 * Spawn and register one child under `id`.
	 *
	 * @remarks
	 * {@link Process} reads every option before it spawns, so a caller's own option getter runs while
	 * nothing has started and a throw from one strands no process. A getter that begins `destroy`
	 * without throwing is the one remaining race, and it leaves a bounded residual: the child is
	 * already spawned, so the launch is refused with a {@link createProtocolError} and that child is
	 * torn down asynchronously, bounded by `grace` plus the confirmation window. The `protocol`
	 * refusal throws synchronously before the `destroy` barrier settles. The barrier does not cover
	 * that child's asynchronous teardown.
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
		// torn down here, the reservation goes back, and the launch is refused.
		if (this.#destroying) {
			this.#ids.delete(id)
			void child.destroy()
			throw createProtocolError(id)
		}
		this.#children.set(id, child)
		void child.exit.then((exit) => this.#evict(id, child, exit))
		this.#emitter.emit('launch', id)
		return child
	}

	/**
	 * Terminate the named children and await their exit.
	 *
	 * @param ids - The registry keys to stop
	 * @returns True when every named child was live and its exit was confirmed; false otherwise
	 */
	stop(ids: readonly string[]): Promise<boolean>
	/**
	 * Terminate one child and await its exit.
	 *
	 * @param id - The registry key to stop
	 * @returns True when the child was live and its exit was confirmed; false when the id was not live or the confirmation deadline elapsed
	 */
	stop(id: string): Promise<boolean>
	/**
	 * Terminate every live child and await their exit.
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
	 * Stop every child, then destroy the registry emitter last.
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
		// A destroyed registry holds nothing: a child whose stdio a descendant still holds would
		// otherwise linger here until a close event that may never arrive.
		this.#children.clear()
		this.#ids.clear()
		this.#emitter.destroy()
	}
}
