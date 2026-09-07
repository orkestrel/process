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
 * Creates one supervised child process and returns it as a {@link ProcessInterface}, so a caller
 * holds the published contract rather than the `Process` class.
 *
 * @param options - Command, workspace, termination, evidence, stdin, and observation settings
 * @returns The launched {@link ProcessInterface}
 *
 * @example Supervise a child and read its lines
 * ```ts
 * import { createProcess } from '@orkestrel/process/server'
 *
 * const child = createProcess({
 * 	command: { file: 'node', arguments: ['-e', 'console.log("ready"); console.log("done")'] },
 * 	workspace: process.cwd(),
 * 	grace: 5_000, // POSIX only: the window between SIGTERM and SIGKILL
 * })
 *
 * const lines: string[] = []
 * for await (const line of child.lines) lines.push(line)
 * lines // ['ready', 'done']
 *
 * const exit = await child.exit
 * exit.code // 0
 * await child.destroy()
 * ```
 */
export function createProcess(options: ProcessOptions): ProcessInterface {
	return new Process(options)
}

/**
 * Creates one raw byte session over a supervised child process and returns it as a
 * {@link SessionInterface}, so a caller holds the published contract rather than the `Session` class.
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
 * Creates one empty keyed registry of supervised child processes and returns it as a
 * {@link ProcessManagerInterface}, so a caller holds the published contract rather than the
 * `ProcessManager` class.
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
