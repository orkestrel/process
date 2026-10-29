import type { ExecuteOptions, ExecuteResult, ProcessCommand } from '@src/core'
import { Execution } from '../processes/Execution.js'

/**
 * Runs one command to completion, buffering its output, and settles with the outcome.
 *
 * @remarks
 * The executable is resolved through {@link buildSpawn}, so no run uses a shell. On a POSIX host the
 * child is detached, which is what lets its whole process group be terminated. Standard output and
 * error are each byte-bounded by `limit` (default {@link PROCESS_OUTPUT}) and `truncated` reports
 * whether either stream exceeded it. Each capture keeps one byte beyond `limit`, so the single
 * code-point-boundary trim in {@link buildExecuteResult} reads the first excluded byte and never
 * delivers a split multibyte sequence. A positive `timeout` and an aborting `signal` both terminate the
 * child through the same bounded stop, and only the earliest is recorded: a timeout reports
 * `expired` and an abort reports `aborted`, never both. After termination the outcome is awaited for
 * a bounded window, so a descendant holding the child's stdio cannot keep the run pending. That bound
 * covers a terminated run alone: a run with no `timeout` and no `signal` settles on stdio completion
 * rather than on process exit, so a descendant that inherited the child's stdio holds the run open
 * after the child itself has gone. Give such a run a `timeout`. The child's `environment` merges over
 * the parent unless the command is `isolated`, then `options.environment` on top, and `options.input`
 * overrides `command.input`. A host fault while writing that input terminates the run by design and
 * marks its result failed; a strict rejection carries the host fault as its cause. This differs
 * from `Process` constructor input, whose package-initiated input phase stays quiet. Unless `strict`
 * is `false`, a failed run rejects with a {@link ProcessError} carrying the {@link ExecuteResult};
 * {@link createExecuteError} constructs every rejection outside the input-fault door. An invalid
 * option or command string rejects before the child is spawned, because an async function cannot
 * throw synchronously.
 *
 * @param command - The executable, arguments, and optional environment and input
 * @param options - Working directory, timeout, grace, signal, capture limit, and failure delivery
 * @returns The settled run outcome
 * @throws A {@link ProcessError} coded `invalid` for a malformed option, command string, or batch-bound argument, or one carrying the {@link ExecuteResult} when the run failed and `strict` is not `false`
 *
 * @example
 * ```ts
 * const result = await execute({ file: 'git', arguments: ['status'] }, { workspace: process.cwd() })
 * ```
 */
export async function execute(
	command: ProcessCommand,
	options?: ExecuteOptions,
): Promise<ExecuteResult> {
	const execution = new Execution(command, options)
	const result = await execution.settled
	return execution.read(result)
}
