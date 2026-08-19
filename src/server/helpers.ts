import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ProcessCommand, RunOptions, RunResult } from '@src/core'
import { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'
import { extname } from 'node:path'
import { createRunError, PROCESS_GRACE, PROCESS_OUTPUT } from '@src/core'

/**
 * Signals one owned child process, or its detached process group on a POSIX host.
 *
 * @remarks
 * On a POSIX host a child spawned `detached` leads its own process group, so signalling the
 * negated pid reaches the whole tree. On Windows, or when no pid is available, the signal goes to
 * the child directly. A throw during signalling is swallowed: the process can exit and win the
 * signal race, and the child's close event remains the authoritative terminal state.
 *
 * @param child - The child process signal boundary
 * @param signal - The signal to deliver
 * @returns Nothing
 *
 * @example
 * ```ts
 * killProcess(child, 'SIGTERM')
 * ```
 */
export function killProcess(
	child: { readonly pid?: number | undefined; kill(signal: NodeJS.Signals): boolean },
	signal: NodeJS.Signals,
): void {
	try {
		if (process.platform === 'win32' || child.pid === undefined) {
			child.kill(signal)
			return
		}
		process.kill(-child.pid, signal)
	} catch {
		// Exit can win the signal race; the close event remains authoritative.
	}
}

/**
 * Trims a buffer to at most `limit` trailing bytes without splitting a UTF-8 sequence.
 *
 * @remarks
 * Keeps the tail — the diagnostic end of a stderr stream. When the cut point lands inside a
 * multibyte sequence, the start advances past the leading continuation bytes so the retained
 * bytes always begin on a code-point boundary.
 *
 * @param buffer - The accumulated bytes
 * @param limit - The maximum retained byte count
 * @returns The trailing bytes, at most `limit` and never starting mid-sequence
 *
 * @example
 * ```ts
 * trimTail(Buffer.from('hello'), 3) // <Buffer 6c 6c 6f>
 * ```
 */
export function trimTail(buffer: Buffer, limit: number): Buffer {
	if (buffer.byteLength <= limit) return buffer
	let start = buffer.byteLength - limit
	while (start < buffer.byteLength) {
		const byte = buffer[start]
		if (byte === undefined || (byte & 0xc0) !== 0x80) break
		start += 1
	}
	return Buffer.from(buffer.subarray(start))
}

/**
 * Trims a buffer to at most `limit` leading bytes without splitting a UTF-8 sequence.
 *
 * @remarks
 * Keeps the head — the captured start of a one-shot run's output. When the cut point lands inside
 * a multibyte sequence, the end retreats to the sequence's start so the retained bytes always end
 * on a code-point boundary and decode without a replacement character.
 *
 * @param buffer - The accumulated bytes
 * @param limit - The maximum retained byte count
 * @returns The leading bytes, at most `limit` and never ending mid-sequence
 *
 * @example
 * ```ts
 * trimHead(Buffer.from('hello'), 3) // <Buffer 68 65 6c>
 * ```
 */
export function trimHead(buffer: Buffer, limit: number): Buffer {
	if (buffer.byteLength <= limit) return buffer
	let end = limit
	while (end > 0) {
		const byte = buffer[end]
		if (byte === undefined || (byte & 0xc0) !== 0x80) break
		end -= 1
	}
	return Buffer.from(buffer.subarray(0, end))
}

/**
 * Checks whether a command file must be spawned through a shell on the current host.
 *
 * @remarks
 * Node v22+ refuses to spawn a Windows `.cmd` or `.bat` batch file directly and returns `EINVAL`,
 * and a bare command name such as `git` resolves through `PATHEXT` to a batch shim rather than an
 * executable. Both cases run through the shell. A POSIX host, and a Windows path carrying a real
 * executable extension such as `.exe`, spawn directly. When the result is `true`, treat the
 * command file and arguments as trusted: shell invocation exposes shell metacharacters.
 *
 * @param file - The command executable name or path
 * @returns True when the file must run through a shell; false when it spawns directly
 *
 * @example
 * ```ts
 * requiresShell('git') // true on Windows, false on POSIX
 * ```
 */
export function requiresShell(file: string): boolean {
	if (process.platform !== 'win32') return false
	const lower = file.toLowerCase()
	return lower.endsWith('.cmd') || lower.endsWith('.bat') || extname(file) === ''
}

/**
 * Renders one command into its diagnostic command line.
 *
 * @param command - The executable and its argument vector
 * @returns The space-joined command line, for a {@link RunResult} and error messages
 *
 * @example
 * ```ts
 * commandLine({ file: 'git', arguments: ['status'] }) // 'git status'
 * ```
 */
export function commandLine(command: ProcessCommand): string {
	return [command.file, ...command.arguments].join(' ')
}

/**
 * Merges environment overrides over the current process environment.
 *
 * @remarks
 * Later maps override earlier ones and an `undefined` value unsets a key. The base is the parent
 * process environment, so a child inherits it unless a key is overridden or unset.
 *
 * @param base - The command's own environment overrides
 * @param override - Per-invocation overrides applied last
 * @returns The merged environment for a spawn
 *
 * @example
 * ```ts
 * mergeEnvironment({ TOKEN: 'a' }, { TOKEN: undefined }) // TOKEN unset
 * ```
 */
export function mergeEnvironment(
	base?: Readonly<Record<string, string | undefined>>,
	override?: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
	return { ...process.env, ...base, ...override }
}

/**
 * Builds one settled {@link RunResult} from a completed one-shot run's captured bytes and exit.
 *
 * @remarks
 * `failed` is derived: a run failed when it timed out, was ended by a signal, or exited with a
 * code other than `0` — a `null` code from a spawn fault is therefore a failure. Both output
 * buffers are byte-bounded by `limit` before decoding.
 *
 * @param command - The diagnostic command line
 * @param stdout - The captured standard output bytes
 * @param stderr - The captured standard error bytes
 * @param code - The exit code, or `null` when a signal or spawn fault ended the run
 * @param signal - The terminating signal, or `null`
 * @param timedOut - If `true`, the run's own timeout elapsed; if `false`, it did not
 * @param limit - The maximum captured bytes for each stream
 * @returns The frozen run outcome
 *
 * @example
 * ```ts
 * buildRunResult('git status', Buffer.from('ok'), Buffer.alloc(0), 0, null, false, 1024)
 * ```
 */
export function buildRunResult(
	command: string,
	stdout: Buffer,
	stderr: Buffer,
	code: number | null,
	signal: string | null,
	timedOut: boolean,
	limit: number,
): RunResult {
	return Object.freeze({
		command,
		stdout: trimHead(stdout, limit).toString('utf8'),
		stderr: trimHead(stderr, limit).toString('utf8'),
		code,
		signal,
		failed: timedOut || signal !== null || code !== 0,
		timedOut,
	})
}

/**
 * Runs one command to completion, buffering its output, and settles with the outcome.
 *
 * @remarks
 * The child is spawned through the cross-platform command resolver ({@link requiresShell}) and, on
 * a POSIX host, detached so its whole process group can be terminated. Standard output and error
 * are each byte-bounded by `limit` (default {@link PROCESS_OUTPUT}). A positive `timeout` arms a
 * timer that terminates the child through `SIGTERM`, then `SIGKILL` after `grace`
 * (default {@link PROCESS_GRACE}); aborting `signal` terminates the same way. The child's
 * `environment` merges over the parent, then `options.environment` on top, and `options.input`
 * overrides `command.input`. Unless `reject` is `false`, a failed run rejects with a
 * {@link createRunError} carrying the {@link RunResult}.
 *
 * @param command - The executable, arguments, and optional environment and input
 * @param options - Working directory, timeout, grace, signal, capture limit, and reject behavior
 * @returns The settled run outcome
 * @throws A {@link ProcessError} carrying the {@link RunResult} when the run failed and `reject` is not `false`
 *
 * @example
 * ```ts
 * const result = await run({ file: 'git', arguments: ['status'] }, { workspace: process.cwd() })
 * ```
 */
export async function run(command: ProcessCommand, options?: RunOptions): Promise<RunResult> {
	const limit = options?.limit ?? PROCESS_OUTPUT
	const grace = options?.grace ?? PROCESS_GRACE
	const timeout = options?.timeout ?? 0
	const reject = options?.reject ?? true
	const input = options?.input ?? command.input
	const line = commandLine(command)
	const settled = Promise.withResolvers<RunResult>()
	const terminate = new AbortController()
	const cleanup = new AbortController()
	let stdout: Buffer = Buffer.alloc(0)
	let stderr: Buffer = Buffer.alloc(0)
	let timedOut = false
	let launchCause: unknown
	let killTimer: ReturnType<typeof setTimeout> | undefined
	let timeoutTimer: ReturnType<typeof setTimeout> | undefined
	let done = false

	const child: ChildProcessWithoutNullStreams = spawn(command.file, [...command.arguments], {
		cwd: options?.workspace ?? process.cwd(),
		detached: process.platform !== 'win32',
		env: mergeEnvironment(command.environment, options?.environment),
		stdio: ['pipe', 'pipe', 'pipe'],
		shell: requiresShell(command.file),
		windowsHide: true,
	})

	terminate.signal.addEventListener(
		'abort',
		() => {
			killProcess(child, 'SIGTERM')
			killTimer = setTimeout(() => killProcess(child, 'SIGKILL'), grace)
		},
		{ once: true },
	)

	child.stdin.on('error', () => undefined)
	child.stdout.on('data', (chunk: unknown) => {
		if (Buffer.isBuffer(chunk)) stdout = trimHead(Buffer.concat([stdout, chunk]), limit)
	})
	child.stderr.on('data', (chunk: unknown) => {
		if (Buffer.isBuffer(chunk)) stderr = trimHead(Buffer.concat([stderr, chunk]), limit)
	})
	child.once('error', (cause: unknown) => {
		if (done) return
		done = true
		launchCause = cause
		cleanup.abort()
		clearTimeout(killTimer)
		clearTimeout(timeoutTimer)
		settled.resolve(buildRunResult(line, stdout, stderr, null, null, false, limit))
	})
	child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
		if (done) return
		done = true
		cleanup.abort()
		clearTimeout(killTimer)
		clearTimeout(timeoutTimer)
		settled.resolve(buildRunResult(line, stdout, stderr, code, signal, timedOut, limit))
	})

	if (input !== undefined) child.stdin.write(input)
	child.stdin.end()
	if (timeout > 0) {
		timeoutTimer = setTimeout(() => {
			timedOut = true
			terminate.abort()
		}, timeout)
	}
	if (options?.signal !== undefined) {
		const signal = options.signal
		signal.addEventListener('abort', () => terminate.abort(), {
			once: true,
			signal: cleanup.signal,
		})
		if (signal.aborted) terminate.abort()
	}

	const result = await settled.promise
	if (result.failed && reject) throw createRunError(result, launchCause)
	return result
}

/**
 * Runs one command to completion synchronously, buffering its output, and returns the outcome.
 *
 * @remarks
 * The synchronous counterpart of {@link run}. The child is spawned through the same cross-platform
 * command resolver ({@link requiresShell}). Standard output and error are each byte-bounded by
 * `limit` (default {@link PROCESS_OUTPUT}). A positive `timeout` is enforced by the host, which
 * ends the child with `SIGKILL` when it elapses. The environment and input follow the same merge
 * as {@link run}. Unless `reject` is `false`, a failed run throws a {@link createRunError} carrying
 * the {@link RunResult}.
 *
 * @param command - The executable, arguments, and optional environment and input
 * @param options - Working directory, timeout, signal, capture limit, and reject behavior
 * @returns The run outcome
 * @throws A {@link ProcessError} carrying the {@link RunResult} when the run failed and `reject` is not `false`
 *
 * @example
 * ```ts
 * const result = runSync({ file: 'git', arguments: ['--version'] }, { reject: false })
 * ```
 */
export function runSync(command: ProcessCommand, options?: RunOptions): RunResult {
	const limit = options?.limit ?? PROCESS_OUTPUT
	const timeout = options?.timeout ?? 0
	const reject = options?.reject ?? true
	const input = options?.input ?? command.input
	const line = commandLine(command)
	const outcome = spawnSync(command.file, [...command.arguments], {
		cwd: options?.workspace ?? process.cwd(),
		env: mergeEnvironment(command.environment, options?.environment),
		encoding: 'buffer',
		maxBuffer: limit,
		shell: requiresShell(command.file),
		windowsHide: true,
		...(input !== undefined ? { input } : {}),
		...(options?.signal !== undefined ? { signal: options.signal } : {}),
		...(timeout > 0 ? { timeout, killSignal: 'SIGKILL' } : {}),
	})
	const error = outcome.error
	const timedOut = error !== undefined && 'code' in error && error.code === 'ETIMEDOUT'
	const stdout = Buffer.isBuffer(outcome.stdout) ? outcome.stdout : Buffer.alloc(0)
	const stderr = Buffer.isBuffer(outcome.stderr) ? outcome.stderr : Buffer.alloc(0)
	const result = buildRunResult(
		line,
		stdout,
		stderr,
		outcome.status,
		outcome.signal,
		timedOut,
		limit,
	)
	if (result.failed && reject) throw createRunError(result, outcome.error)
	return result
}
