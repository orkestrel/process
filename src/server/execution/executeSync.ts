import type { ExecuteResult, ExecuteSyncOptions, ProcessCommand } from '@src/core'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { isString } from '@orkestrel/contract'
import { createExecuteError, PROCESS_OUTPUT } from '@src/core'
import {
	buildExecuteResult,
	buildSpawn,
	formatCommand,
	mergeEnvironment,
	snapshotCommand,
	validateBytes,
	validateCommand,
	validateEnvironment,
	validateTimer,
	validateWorkspace,
} from '../helpers.js'

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
	const optionEnvironment = options?.environment
	const optionWorkspace = options?.workspace
	const optionInput = options?.input
	const optionTimeout = options?.timeout
	const optionStrict = options?.strict
	const optionLimit = options?.limit
	validateCommand(snapshot)
	validateEnvironment(optionEnvironment)
	validateWorkspace(optionWorkspace)
	validateTimer(optionTimeout, "option 'timeout'")
	validateBytes(optionLimit, "option 'limit'", 0)
	const limit = optionLimit ?? PROCESS_OUTPUT
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
