import type {
	ProcessInterface,
	ProcessManagerInterface,
	ProcessManagerOptions,
	ProcessOptions,
} from '@src/core'
import { Process } from './Process.js'
import { ProcessManager } from './ProcessManager.js'

/**
 * Creates one supervised child process.
 *
 * @param options - Command, workspace, termination, evidence, stdin, and observation settings
 * @returns The launched {@link ProcessInterface}
 *
 * @example
 * ```ts
 * import { createProcess } from '@orkestrel/process/server'
 *
 * const child = createProcess({
 * 	command: { file: 'node', arguments: ['--version'] },
 * 	workspace: process.cwd(),
 * 	grace: 5000,
 * })
 * ```
 */
export function createProcess(options: ProcessOptions): ProcessInterface {
	return new Process(options)
}

/**
 * Creates one keyed registry of supervised child processes.
 *
 * @param options - Initial fleet-level observation hooks and listener-error handling
 * @returns The {@link ProcessManagerInterface} registry
 *
 * @example
 * ```ts
 * import { createProcessManager } from '@orkestrel/process/server'
 *
 * const manager = createProcessManager()
 * ```
 */
export function createProcessManager(options?: ProcessManagerOptions): ProcessManagerInterface {
	return new ProcessManager(options)
}
