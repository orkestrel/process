import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ExecuteOptions, ExecuteResult, ProcessCommand } from '@src/core'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import {
	createExecuteError,
	PROCESS_CONFIRMATION,
	PROCESS_GRACE,
	PROCESS_OUTPUT,
	ProcessError,
} from '@src/core'
import { Retention } from '../Retention.js'
import {
	buildExecuteResult,
	buildSpawn,
	formatCommand,
	mergeEnvironment,
	snapshotCommand,
	stopChild,
	validateBytes,
	validateCommand,
	validateEnvironment,
	validateTimer,
	validateWorkspace,
} from '../helpers.js'

/**
 * Runs one command to completion, buffering its output, and settles with the outcome.
 *
 * @remarks
 * The executable is resolved through {@link buildSpawn}, so no run uses a shell. On a POSIX host the
 * child is detached, which is what lets its whole process group be terminated. Standard output and
 * error are each byte-bounded by `limit` (default {@link PROCESS_OUTPUT}) and `truncated` reports
 * whether either stream exceeded it. A positive `timeout` and an aborting `signal` both terminate the
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
	const snapshot = snapshotCommand(command)
	const optionEnvironment = options?.environment
	const optionWorkspace = options?.workspace
	const optionInput = options?.input
	const optionTimeout = options?.timeout
	const optionGrace = options?.grace
	const optionSignal = options?.signal
	const optionStrict = options?.strict
	const optionLimit = options?.limit
	validateCommand(snapshot)
	validateEnvironment(optionEnvironment)
	validateWorkspace(optionWorkspace)
	validateTimer(optionTimeout, "option 'timeout'")
	validateTimer(optionGrace, "option 'grace'")
	validateBytes(optionLimit, "option 'limit'", 0)
	const limit = optionLimit ?? PROCESS_OUTPUT
	const grace = optionGrace ?? PROCESS_GRACE
	const timeout = optionTimeout ?? 0
	const strict = optionStrict ?? true
	const text = optionInput ?? snapshot.input
	const line = formatCommand(snapshot)
	const workspace = optionWorkspace ?? process.cwd()
	const environment = mergeEnvironment(
		snapshot.isolated === true,
		snapshot.environment,
		optionEnvironment,
	)
	const plan = buildSpawn(snapshot, { workspace, environment })
	const settled = Promise.withResolvers<ExecuteResult>()
	const terminate = new AbortController()
	const cleanup = new AbortController()
	const finish = new AbortController()
	const inputFailure = new AbortController()
	const outChunks: Buffer[] = []
	const errChunks: Buffer[] = []
	const outRetention = new Retention()
	const errRetention = new Retention()
	let spawned = false
	let expired = false
	let aborted = false
	let cause: unknown
	let timeoutTimer: ReturnType<typeof setTimeout> | undefined
	let confirmTimer: ReturnType<typeof setTimeout> | undefined

	const child: ChildProcessWithoutNullStreams = spawn(plan.file, [...plan.arguments], {
		cwd: workspace,
		detached: process.platform !== 'win32',
		env: environment,
		stdio: ['pipe', 'pipe', 'pipe'],
		windowsHide: true,
		windowsVerbatimArguments: plan.verbatim,
	})

	finish.signal.addEventListener(
		'abort',
		() => {
			clearTimeout(timeoutTimer)
			clearTimeout(confirmTimer)
			cleanup.abort()
			settled.resolve(
				buildExecuteResult({
					command: line,
					stdout: Buffer.concat(outChunks),
					stderr: Buffer.concat(errChunks),
					code: child.exitCode,
					signal: child.signalCode,
					expired,
					aborted,
					truncated: outRetention.delivered > limit || errRetention.delivered > limit,
					limit,
					...(cause === undefined ? {} : { cause }),
				}),
			)
		},
		{ once: true },
	)

	terminate.signal.addEventListener(
		'abort',
		() => {
			if (finish.signal.aborted) return
			clearTimeout(timeoutTimer)
			cleanup.abort()
			void stopChild(child, grace, PROCESS_CONFIRMATION).then(() => {
				if (finish.signal.aborted) return
				confirmTimer = setTimeout(() => finish.abort(), PROCESS_CONFIRMATION)
			})
		},
		{ once: true },
	)

	inputFailure.signal.addEventListener(
		'abort',
		() => {
			if (finish.signal.aborted) return
			cause = inputFailure.signal.reason
			terminate.abort()
		},
		{ once: true },
	)

	child.stdin.on('error', (error: Error) => inputFailure.abort(error))
	child.stdout.on('data', (chunk: unknown) => {
		const retained = outRetention.retain(chunk, limit)
		if (retained !== undefined) outChunks.push(retained)
	})
	child.stderr.on('data', (chunk: unknown) => {
		const retained = errRetention.retain(chunk, limit)
		if (retained !== undefined) errChunks.push(retained)
	})
	child.once('spawn', () => {
		spawned = true
	})
	child.once('error', (error: unknown) => {
		if (spawned) return
		cause = error
		finish.abort()
	})
	child.once('close', () => finish.abort())

	if (text !== undefined) {
		child.stdin.write(text, (error?: Error | null) => {
			if (error !== undefined && error !== null) inputFailure.abort(error)
		})
	}
	child.stdin.end()
	if (timeout > 0) {
		timeoutTimer = setTimeout(() => {
			expired = true
			terminate.abort()
		}, timeout)
	}
	if (optionSignal !== undefined) {
		optionSignal.addEventListener(
			'abort',
			() => {
				aborted = true
				terminate.abort()
			},
			{ once: true, signal: cleanup.signal },
		)
		if (optionSignal.aborted) {
			aborted = true
			terminate.abort()
		}
	}

	const result = await settled.promise
	if (result.failed && strict) {
		if (cause !== undefined && cause === inputFailure.signal.reason) {
			throw new ProcessError(`Command '${result.command}' failed while writing standard input`, {
				code: 'input',
				context: { command: result.command, code: result.code, signal: result.signal },
				cause: inputFailure.signal.reason,
				result,
			})
		}
		throw createExecuteError(result, cause)
	}
	return result
}
