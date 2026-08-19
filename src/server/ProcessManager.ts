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
import { createDuplicateError } from '@src/core'
import { Process } from './Process.js'

/**
 * A keyed registry of live supervised child processes.
 *
 * @remarks
 * A child launched under an id joins the registry and emits `launch`; when it settles it removes
 * itself and emits `exit`, so `count` and `processes` reflect only live children. `launch` throws
 * a {@link createDuplicateError} when the id is already live — a spawn fault surfaces through the
 * returned child's `exit`, never from `launch`. `destroy` stops every child, then destroys the
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
 * 	grace: 5000,
 * })
 * await child.exit
 * await manager.destroy()
 * ```
 */
export class ProcessManager implements ProcessManagerInterface {
	readonly #emitter: Emitter<ProcessManagerEventMap>
	readonly #children = new Map<string, ProcessInterface>()
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
	 * @param id - The registry key, unique among live children
	 * @param options - The child construction options
	 * @returns The launched child
	 * @throws A {@link ProcessError} coded `duplicate` when `id` is already live
	 */
	launch(id: string, options: ProcessOptions): ProcessInterface {
		if (this.#children.has(id)) throw createDuplicateError(id)
		const child = new Process(options)
		this.#children.set(id, child)
		child.emitter.on('exit', (exit) => this.#evict(id, child, exit))
		this.#emitter.emit('launch', id)
		return child
	}

	/**
	 * Terminate the named children and await their exit.
	 *
	 * @param ids - The registry keys to stop
	 * @returns True when every named child stopped, false when any id was not live
	 */
	stop(ids: readonly string[]): Promise<boolean>
	/**
	 * Terminate one child and await its exit.
	 *
	 * @param id - The registry key to stop
	 * @returns True when the child was live and stopped, false when the id was not live
	 */
	stop(id: string): Promise<boolean>
	/**
	 * Terminate every live child and await their exit.
	 *
	 * @returns A promise that resolves after all children stop
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
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void> {
		if (this.#ending !== undefined) return this.#ending
		this.#ending = this.#teardown()
		return this.#ending
	}

	#evict(id: string, child: ProcessInterface, exit: ProcessExit): void {
		if (this.#children.get(id) !== child) return
		this.#children.delete(id)
		this.#emitter.emit('exit', id, exit)
	}

	async #stopOne(id: string): Promise<boolean> {
		const child = this.#children.get(id)
		if (child === undefined) return false
		await child.stop()
		return true
	}

	async #stopMany(ids: readonly string[]): Promise<boolean> {
		const stopped = await Promise.all(ids.map((id) => this.#stopOne(id)))
		return stopped.every((ok) => ok)
	}

	async #stopAll(): Promise<void> {
		await Promise.all([...this.#children.values()].map((child) => child.stop()))
	}

	async #teardown(): Promise<void> {
		await Promise.all([...this.#children.values()].map((child) => child.destroy()))
		this.#emitter.destroy()
	}
}
