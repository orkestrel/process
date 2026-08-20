import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
	DetachOptions,
	ExecuteOptions,
	ExecuteResult,
	ExecuteSyncOptions,
	ProcessCommand,
} from '@src/core'
import { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'
import { isString } from '@orkestrel/contract'
import { createExecuteError, PROCESS_CONFIRMATION, PROCESS_GRACE, PROCESS_OUTPUT } from '@src/core'
import { Retention } from './Retention.js'
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
} from './helpers.js'

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
 * overrides `command.input`. Unless `strict` is `false`, a failed run rejects with a
 * {@link createExecuteError} carrying the {@link ExecuteResult}. An invalid option or command string rejects
 * before the child is spawned, because an async function cannot throw synchronously.
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
			clearTimeout(timeoutTimer)
			cleanup.abort()
			void stopChild(child, grace, PROCESS_CONFIRMATION).then(() => {
				if (finish.signal.aborted) return
				confirmTimer = setTimeout(() => finish.abort(), PROCESS_CONFIRMATION)
			})
		},
		{ once: true },
	)

	child.stdin.on('error', () => undefined)
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

	if (text !== undefined) child.stdin.write(text)
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
	if (result.failed && strict) throw createExecuteError(result, cause)
	return result
}

/**
 * Runs one command to completion synchronously, buffering its output, and returns the outcome.
 *
 * @remarks
 * The synchronous counterpart of {@link execute}, spawned through the same resolver and never through a
 * shell. The host offers no cooperative termination window and no in-flight cancellation, so this
 * contract carries neither. A positive `timeout` ends only the root process and can leave
 * descendants running; use {@link execute} or {@link Process} when timeout must terminate the tree. A
 * timeout and an output overflow both end the root with `SIGKILL`: an overflow reports `truncated`
 * and `failed` together and trims the partial output to `limit`, where {@link execute} keeps reading and
 * reports `truncated` without failing. The environment and input follow the same merge as
 * {@link execute}. Unless `strict` is `false`, a failed run throws a {@link createExecuteError}
 * carrying the {@link ExecuteResult}.
 *
 * @param command - The executable, arguments, and optional environment and input
 * @param options - Working directory, timeout, capture limit, and failure delivery
 * @returns The run outcome
 * @throws A {@link ProcessError} coded `invalid` for a malformed option, command string, or batch-bound argument, or one carrying the {@link ExecuteResult} when the run failed and `strict` is not `false`
 *
 * @example
 * ```ts
 * const result = executeSync({ file: 'git', arguments: ['--version'] }, { strict: false })
 * ```
 */
export function executeSync(command: ProcessCommand, options?: ExecuteSyncOptions): ExecuteResult {
	const snapshot = snapshotCommand(command)
	validateCommand(snapshot)
	validateEnvironment(options?.environment)
	validateWorkspace(options?.workspace)
	validateTimer(options?.timeout, "option 'timeout'")
	validateBytes(options?.limit, "option 'limit'", 0)
	const limit = options?.limit ?? PROCESS_OUTPUT
	const timeout = options?.timeout ?? 0
	const strict = options?.strict ?? true
	const text = options?.input ?? snapshot.input
	const line = formatCommand(snapshot)
	const workspace = options?.workspace ?? process.cwd()
	const environment = mergeEnvironment(
		snapshot.isolated === true,
		snapshot.environment,
		options?.environment,
	)
	const plan = buildSpawn(snapshot, { workspace, environment })
	const outcome = spawnSync(plan.file, [...plan.arguments], {
		cwd: workspace,
		env: environment,
		encoding: 'buffer',
		maxBuffer: limit,
		killSignal: 'SIGKILL',
		windowsHide: true,
		windowsVerbatimArguments: plan.verbatim,
		...(text !== undefined ? { input: Buffer.from(text) } : {}),
		...(timeout > 0 ? { timeout } : {}),
	})
	const error = outcome.error
	const fault = error !== undefined && 'code' in error && isString(error.code) ? error.code : ''
	const result = buildExecuteResult({
		command: line,
		stdout: Buffer.isBuffer(outcome.stdout) ? outcome.stdout : Buffer.alloc(0),
		stderr: Buffer.isBuffer(outcome.stderr) ? outcome.stderr : Buffer.alloc(0),
		code: outcome.status,
		signal: outcome.signal,
		expired: fault === 'ETIMEDOUT',
		aborted: false,
		truncated: fault === 'ENOBUFS',
		limit,
		...(error === undefined ? {} : { cause: error }),
	})
	if (result.failed && strict) throw createExecuteError(result, error)
	return result
}

/**
 * Spawns one command as a detached process and returns without waiting for it.
 *
 * @remarks
 * The child owns no stdio and is unreferenced, so it outlives this process and nothing here observes
 * its outcome. The error listener is attached before the child is unreferenced, so a post-spawn host
 * fault is swallowed rather than crashing the caller; an invalid command is refused before anything
 * is spawned.
 *
 * @param command - The executable, arguments, and optional environment
 * @param options - The working directory the detached child starts in
 * @returns Nothing
 * @throws A {@link ProcessError} coded `invalid` when the working directory or a command string is malformed
 *
 * @example
 * ```ts
 * detach({ file: 'node', arguments: ['daemon.js'] }, { workspace: process.cwd() })
 * ```
 */
export function detach(command: ProcessCommand, options?: DetachOptions): void {
	const snapshot = snapshotCommand(command)
	validateCommand(snapshot)
	validateWorkspace(options?.workspace)
	const workspace = options?.workspace ?? process.cwd()
	const environment = mergeEnvironment(snapshot.isolated === true, snapshot.environment)
	const plan = buildSpawn(snapshot, { workspace, environment })
	const child = spawn(plan.file, [...plan.arguments], {
		cwd: workspace,
		detached: true,
		env: environment,
		stdio: 'ignore',
		windowsHide: true,
		windowsVerbatimArguments: plan.verbatim,
	})
	child.once('error', () => undefined)
	child.unref()
}
