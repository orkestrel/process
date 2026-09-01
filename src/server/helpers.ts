import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
	DetachOptions,
	ExecutableOptions,
	ExecuteInput,
	ExecuteOptions,
	ExecuteResult,
	ExecuteSyncOptions,
	ProcessCommand,
	SpawnInput,
} from '@src/core'
import type { ProcessChild } from './types.js'
import { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import { platform as hostPlatform } from 'node:process'
import {
	boundsOf,
	holds,
	isNonEmptyString,
	isNonNegativeInteger,
	isString,
} from '@orkestrel/contract'
import {
	createExecuteError,
	createInvalidError,
	PROCESS_CONFIRMATION,
	PROCESS_GRACE,
	PROCESS_OUTPUT,
	PROCESS_PATHEXT,
	PROCESS_TIMER,
	ProcessError,
} from '@src/core'
import { snapshotCommand } from './cloners.js'

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
 * Keeps the head — the captured start of a one-shot run's output. The end retreats only when a
 * sequence genuinely spans the cut: the byte at `limit` carries the continuation bit pattern, and a
 * lead byte within the preceding three bytes declares a length that reaches it. The retained bytes
 * then end on a code-point boundary and decode without a replacement character. A byte at `limit`
 * that carries the continuation pattern without such a lead byte is invalid UTF-8 rather than a
 * split sequence, so the full `limit` survives instead of a valid byte being dropped for it.
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
	const excluded = buffer[limit]
	if (excluded === undefined || (excluded & 0xc0) !== 0x80)
		return Buffer.from(buffer.subarray(0, limit))
	// A lead byte opens at most a four-byte sequence, so only the three bytes before the cut can hold
	// the lead of a sequence that reaches it.
	const floor = Math.max(0, limit - 3)
	let start = limit - 1
	while (start >= floor) {
		const lead = buffer[start]
		if (lead !== undefined && (lead & 0xc0) !== 0x80) {
			let span = 1
			if ((lead & 0xe0) === 0xc0) span = 2
			else if ((lead & 0xf0) === 0xe0) span = 3
			else if ((lead & 0xf8) === 0xf0) span = 4
			if (start + span > limit) return Buffer.from(buffer.subarray(0, start))
			break
		}
		start -= 1
	}
	return Buffer.from(buffer.subarray(0, limit))
}

/**
 * Bounds one delivered stream chunk to the bytes a capture still has room for.
 *
 * @remarks
 * A chunk that is not a buffer contributes nothing and reports `undefined` rather than throwing,
 * because a stream `data` listener receives an `unknown` payload. The cut is byte-exact and might
 * land inside a multibyte sequence, because {@link buildExecuteResult} performs the single
 * code-point-boundary trim over the whole capture rather than over each chunk. Give the capture one
 * byte more room than its limit, so that final trim can read the first excluded byte and retreat off
 * a split sequence. A chunk that fits its room is returned as the delivered buffer itself rather
 * than a copy, because a capture appending it copies again and never writes through it; a chunk that
 * overruns its room returns a copy of the bytes that fit. Treat the return as read-only either way.
 *
 * @param chunk - The delivered chunk, ignored when it is not a buffer
 * @param room - The bytes the capture still accepts
 * @returns The bytes to retain, or `undefined` when the chunk contributes none
 *
 * @example
 * ```ts
 * captureChunk(Buffer.from('hello'), 3) // <Buffer 68 65 6c>
 * ```
 */
export function captureChunk(chunk: unknown, room: number): Buffer | undefined {
	if (!Buffer.isBuffer(chunk) || room <= 0) return undefined
	if (chunk.byteLength <= room) return chunk
	return Buffer.from(chunk.subarray(0, room))
}

/**
 * Renders one command into its diagnostic command line.
 *
 * @param command - The executable and its argument vector
 * @returns The space-joined command line, for an {@link ExecuteResult} and error messages
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
 * Reads one environment variable under an explicit platform's key rules.
 *
 * @remarks
 * Windows environment keys are case-insensitive, so a merged record can hold `Path` where the
 * caller asks for `PATH`. The exact key is tried first and a folded scan runs only for `win32`.
 *
 * @param environment - The environment record to read
 * @param name - The variable name
 * @param platform - The platform whose key rules apply
 * @returns The value, or `undefined` when the environment declares no such variable
 *
 * @example
 * ```ts
 * readPlatformVariable({ Path: 'C:\\Windows' }, 'PATH', 'win32') // 'C:\\Windows'
 * ```
 */
export function readPlatformVariable(
	environment: Readonly<Record<string, string | undefined>>,
	name: string,
	platform: NodeJS.Platform,
): string | undefined {
	const direct = environment[name]
	if (direct !== undefined) return direct
	if (platform !== 'win32') return undefined
	const target = name.toUpperCase()
	for (const [key, value] of Object.entries(environment)) {
		if (key.toUpperCase() === target) return value
	}
	return undefined
}

/**
 * Reads one environment variable the way the current host resolves it.
 *
 * @param environment - The environment record to read
 * @param name - The variable name
 * @returns The value, or `undefined` when the environment declares no such variable
 *
 * @example
 * ```ts
 * readVariable({ PATH: '/usr/bin' }, 'PATH') // '/usr/bin'
 * ```
 */
export function readVariable(
	environment: Readonly<Record<string, string | undefined>>,
	name: string,
): string | undefined {
	return readPlatformVariable(environment, name, hostPlatform)
}

/**
 * Merges environment layers under an explicit platform's key rules.
 *
 * @remarks
 * Later maps override earlier ones and an `undefined` value unsets a key. For `win32` the keys fold
 * case-insensitively and the last writer wins, so `PATH` followed by `Path` yields one variable
 * rather than two the host would resolve unpredictably.
 *
 * @param platform - The platform whose key rules apply
 * @param parent - The parent environment layer
 * @param isolated - If `true`, the parent environment is excluded; if `false`, the overrides layer over it
 * @param base - The command's own environment overrides
 * @param override - Per-invocation overrides applied last
 * @returns The environment for a spawn, carrying no unset key
 *
 * @example
 * ```ts
 * mergePlatformEnvironment('linux', {}, false, { TOKEN: 'a' }, { TOKEN: undefined }) // TOKEN unset
 * ```
 */
export function mergePlatformEnvironment(
	platform: NodeJS.Platform,
	parent: Readonly<Record<string, string | undefined>>,
	isolated: boolean,
	base?: Readonly<Record<string, string | undefined>>,
	override?: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
	const folded = platform === 'win32'
	const layers: ReadonlyArray<Readonly<Record<string, string | undefined>>> = [
		isolated ? {} : parent,
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
 * Merges environment overrides into the environment one child receives on the current host.
 *
 * @param isolated - If `true`, the parent environment is excluded; if `false`, the overrides layer over it
 * @param base - The command's own environment overrides
 * @param override - Per-invocation overrides applied last
 * @returns The environment for a spawn, carrying no unset key
 *
 * @example
 * ```ts
 * mergeEnvironment(true, { TOKEN: 'a' }) // { TOKEN: 'a' }
 * ```
 */
export function mergeEnvironment(
	isolated: boolean,
	base?: Readonly<Record<string, string | undefined>>,
	override?: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
	return mergePlatformEnvironment(hostPlatform, process.env, isolated, base, override)
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
 * Builds the executable candidates an explicit platform would search.
 *
 * @remarks
 * Windows alone needs this list: the host searches the working directory before `PATH` and applies
 * `PATHEXT`, and Node reproduces neither for a direct spawn. Within each searched directory the
 * literal name is tried first and each `PATHEXT` candidate after it, whether or not the name already
 * carries an extension — so `report.txt` resolves to a `report.txt` file where one exists and to
 * `report.txt.cmd` where none does. The lookup reads the child's effective environment, so an
 * overridden `PATH` selects the executable the child would have found. A POSIX host resolves the
 * file itself, so the candidate list there is empty. An appended extension is spelled the way
 * `PATHEXT` spells it rather than the way the directory entry does, which the case-insensitive host
 * treats as the same file. A non-Windows platform returns an empty list because `execvp` performs
 * its own lookup.
 *
 * @param file - The command executable name or path
 * @param workspace - The directory searched first
 * @param environment - The child's effective environment
 * @param platform - The platform whose lookup rules apply
 * @returns The ordered absolute candidate paths
 *
 * @example
 * ```ts
 * buildExecutableCandidates('git', 'C:\\work', { PATH: 'C:\\bin' }, 'win32')
 * ```
 */
export function buildExecutableCandidates(
	file: string,
	workspace: string,
	environment: Readonly<Record<string, string | undefined>>,
	platform: NodeJS.Platform,
): readonly string[] {
	if (platform !== 'win32') return Object.freeze([])
	const extensions = (readPlatformVariable(environment, 'PATHEXT', platform) ?? PROCESS_PATHEXT)
		.split(';')
		.filter((extension) => extension.length > 0)
	const candidates = [file, ...extensions.map((extension) => `${file}${extension}`)]
	const rooted = file.includes('/') || file.includes('\\')
	const directories = rooted
		? [workspace]
		: [workspace, ...(readPlatformVariable(environment, 'PATH', platform) ?? '').split(';')]
	const targets: string[] = []
	for (const directory of directories) {
		if (directory.length === 0) continue
		for (const candidate of candidates) {
			targets.push(win32.resolve(directory, candidate))
		}
	}
	return Object.freeze(targets)
}

/**
 * Resolves a command file to the executable path the host would launch.
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
	const environment = options?.environment ?? process.env
	const workspace = options?.workspace ?? process.cwd()
	const candidates = buildExecutableCandidates(file, workspace, environment, hostPlatform)
	for (const target of candidates) {
		if (isFile(target)) return target
	}
	return undefined
}

/**
 * Quotes one command-line token for a `cmd.exe` command line.
 *
 * @remarks
 * A token carrying whitespace or a shell metacharacter is wrapped in double quotes so `cmd.exe`
 * passes it as one literal argument; an embedded double quote is doubled, which is how `cmd.exe`
 * reads a literal quote inside a quoted token. The quoted set includes `%`, although quoting cannot
 * stop `cmd.exe` expansion; {@link buildSpawn} therefore refuses `%` in an argument to a Windows
 * batch target.
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
 * Builds a spawn form from a resolved file and an explicit platform.
 *
 * @remarks
 * A resolved `.cmd` or `.bat` script cannot be spawned directly **on Windows**, so it runs there
 * through an explicitly quoted `cmd.exe /d /s /c` command line with the argument vector passed
 * verbatim. No path uses a shell, so a metacharacter in an argument is never interpreted. `cmd.exe`
 * expands `%NAME%` before it parses quotes, so no quoting can carry a percent sign through to a
 * Windows batch target: an argument carrying one is refused there rather than silently rewritten.
 * The whole batch path is Windows-only. A POSIX host has no `cmd.exe` and no restriction on spawning
 * a file directly, so a target named `worker.cmd` spawns directly there and receives a percent sign
 * as literal text.
 *
 * @param command - The executable and its argument vector
 * @param file - The resolved executable file
 * @param environment - The child's effective environment
 * @param platform - The platform whose batch rules apply
 * @returns The file, argument vector, and verbatim flag to spawn with
 * @throws A {@link ProcessError} coded `invalid` when `platform` is `win32`, the resolved target is a batch script, and an argument carries a percent sign
 *
 * @example
 * ```ts
 * buildPlatformSpawn({ file: 'node', arguments: ['--version'] }, 'node', {}, 'linux').verbatim // false
 * ```
 */
export function buildPlatformSpawn(
	command: ProcessCommand,
	file: string,
	environment: Readonly<Record<string, string | undefined>>,
	platform: NodeJS.Platform,
): SpawnInput {
	const extension = (platform === 'win32' ? win32.extname(file) : posix.extname(file)).toLowerCase()
	// Windows alone cannot spawn a batch script directly, and `cmd.exe` is what expands `%NAME%`.
	// A POSIX host has neither restriction, so a file whose name ends in `.cmd` is an ordinary
	// executable there and its extension changes nothing about how it spawns.
	const batch = platform === 'win32' && (extension === '.cmd' || extension === '.bat')
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
	return Object.freeze({
		file: readPlatformVariable(environment, 'ComSpec', platform) ?? 'cmd.exe',
		arguments: Object.freeze(['/d', '/s', '/c', `"${line}"`]),
		verbatim: true,
	})
}

/**
 * Builds the resolved spawn form of one command for the current host.
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
	const environment = options?.environment ?? process.env
	return buildPlatformSpawn(command, file, environment, hostPlatform)
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
	child: Pick<ProcessChild, 'exitCode' | 'signalCode' | 'once' | 'off'>,
	timeout: number,
): Promise<void> {
	if (isExited(child)) return Promise.resolve()
	const settled = Promise.withResolvers<void>()
	const timer = setTimeout(() => {
		child.off('exit', settled.resolve)
		settled.resolve()
	}, timeout)
	child.once('exit', settled.resolve)
	return settled.promise.finally(() => clearTimeout(timer))
}

/**
 * Waits for one child process's streams to close, bounded by a deadline.
 *
 * @param child - The child boundary
 * @param timeout - The milliseconds to wait before giving up
 * @returns True when the host close arrived inside the deadline; false otherwise
 *
 * @example
 * ```ts
 * const closed = await waitForClose(child, 5_000)
 * ```
 */
export function waitForClose(
	child: Pick<ProcessChild, 'once' | 'off'>,
	timeout: number,
): Promise<boolean> {
	const closed = Promise.withResolvers<void>()
	const expired = Promise.withResolvers<boolean>()
	const timer = setTimeout(() => expired.resolve(false), timeout)
	child.once('close', closed.resolve)
	return Promise.race([closed.promise.then(() => true), expired.promise]).finally(() => {
		clearTimeout(timer)
		child.off('close', closed.resolve)
	})
}

/**
 * Terminates one child process tree and reports whether its native exit was observed.
 *
 * @remarks
 * An already-exited child is returned on before any route to its pid runs, because the host has
 * reaped that number and may have handed it to another process. Windows ends the whole tree at once
 * through {@link killTree}, falling back to a direct kill after the utility fails, because the host
 * has no cooperative termination to offer. A POSIX host signals the process group `SIGTERM`, falls
 * back to the direct child when no group owns its pid, waits `grace`, then sends `SIGKILL` through
 * the same route. No signal is initiated after the native exit is observed; the window between
 * initiating a signal and the host delivering it belongs to the operating system. `confirm` bounds
 * each awaited step rather than the call as a whole: on Windows it bounds the `taskkill` call and
 * then the final wait, and on a POSIX host `grace` bounds the cooperative wait and `confirm` the
 * final one. Never rejects.
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
 * Builds one settled {@link ExecuteResult} from a completed run's captured bytes and terminal facts.
 *
 * @remarks
 * `failed` is derived: a run failed when it timed out, was aborted, ended on a host fault, was ended
 * by a signal, or exited with a code other than `0` — a `null` code from a spawn fault is therefore
 * a failure. Each byte field is bounded by `limit` on a code-point boundary here, which is the one
 * place the captured bytes are decoded.
 *
 * @param input - The captured bytes, terminal state, and capture limit
 * @returns The frozen run outcome
 *
 * @example
 * ```ts
 * buildExecuteResult({
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
export function buildExecuteResult(input: ExecuteInput): ExecuteResult {
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
	let spawned = false
	let expired = false
	let aborted = false
	let outRetained = 0
	let errRetained = 0
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
					truncated: outRetained > limit || errRetained > limit,
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
		const captured = captureChunk(chunk, limit + 1 - outRetained)
		if (captured === undefined) return
		outRetained += captured.byteLength
		outChunks.push(captured)
	})
	child.stderr.on('data', (chunk: unknown) => {
		const captured = captureChunk(chunk, limit + 1 - errRetained)
		if (captured === undefined) return
		errRetained += captured.byteLength
		errChunks.push(captured)
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
	const optionWorkspace = options?.workspace
	validateCommand(snapshot)
	validateWorkspace(optionWorkspace)
	const workspace = optionWorkspace ?? process.cwd()
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
