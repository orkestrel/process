import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
	DetachOptions,
	ExecutableOptions,
	ProcessCommand,
	RunInput,
	RunOptions,
	RunResult,
	RunSyncOptions,
	SpawnInput,
} from '@src/core'
import type { ProcessChild } from './types.js'
import { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { delimiter, extname, join, resolve } from 'node:path'
import {
	attempt,
	boundsOf,
	holds,
	isFunction,
	isNonEmptyString,
	isNonNegativeInteger,
	isString,
} from '@orkestrel/contract'
import {
	createInvalidError,
	createRunError,
	PROCESS_CONFIRMATION,
	PROCESS_GRACE,
	PROCESS_OUTPUT,
	PROCESS_PATHEXT,
	PROCESS_TIMER,
} from '@src/core'

/**
 * Trims a buffer to at most `limit` trailing bytes without splitting a UTF-8 sequence.
 *
 * @remarks
 * Keeps the tail — the diagnostic end of a stderr stream. When the cut point lands inside a
 * multibyte sequence, the start advances past the leading continuation bytes so the retained
 * bytes always begin on a code-point boundary.
 *
 * @param bytes - The accumulated bytes
 * @param limit - The maximum retained byte count
 * @returns The trailing bytes, at most `limit` and never starting mid-sequence
 *
 * @example
 * ```ts
 * trimTail(Buffer.from('hello'), 3) // <Buffer 6c 6c 6f>
 * ```
 */
export function trimTail(bytes: Uint8Array, limit: number): Buffer {
	const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
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
 * @param bytes - The accumulated bytes
 * @param limit - The maximum retained byte count
 * @returns The leading bytes, at most `limit` and never ending mid-sequence
 *
 * @example
 * ```ts
 * trimHead(Buffer.from('hello'), 3) // <Buffer 68 65 6c>
 * ```
 */
export function trimHead(bytes: Uint8Array, limit: number): Buffer {
	const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
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
 * Renders one command into its diagnostic command line.
 *
 * @param command - The executable and its argument vector
 * @returns The space-joined command line, for a {@link RunResult} and error messages
 *
 * @example
 * ```ts
 * formatCommand({ file: 'git', arguments: ['status'] }) // 'git status'
 * ```
 */
export function formatCommand(command: ProcessCommand): string {
	return [command.file, ...command.arguments].join(' ')
}

/**
 * Reads one environment variable the way the host resolves it.
 *
 * @remarks
 * Windows environment keys are case-insensitive, so a merged record can hold `Path` where the
 * caller asks for `PATH`. The exact key is tried first and a folded scan runs only on Windows.
 *
 * @param environment - The environment record to read
 * @param name - The variable name
 * @returns The value, or `undefined` when the environment declares no such variable
 *
 * @example
 * ```ts
 * readVariable({ Path: 'C:\\Windows' }, 'PATH') // 'C:\\Windows' on Windows
 * ```
 */
export function readVariable(
	environment: Readonly<Record<string, string | undefined>>,
	name: string,
): string | undefined {
	const direct = environment[name]
	if (direct !== undefined) return direct
	if (process.platform !== 'win32') return undefined
	const target = name.toUpperCase()
	for (const [key, value] of Object.entries(environment)) {
		if (key.toUpperCase() === target) return value
	}
	return undefined
}

/**
 * Merges environment overrides into the environment one child receives.
 *
 * @remarks
 * Later maps override earlier ones and an `undefined` value unsets a key. On Windows the keys fold
 * case-insensitively and the last writer wins, so `PATH` followed by `Path` yields one variable
 * rather than two the host would resolve unpredictably.
 *
 * @param isolated - If `true`, the parent environment is excluded; if `false`, the overrides layer over it
 * @param base - The command's own environment overrides
 * @param override - Per-invocation overrides applied last
 * @returns The environment for a spawn, carrying no unset key
 *
 * @example
 * ```ts
 * mergeEnvironment(false, { TOKEN: 'a' }, { TOKEN: undefined }) // TOKEN unset
 * ```
 */
export function mergeEnvironment(
	isolated: boolean,
	base?: Readonly<Record<string, string | undefined>>,
	override?: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
	const folded = process.platform === 'win32'
	const layers: ReadonlyArray<Readonly<Record<string, string | undefined>>> = [
		isolated ? {} : process.env,
		base ?? {},
		override ?? {},
	]
	const entries = new Map<string, readonly [key: string, value: string]>()
	for (const layer of layers) {
		for (const [key, value] of Object.entries(layer)) {
			const token = folded ? key.toUpperCase() : key
			if (value === undefined) {
				entries.delete(token)
				continue
			}
			entries.set(token, [key, value])
		}
	}
	const merged: NodeJS.ProcessEnv = {}
	for (const [key, value] of entries.values()) merged[key] = value
	return merged
}

/**
 * Checks whether a path names a regular file.
 *
 * @remarks
 * Existence alone does not make a lookup hit: a directory named `git` on `PATH` is not the `git`
 * command. An unreadable or malformed path reports `false` rather than throwing.
 *
 * @param target - The absolute or relative path to inspect
 * @returns True when the path resolves to a regular file; false otherwise
 *
 * @example
 * ```ts
 * isFile(process.execPath) // true
 * ```
 */
export function isFile(target: string): boolean {
	return holds(() => statSync(target, { throwIfNoEntry: false })?.isFile() === true)
}

/**
 * Resolves a command file to the executable path the host would launch.
 *
 * @remarks
 * Windows alone needs this: the host searches the working directory before `PATH` and applies
 * `PATHEXT`, and Node reproduces neither for a direct spawn. Within each searched directory the
 * literal name is tried first and each `PATHEXT` candidate after it, whether or not the name already
 * carries an extension — so `report.txt` resolves to a `report.txt` file where one exists and to
 * `report.txt.cmd` where none does. The lookup reads the child's effective environment, so an
 * overridden `PATH` selects the executable the child would have found. A POSIX host resolves the
 * file itself, so the answer there is always `undefined`. An appended extension is spelled the way
 * `PATHEXT` spells it rather than the way the directory entry does, which the case-insensitive host
 * treats as the same file.
 *
 * @param file - The command executable name or path
 * @param options - The directory searched first and the child's effective environment
 * @returns The resolved absolute path, or `undefined` when no candidate is a regular file
 *
 * @example
 * ```ts
 * resolveExecutable('git', {}) ?? 'git' // an absolute path on Windows, 'git' elsewhere
 * ```
 */
export function resolveExecutable(file: string, options?: ExecutableOptions): string | undefined {
	if (process.platform !== 'win32') return undefined
	const environment = options?.environment ?? process.env
	const workspace = options?.workspace ?? process.cwd()
	const extensions = (readVariable(environment, 'PATHEXT') ?? PROCESS_PATHEXT)
		.split(';')
		.filter((extension) => extension.length > 0)
	const candidates = [file, ...extensions.map((extension) => `${file}${extension}`)]
	const rooted = file.includes('/') || file.includes('\\')
	const directories = rooted
		? [workspace]
		: [workspace, ...(readVariable(environment, 'PATH') ?? '').split(delimiter)]
	for (const directory of directories) {
		if (directory.length === 0) continue
		for (const candidate of candidates) {
			const target = resolve(directory, candidate)
			if (isFile(target)) return target
		}
	}
	return undefined
}

/**
 * Quotes one command-line token for a `cmd.exe` command line.
 *
 * @remarks
 * A token carrying whitespace or a shell metacharacter is wrapped in double quotes so `cmd.exe`
 * passes it as one literal argument; an embedded double quote is doubled, which is how `cmd.exe`
 * reads a literal quote inside a quoted token. Every other token is left exactly as written, so a
 * batch script still receives `%1` without added quotes.
 *
 * @param value - The token to quote
 * @returns The token, quoted only when `cmd.exe` would otherwise split or interpret it
 *
 * @example
 * ```ts
 * quoteArgument('a&b') // '"a&b"'
 * ```
 */
export function quoteArgument(value: string): string {
	if (value.length > 0 && !/[\s"&|<>^()%!]/.test(value)) return value
	return `"${value.replaceAll('"', '""')}"`
}

/**
 * Builds the resolved spawn form of one command.
 *
 * @remarks
 * The executable is resolved against the child's effective environment. A resolved `.cmd` or `.bat`
 * script cannot be spawned directly **on Windows**, so it runs there through an explicitly quoted
 * `cmd.exe /d /s /c` command line with the argument vector passed verbatim. No path uses a shell,
 * so a metacharacter in an argument is never interpreted. `cmd.exe` expands `%NAME%` before it
 * parses quotes, so no quoting can carry a percent sign through to a Windows batch target: an
 * argument carrying one is refused there rather than silently rewritten. The whole batch path is
 * Windows-only. A POSIX host has no `cmd.exe` and no restriction on spawning a file directly, so a
 * target named `worker.cmd` spawns directly there and receives a percent sign as literal text.
 *
 * @param command - The executable and its argument vector
 * @param options - The directory searched first and the child's effective environment
 * @returns The file, argument vector, and verbatim flag to spawn with
 * @throws A {@link ProcessError} coded `invalid` when the host is Windows, the resolved target is a batch script, and an argument carries a percent sign
 *
 * @example
 * ```ts
 * buildSpawn({ file: 'node', arguments: ['--version'] }).verbatim // false
 * ```
 */
export function buildSpawn(command: ProcessCommand, options?: ExecutableOptions): SpawnInput {
	const file = resolveExecutable(command.file, options) ?? command.file
	const extension = extname(file).toLowerCase()
	// Windows alone cannot spawn a batch script directly, and `cmd.exe` is what expands `%NAME%`.
	// A POSIX host has neither restriction, so a file whose name ends in `.cmd` is an ordinary
	// executable there and its extension changes nothing about how it spawns.
	const batch = process.platform === 'win32' && (extension === '.cmd' || extension === '.bat')
	if (!batch) {
		return Object.freeze({
			file,
			arguments: Object.freeze([...command.arguments]),
			verbatim: false,
		})
	}
	for (const argument of command.arguments) {
		if (argument.includes('%')) throw createInvalidError('command argument', argument)
	}
	const line = [`"${file}"`, ...command.arguments.map(quoteArgument)].join(' ')
	const environment = options?.environment ?? process.env
	return Object.freeze({
		file: readVariable(environment, 'ComSpec') ?? 'cmd.exe',
		arguments: Object.freeze(['/d', '/s', '/c', `"${line}"`]),
		verbatim: true,
	})
}

/**
 * Validates one spawn-bound string.
 *
 * @remarks
 * A NUL character terminates a string for the host, so it is refused everywhere rather than
 * reaching the spawn as a raw `ERR_INVALID_ARG_VALUE`.
 *
 * @param value - The value to inspect
 * @param subject - The rejected input named as the caller wrote it, such as `command file`
 * @param required - If `true`, an empty string is refused; if `false`, it is accepted
 * @returns Nothing; a successful return means the string is spawn-safe
 * @throws A {@link ProcessError} coded `invalid` when the value is not a string, carries a NUL, or is required and empty
 *
 * @example
 * ```ts
 * validateText('status', 'command argument', false) // returns
 * ```
 */
export function validateText(value: unknown, subject: string, required: boolean): void {
	if (!isString(value) || value.includes('\0')) throw createInvalidError(subject, value)
	if (required && !isNonEmptyString(value)) throw createInvalidError(subject, value)
}

/**
 * Validates one timer-valued option in milliseconds.
 *
 * @remarks
 * The host truncates a fractional delay and converts anything above {@link PROCESS_TIMER} to one
 * millisecond, so a requested 25-day timeout would otherwise fire immediately.
 *
 * @param value - The value to inspect, or `undefined` when the option was omitted
 * @param subject - The rejected input named as the caller wrote it, such as `option 'grace'`
 * @returns Nothing; a successful return means the value schedules as written
 * @throws A {@link ProcessError} coded `invalid` when the value is not a non-negative integer at or below `PROCESS_TIMER`
 *
 * @example
 * ```ts
 * validateTimer(5_000, "option 'grace'") // returns
 * ```
 */
export function validateTimer(value: number | undefined, subject: string): void {
	if (value === undefined) return
	if (!isNonNegativeInteger(value) || !boundsOf(0, PROCESS_TIMER)(value)) {
		throw createInvalidError(subject, value)
	}
}

/**
 * Validates one byte-valued option.
 *
 * @param value - The value to inspect, or `undefined` when the option was omitted
 * @param subject - The rejected input named as the caller wrote it, such as `option 'limit'`
 * @param minimum - The smallest accepted value
 * @returns Nothing; a successful return means the value bounds a real byte count
 * @throws A {@link ProcessError} coded `invalid` when the value is not a safe integer at or above `minimum`
 *
 * @example
 * ```ts
 * validateBytes(1_024, "option 'limit'", 0) // returns
 * ```
 */
export function validateBytes(value: number | undefined, subject: string, minimum: number): void {
	if (value === undefined) return
	if (!isNonNegativeInteger(value) || !boundsOf(minimum, Number.MAX_SAFE_INTEGER)(value)) {
		throw createInvalidError(subject, value)
	}
}

/**
 * Validates every spawn-bound string of one environment override map.
 *
 * @remarks
 * The host refuses a NUL in a variable name or value with a raw `ERR_INVALID_ARG_VALUE`, so the same
 * refusal runs here for a command's own overrides and for a per-invocation override map alike.
 *
 * @param environment - The override map, or `undefined` when none was supplied
 * @returns Nothing; a successful return means every name and value reaches the host intact
 * @throws A {@link ProcessError} coded `invalid` when a name is empty or a name or value carries a NUL
 *
 * @example
 * ```ts
 * validateEnvironment({ TOKEN: 'a' }) // returns
 * ```
 */
export function validateEnvironment(
	environment: Readonly<Record<string, string | undefined>> | undefined,
): void {
	if (environment === undefined) return
	for (const [key, value] of Object.entries(environment)) {
		validateText(key, 'environment key', true)
		if (value !== undefined) validateText(value, 'environment value', false)
	}
}

/**
 * Validates every spawn-bound string of one command.
 *
 * @param command - The executable, arguments, and optional environment overrides
 * @returns Nothing; a successful return means the command reaches the host intact
 * @throws A {@link ProcessError} coded `invalid` when the file is empty or any string carries a NUL
 *
 * @example
 * ```ts
 * validateCommand({ file: 'git', arguments: ['status'] }) // returns
 * ```
 */
export function validateCommand(command: ProcessCommand): void {
	validateText(command.file, 'command file', true)
	for (const argument of command.arguments) validateText(argument, 'command argument', false)
	validateEnvironment(command.environment)
}

/**
 * Validates the working directory one child starts in.
 *
 * @param workspace - The directory, or `undefined` when the option was omitted
 * @returns Nothing; a successful return means the directory reaches the host intact
 * @throws A {@link ProcessError} coded `invalid` when the directory is empty or carries a NUL
 *
 * @example
 * ```ts
 * validateWorkspace(process.cwd()) // returns
 * ```
 */
export function validateWorkspace(workspace: string | undefined): void {
	if (workspace === undefined) return
	validateText(workspace, 'workspace', true)
}

/**
 * Retains one delivered chunk up to a byte limit and records what the stream delivered.
 *
 * @remarks
 * The retained head is kept as chunk slices and joined once, so a long stream never repeatedly
 * concatenates a growing buffer. `counts` is a two-slot tally: slot `0` counts every delivered byte
 * and slot `1` counts the retained bytes, so a caller compares slot `0` against `limit` to learn
 * whether the capture was truncated.
 *
 * @param chunk - The delivered chunk, ignored when it is not a buffer
 * @param chunks - The retained head, appended to in place
 * @param counts - The `[delivered, retained]` tally, updated in place
 * @param limit - The maximum retained byte count
 * @returns Nothing
 *
 * @example
 * ```ts
 * const chunks: Buffer[] = []
 * const counts = [0, 0]
 * retainChunk(Buffer.from('hello'), chunks, counts, 3)
 * counts[1] // 3
 * ```
 */
export function retainChunk(
	chunk: unknown,
	chunks: Buffer[],
	counts: number[],
	limit: number,
): void {
	if (!Buffer.isBuffer(chunk)) return
	const delivered = counts[0] ?? 0
	const retained = counts[1] ?? 0
	counts[0] = delivered + chunk.byteLength
	const room = limit - retained
	if (room <= 0) return
	const slice = chunk.byteLength <= room ? chunk : Buffer.from(chunk.subarray(0, room))
	chunks.push(slice)
	counts[1] = retained + slice.byteLength
}

/**
 * Checks whether a child process has reached its native exit.
 *
 * @remarks
 * The host sets exactly one of these fields when the process ends, so together they are the
 * authoritative liveness answer. Reading them before each signal is what keeps a signal from being
 * initiated against a pid the host may have reused.
 *
 * @param child - The child boundary
 * @returns True when the process has exited; false while it is live
 *
 * @example
 * ```ts
 * isExited({ exitCode: 0, signalCode: null }) // true
 * ```
 */
export function isExited(child: Pick<ProcessChild, 'exitCode' | 'signalCode'>): boolean {
	return child.exitCode !== null || child.signalCode !== null
}

/**
 * Signals one owned child process, or its detached process group on a POSIX host.
 *
 * @remarks
 * On a POSIX host a child spawned `detached` leads its own process group, so signalling the
 * negated pid reaches the whole tree. When no group owns the pid and the host reports `ESRCH`, the
 * signal falls back to the child directly. On Windows, or when no pid is available, the signal also
 * goes to the child directly. Every other throw during signalling is swallowed: the process can
 * exit between the caller's liveness check and this call, and the child's native exit remains the
 * authoritative terminal state.
 *
 * @param child - The child boundary
 * @param signal - The signal to deliver
 * @returns Nothing
 *
 * @example
 * ```ts
 * killProcess(child, 'SIGTERM')
 * ```
 */
export function killProcess(
	child: Pick<ProcessChild, 'pid' | 'kill'>,
	signal: NodeJS.Signals,
): void {
	try {
		if (process.platform === 'win32' || child.pid === undefined) {
			child.kill(signal)
			return
		}
		process.kill(-child.pid, signal)
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
			holds(() => child.kill(signal))
			return
		}
		// Exit can win the signal race; the native exit remains authoritative.
	}
}

/**
 * Kills one Windows process tree through `taskkill`.
 *
 * @remarks
 * Windows has no process group a signal can reach, so the whole tree is ended by the host utility,
 * addressed by its absolute `System32` path so a `PATH` override cannot substitute another program.
 * The call is bounded: it is killed itself when `timeout` elapses, which is what keeps a termination
 * from waiting on the host indefinitely. A tree is discoverable only while its root lives, so a
 * descendant that outlives the root is beyond this mechanism.
 *
 * @param pid - The root process id of the tree to end
 * @param timeout - The milliseconds the utility is given before it is killed
 * @returns True when the utility reported success; false when it failed, was unavailable, or was cut off
 *
 * @example
 * ```ts
 * await killTree(child.pid ?? 0, 5_000)
 * ```
 */
export function killTree(pid: number, timeout: number): Promise<boolean> {
	const settled = Promise.withResolvers<boolean>()
	const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
	const killer = spawn(executable, ['/F', '/T', '/PID', String(pid)], {
		stdio: 'ignore',
		windowsHide: true,
		timeout,
	})
	killer.once('error', () => settled.resolve(false))
	killer.once('close', (code: number | null) => settled.resolve(code === 0))
	return settled.promise
}

/**
 * Waits for one child process's native exit, bounded by a deadline.
 *
 * @param child - The child boundary
 * @param timeout - The milliseconds to wait before giving up
 * @returns A promise that resolves on the native exit or when the deadline elapses, whichever comes first
 *
 * @example
 * ```ts
 * await waitForExit(child, 5_000)
 * ```
 */
export function waitForExit(
	child: Pick<ProcessChild, 'exitCode' | 'signalCode' | 'once'>,
	timeout: number,
): Promise<void> {
	if (isExited(child)) return Promise.resolve()
	const settled = Promise.withResolvers<void>()
	const timer = setTimeout(() => {
		attempt(() => {
			if (!('off' in child)) return
			const off = child.off
			if (isFunction(off)) Reflect.apply(off, child, ['exit', settled.resolve])
		})
		settled.resolve()
	}, timeout)
	child.once('exit', settled.resolve)
	return settled.promise.finally(() => clearTimeout(timer))
}

/**
 * Terminates one child process tree and reports whether its native exit was observed.
 *
 * @remarks
 * Windows ends the tree at once through {@link killTree}, falling back to a direct kill when the
 * utility fails, because the host has no cooperative termination to offer. A POSIX host signals the
 * process group `SIGTERM`, falls back to the direct child when no group owns its pid, waits `grace`,
 * then sends `SIGKILL` through the same route. No signal is initiated once the native exit is
 * observed; the window between initiating a signal and the host delivering it belongs to the
 * operating system. `confirm` bounds each awaited step rather than the call as a whole: on Windows
 * it bounds the `taskkill` call and then the final wait, and on a POSIX host `grace` bounds the
 * cooperative wait and `confirm` the final one. Never rejects.
 *
 * @param child - The child boundary
 * @param grace - The cooperative POSIX window in milliseconds between `SIGTERM` and `SIGKILL`
 * @param confirm - The milliseconds the native exit is awaited after the final kill
 * @returns True when the native exit was observed; false when `confirm` elapsed without it
 *
 * @example
 * ```ts
 * const confirmed = await stopChild(child, 5_000, 5_000)
 * ```
 */
export async function stopChild(
	child: ProcessChild,
	grace: number,
	confirm: number,
): Promise<boolean> {
	if (isExited(child)) return true
	if (process.platform === 'win32') {
		const killed = child.pid === undefined ? false : await killTree(child.pid, confirm)
		if (!killed && !isExited(child)) killProcess(child, 'SIGKILL')
	} else {
		killProcess(child, 'SIGTERM')
		await waitForExit(child, grace)
		if (!isExited(child)) killProcess(child, 'SIGKILL')
	}
	if (isExited(child)) return true
	await waitForExit(child, confirm)
	return isExited(child)
}

/**
 * Builds one settled {@link RunResult} from a completed run's captured bytes and terminal facts.
 *
 * @remarks
 * `failed` is derived: a run failed when it timed out, was aborted, ended on a host fault, was ended
 * by a signal, or exited with a code other than `0` — a `null` code from a spawn fault is therefore
 * a failure. Both byte fields are bounded by `limit` on a code-point boundary here, which is the one
 * place the captured bytes are decoded.
 *
 * @param input - The captured bytes, terminal state, and capture limit
 * @returns The frozen run outcome
 *
 * @example
 * ```ts
 * buildRunResult({
 * 	command: 'git status',
 * 	stdout: Buffer.from('ok'),
 * 	stderr: Buffer.alloc(0),
 * 	code: 0,
 * 	signal: null,
 * 	expired: false,
 * 	aborted: false,
 * 	truncated: false,
 * 	limit: 1_024,
 * }).failed // false
 * ```
 */
export function buildRunResult(input: RunInput): RunResult {
	return Object.freeze({
		command: input.command,
		stdout: trimHead(input.stdout, input.limit).toString('utf8'),
		stderr: trimHead(input.stderr, input.limit).toString('utf8'),
		code: input.code,
		signal: input.signal,
		failed:
			input.expired ||
			input.aborted ||
			input.cause !== undefined ||
			input.signal !== null ||
			input.code !== 0,
		expired: input.expired,
		aborted: input.aborted,
		truncated: input.truncated,
	})
}

/**
 * Runs one command to completion, buffering its output, and settles with the outcome.
 *
 * @remarks
 * The executable is resolved through {@link buildSpawn}, so no run uses a shell. On a POSIX host the
 * child is detached, which is what lets its whole process group be terminated. Standard output and
 * error are each byte-bounded by `limit` (default {@link PROCESS_OUTPUT}) and `truncated` reports
 * whether either stream exceeded it. A positive `timeout` and an aborting `signal` both terminate the
 * child through the same bounded stop, and only the first of them is recorded: a timeout reports
 * `expired` and an abort reports `aborted`, never both. After termination the outcome is awaited for
 * a bounded window, so a descendant holding the child's stdio cannot keep the run pending. That bound
 * covers a terminated run alone: a run with no `timeout` and no `signal` settles on stdio completion
 * rather than on process exit, so a descendant that inherited the child's stdio holds the run open
 * after the child itself has gone. Give such a run a `timeout`. The child's `environment` merges over
 * the parent unless the command is `isolated`, then `options.environment` on top, and `options.input`
 * overrides `command.input`. Unless `strict` is `false`, a failed run rejects with a
 * {@link createRunError} carrying the {@link RunResult}. An invalid option or command string rejects
 * before the child is spawned, because an async function cannot throw synchronously.
 *
 * @param command - The executable, arguments, and optional environment and input
 * @param options - Working directory, timeout, grace, signal, capture limit, and failure delivery
 * @returns The settled run outcome
 * @throws A {@link ProcessError} coded `invalid` for a malformed option, command string, or batch-bound argument, or one carrying the {@link RunResult} when the run failed and `strict` is not `false`
 *
 * @example
 * ```ts
 * const result = await run({ file: 'git', arguments: ['status'] }, { workspace: process.cwd() })
 * ```
 */
export async function run(command: ProcessCommand, options?: RunOptions): Promise<RunResult> {
	const file = command.file
	const argumentsList = Object.freeze([...command.arguments])
	const sourceEnvironment = command.environment
	const commandEnvironment =
		sourceEnvironment === undefined ? undefined : Object.freeze({ ...sourceEnvironment })
	const commandInput = command.input
	const isolated = command.isolated
	const snapshot: ProcessCommand = Object.freeze({
		file,
		arguments: argumentsList,
		...(commandEnvironment === undefined ? {} : { environment: commandEnvironment }),
		...(commandInput === undefined ? {} : { input: commandInput }),
		...(isolated === undefined ? {} : { isolated }),
	})
	validateCommand(snapshot)
	validateEnvironment(options?.environment)
	validateWorkspace(options?.workspace)
	validateTimer(options?.timeout, "option 'timeout'")
	validateTimer(options?.grace, "option 'grace'")
	validateBytes(options?.limit, "option 'limit'", 0)
	const limit = options?.limit ?? PROCESS_OUTPUT
	const grace = options?.grace ?? PROCESS_GRACE
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
	const settled = Promise.withResolvers<RunResult>()
	const terminate = new AbortController()
	const cleanup = new AbortController()
	const finish = new AbortController()
	const outChunks: Buffer[] = []
	const errChunks: Buffer[] = []
	const outCounts: number[] = [0, 0]
	const errCounts: number[] = [0, 0]
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
				buildRunResult({
					command: line,
					stdout: Buffer.concat(outChunks),
					stderr: Buffer.concat(errChunks),
					code: child.exitCode,
					signal: child.signalCode,
					expired,
					aborted,
					truncated: (outCounts[0] ?? 0) > limit || (errCounts[0] ?? 0) > limit,
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
	child.stdout.on('data', (chunk: unknown) => retainChunk(chunk, outChunks, outCounts, limit))
	child.stderr.on('data', (chunk: unknown) => retainChunk(chunk, errChunks, errCounts, limit))
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
	if (options?.signal !== undefined) {
		const signal = options.signal
		signal.addEventListener(
			'abort',
			() => {
				aborted = true
				terminate.abort()
			},
			{ once: true, signal: cleanup.signal },
		)
		if (signal.aborted) {
			aborted = true
			terminate.abort()
		}
	}

	const result = await settled.promise
	if (result.failed && strict) throw createRunError(result, cause)
	return result
}

/**
 * Runs one command to completion synchronously, buffering its output, and returns the outcome.
 *
 * @remarks
 * The synchronous counterpart of {@link run}, spawned through the same resolver and never through a
 * shell. The host offers no cooperative termination window and no in-flight cancellation, so this
 * contract carries neither. A positive `timeout` and an output overflow both end the child with
 * `SIGKILL`: an overflow reports `truncated` and `failed` together and trims the partial output to
 * `limit`, where {@link run} keeps reading and reports `truncated` without failing. The environment
 * and input follow the same merge as {@link run}. Unless `strict` is `false`, a failed run throws a
 * {@link createRunError} carrying the {@link RunResult}.
 *
 * @param command - The executable, arguments, and optional environment and input
 * @param options - Working directory, timeout, capture limit, and failure delivery
 * @returns The run outcome
 * @throws A {@link ProcessError} coded `invalid` for a malformed option, command string, or batch-bound argument, or one carrying the {@link RunResult} when the run failed and `strict` is not `false`
 *
 * @example
 * ```ts
 * const result = runSync({ file: 'git', arguments: ['--version'] }, { strict: false })
 * ```
 */
export function runSync(command: ProcessCommand, options?: RunSyncOptions): RunResult {
	const file = command.file
	const argumentsList = Object.freeze([...command.arguments])
	const sourceEnvironment = command.environment
	const commandEnvironment =
		sourceEnvironment === undefined ? undefined : Object.freeze({ ...sourceEnvironment })
	const commandInput = command.input
	const isolated = command.isolated
	const snapshot: ProcessCommand = Object.freeze({
		file,
		arguments: argumentsList,
		...(commandEnvironment === undefined ? {} : { environment: commandEnvironment }),
		...(commandInput === undefined ? {} : { input: commandInput }),
		...(isolated === undefined ? {} : { isolated }),
	})
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
		...(text !== undefined ? { input: text } : {}),
		...(timeout > 0 ? { timeout } : {}),
	})
	const error = outcome.error
	const fault = error !== undefined && 'code' in error && isString(error.code) ? error.code : ''
	const result = buildRunResult({
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
	if (result.failed && strict) throw createRunError(result, error)
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
	const file = command.file
	const argumentsList = Object.freeze([...command.arguments])
	const sourceEnvironment = command.environment
	const commandEnvironment =
		sourceEnvironment === undefined ? undefined : Object.freeze({ ...sourceEnvironment })
	const input = command.input
	const isolated = command.isolated
	const snapshot: ProcessCommand = Object.freeze({
		file,
		arguments: argumentsList,
		...(commandEnvironment === undefined ? {} : { environment: commandEnvironment }),
		...(input === undefined ? {} : { input }),
		...(isolated === undefined ? {} : { isolated }),
	})
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
