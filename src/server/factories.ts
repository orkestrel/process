import type {
	ProcessInterface,
	ProcessManagerInterface,
	ProcessManagerOptions,
	ProcessOptions,
	SessionInterface,
	SessionOptions,
} from '@src/core'
import { Process } from './processes/Process.js'
import { ProcessManager } from './processes/ProcessManager.js'
import { Session } from './processes/Session.js'

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
 * Creates one raw byte session over a supervised child process.
 *
 * @param options - Command, workspace, termination, evidence, stdin, and observation settings
 * @returns The launched {@link SessionInterface}
 *
 * @example
 * ```ts
 * import { createSession } from '@orkestrel/process/server'
 *
 * const session = createSession({
 * 	command: { file: 'node', arguments: ['server.js', '--stdio'] },
 * 	workspace: process.cwd(),
 * 	grace: 5000,
 * })
 * ```
 */
export function createSession(options: SessionOptions): SessionInterface {
	return new Session(options)
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
