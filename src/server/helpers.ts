import type {
	DetachOptions,
	ExecutableOptions,
	ExecuteInput,
	ExecuteResult,
	ProcessCommand,
	SpawnInput,
} from '@src/core'
import type { ProcessChildInterface, ProcessMember, ProcessTask } from './types.js'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import { platform as hostPlatform } from 'node:process'
import {
	attempt,
	boundsOf,
	holds,
	isError,
	isNonEmptyString,
	isNonNegativeInteger,
	isString,
} from '@orkestrel/contract'
import {
	createInvalidError,
	PROCESS_ENDED,
	PROCESS_PATHEXT,
	PROCESS_TABLE,
	PROCESS_TIMER,
} from '@src/core'
import { snapshotCommand } from './cloners.js'
import { parseProcessStat } from './parsers.js'

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
	const offset = buffer.byteLength - limit
	const lead = buffer.subarray(offset).findIndex((byte) => (byte & 0xc0) !== 0x80)
	return Buffer.from(buffer.subarray(lead === -1 ? buffer.byteLength : offset + lead))
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
	for (const start of Array.from(
		{ length: Math.max(0, Math.floor(limit - floor)) },
		(_, index) => limit - 1 - index,
	)) {
		const lead = buffer[start]
		if (lead !== undefined && (lead & 0xc0) !== 0x80) {
			const span =
				(lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 1
			if (start + span > limit) return Buffer.from(buffer.subarray(0, start))
			break
		}
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
 * rather than two the host would resolve unpredictably. On every other platform the parent layer
 * drops each variable whose lower-cased name a key of `base` or `override` claims, an unset
 * included, because a tool such as npm reads its variables case-insensitively there too; the two
 * added layers keep their exact-case keys.
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
	const added = [base ?? {}, override ?? {}]
	const claimed = new Set(
		added.flatMap((layer) => Object.keys(layer).map((key) => key.toLowerCase())),
	)
	// Windows folds every layer in the following loop, so only another host needs the inherited fold.
	const inherited = isolated
		? {}
		: folded
			? parent
			: Object.fromEntries(
					Object.entries(parent).filter(([key]) => !claimed.has(key.toLowerCase())),
				)
	const layers: ReadonlyArray<Readonly<Record<string, string | undefined>>> = [inherited, ...added]
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
 * @returns True if the path resolves to a regular file; false otherwise
 *
 * @example
 * ```ts
 * namesFile(process.execPath) // true
 * ```
 */
export function namesFile(target: string): boolean {
	return holds(() => statSync(target, { throwIfNoEntry: false })?.isFile() === true)
}

/**
 * Builds the executable candidates an explicit platform would search.
 *
 * @remarks
 * Windows alone needs this list: the host searches the working directory before `PATH` and applies
 * `PATHEXT`, and Node reproduces neither for a direct spawn. Within each searched directory,
 * {@link buildExecutableCandidates} enumerates `PATHEXT` candidates for an extensionless name. For
 * an extension-bearing name, it enumerates the literal path before `PATHEXT` candidates, so
 * `report.txt` resolves to a `report.txt` file where one exists and to `report.txt.cmd` where none
 * does. The lookup reads the child's effective environment, so an overridden `PATH` selects the
 * executable the child would have found. A POSIX host resolves the file itself, so the candidate
 * list there is empty. A `PATHEXT` candidate keeps the extension spelling from `PATHEXT`, which the
 * case-insensitive host treats as the same file. A non-Windows platform returns an empty list
 * because `execvp` performs its own lookup.
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
	const candidates =
		win32.extname(file).length === 0
			? extensions.map((extension) => `${file}${extension}`)
			: [file, ...extensions.map((extension) => `${file}${extension}`)]
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
 * Resolves a command file to the executable path the host would launch, or to `undefined` on a POSIX
 * host, which performs its own lookup.
 *
 * @remarks
 * A Windows lookup miss also returns `undefined`. {@link buildSpawn} preserves the command file as
 * written for native spawning.
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
		if (namesFile(target)) return target
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
 * @remarks
 * When executable lookup returns no regular-file candidate, {@link buildSpawn} preserves the
 * command file as written for native spawning.
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
 * @returns True if the process has exited; false otherwise
 *
 * @example
 * ```ts
 * isExited({ exitCode: 0, signalCode: null }) // true
 * ```
 */
export function isExited(child: Pick<ProcessChildInterface, 'exitCode' | 'signalCode'>): boolean {
	return child.exitCode !== null || child.signalCode !== null
}

/**
 * Scans the state of every thread of one process from a process table.
 *
 * @param pid - The process id, as the table's entry names it
 * @param table - The process table's root. Default: {@link PROCESS_TABLE}
 * @returns One task per thread, or `undefined` when the thread listing fails, lists no thread, or
 * holds a thread whose `stat` cannot be read or parsed
 *
 * @example
 * ```ts
 * scanProcessThreads(String(process.pid)) // [{ id: '<pid>/<pid>', state: 'R' }, ...] on Linux
 * ```
 */
export function scanProcessThreads(
	pid: string,
	table: string = PROCESS_TABLE,
): readonly ProcessTask[] | undefined {
	const listing = attempt(() => readdirSync(join(table, pid, 'task')))
	if (!listing.success || listing.value.length === 0) return undefined
	const tasks = listing.value.map((tid) => {
		const text = attempt(() => readFileSync(join(table, pid, 'task', tid, 'stat'), 'utf8'))
		const stat = text.success ? parseProcessStat(text.value) : undefined
		return stat === undefined
			? undefined
			: Object.freeze({ id: `${pid}/${tid}`, state: stat.state })
	})
	return tasks.every((task) => task !== undefined) ? Object.freeze(tasks) : undefined
}

/**
 * Scans the members of one process group from a process table, each with its start time.
 *
 * @remarks
 * A group's members are the entries whose `stat` names the group. An entry whose `stat` is gone
 * (`ENOENT`) is a process that ended after the listing, and it is skipped; any other entry that
 * cannot be read leaves the whole scan unread, because it might be a member.
 *
 * @param group - The positive process-group id
 * @param table - The process table's root. Default: {@link PROCESS_TABLE}
 * @returns The members found, or `undefined` when the table or an entry cannot be read
 *
 * @example
 * ```ts
 * scanGroupMembers(process.pid) // the members of the group this process leads, on Linux
 * ```
 */
export function scanGroupMembers(
	group: number,
	table: string = PROCESS_TABLE,
): readonly ProcessMember[] | undefined {
	const listing = attempt(() => readdirSync(table))
	if (!listing.success) return undefined
	const entries = listing.value
		.filter((name) => /^\d+$/u.test(name))
		.map((name) => {
			const text = attempt(() => readFileSync(join(table, name, 'stat'), 'utf8'))
			if (!text.success) {
				const code = isError(text.error) && 'code' in text.error ? text.error.code : undefined
				return code === 'ENOENT' ? [] : undefined
			}
			const stat = parseProcessStat(text.value)
			if (stat === undefined) return undefined
			return stat.group === group ? [Object.freeze({ pid: Number(name), start: stat.start })] : []
		})
	return entries.every((entry) => entry !== undefined) ? Object.freeze(entries.flat()) : undefined
}

/**
 * Scans every thread of one process, or of every member of one process group, from a process table.
 *
 * @remarks
 * {@link scanGroupMembers} finds a group's members; any member whose threads cannot be read leaves
 * the whole scan unread.
 *
 * @param pid - A positive process id, or a negative process-group id
 * @param table - The process table's root. Default: {@link PROCESS_TABLE}
 * @returns The threads found, or `undefined` when the table, an entry, or a member's threads cannot be read
 *
 * @example
 * ```ts
 * scanProcessTasks(-process.pid) // the threads of the group this process leads, on Linux
 * ```
 */
export function scanProcessTasks(
	pid: number,
	table: string = PROCESS_TABLE,
): readonly ProcessTask[] | undefined {
	if (pid > 0) return scanProcessThreads(String(pid), table)
	const members = scanGroupMembers(-pid, table)
	if (members === undefined) return undefined
	const threads = members.map((member) => scanProcessThreads(String(member.pid), table))
	return threads.every((thread) => thread !== undefined) ? Object.freeze(threads.flat()) : undefined
}

/**
 * Checks whether a process table numbers processes the way this process signals them.
 *
 * @remarks
 * A table mounted from another PID namespace numbers its entries in that namespace, so they say
 * nothing about the ids this process signals. Such a table's `self/stat` names a pid other than
 * `process.pid`. A `self/stat` that cannot be read, or whose leading pid field is not this
 * process's, reads as a table to distrust.
 *
 * @param table - The process table's root. Default: {@link PROCESS_TABLE}
 * @returns True if `<table>/self/stat` names `process.pid`; false otherwise
 *
 * @example
 * ```ts
 * matchesOwnTable() // true on Linux, where /proc belongs to this namespace
 * ```
 */
export function matchesOwnTable(table: string = PROCESS_TABLE): boolean {
	const text = attempt(() => readFileSync(join(table, 'self', 'stat'), 'utf8'))
	return text.success && text.value.split(' ', 1)[0] === String(process.pid)
}

/**
 * Checks whether the mount of a process table hides other users' processes from this reader.
 *
 * @remarks
 * A `proc` mount with `hidepid` set to anything but `0` or `off` lists only this user's
 * processes, so a live member of a group can be missing from a reading of that group. The option
 * is read from the last `<table>/self/mountinfo` line whose mount point is `table`, in its
 * per-mount or its file-system options; a mount point's octal escapes are decoded first. A
 * `mountinfo` that cannot be read, or that lists no mount at `table`, reads as hiding.
 *
 * @param table - The process table's root. Default: {@link PROCESS_TABLE}
 * @returns True if the mount hides processes or cannot be read; false otherwise
 *
 * @example
 * ```ts
 * matchesTableHidden() // false on a /proc mounted without hidepid
 * ```
 */
export function matchesTableHidden(table: string = PROCESS_TABLE): boolean {
	const text = attempt(() => readFileSync(join(table, 'self', 'mountinfo'), 'utf8'))
	if (!text.success) return true
	const mount = text.value
		.split(/\r\n|\n/u)
		.map((line) => line.split(' '))
		.filter(
			(fields) =>
				fields[4]?.replaceAll(/\\([0-7]{3})/gu, (_, code: string) =>
					String.fromCodePoint(Number.parseInt(code, 8)),
				) === table,
		)
		.at(-1)
	if (mount === undefined) return true
	const options = [
		...(mount[5] ?? '').split(','),
		...(mount[mount.indexOf('-') + 3] ?? '').split(','),
	]
	return options.some(
		(option) => option.startsWith('hidepid=') && !['0', 'off'].includes(option.slice(8)),
	)
}

/**
 * Checks whether two process-table readings show the same threads, every one of them exited.
 *
 * @remarks
 * A thread read as exited cannot create another thread or process after that read, so a thread a
 * live member created during the first reading appears in the second. An empty reading never
 * matches, because the probe signal reached a process the table did not show, as a table from
 * another PID namespace does.
 *
 * @param first - The first reading
 * @param second - The reading taken after the first finished
 * @returns True if both readings hold a thread, list the same thread keys, and show every thread in a {@link PROCESS_ENDED} state; false otherwise
 *
 * @example
 * ```ts
 * matchesEndedTasks([{ id: '7/7', state: 'Z' }], [{ id: '7/7', state: 'Z' }]) // true
 * ```
 */
export function matchesEndedTasks(
	first: readonly ProcessTask[],
	second: readonly ProcessTask[],
): boolean {
	return (
		first.length > 0 &&
		first
			.map((task) => task.id)
			.toSorted()
			.join(' ') ===
			second
				.map((task) => task.id)
				.toSorted()
				.join(' ') &&
		[...first, ...second].every((task) => PROCESS_ENDED.includes(task.state))
	)
}

/**
 * Checks whether a process or a process group has ended while the host still answers its id.
 *
 * @remarks
 * A signal reaches a zombie, so a process or group whose every thread has exited still answers the
 * probe signal until its parent reaps it, and an init that never reaps leaves it that way. Where
 * the host publishes a process table, two scans taken one after the other decide, per
 * {@link matchesEndedTasks}. A process whose main thread exited while another thread runs reads as
 * live through that thread. A group reads as live while {@link matchesTableHidden} reports that the
 * table hides processes, because a hidden member can be live. A host without the table, a table
 * {@link matchesOwnTable} distrusts, and a scan that cannot read part of it read nothing as ended.
 *
 * @param pid - A positive process id, or a negative process-group id
 * @param table - The process table's root. Default: {@link PROCESS_TABLE}
 * @param scan - Takes one scan of the threads; `undefined` means it could not read the table. Default: {@link scanProcessTasks}
 * @returns True if the table shows every thread exited; false otherwise, including when it cannot tell
 *
 * @example
 * ```ts
 * matchesProcessEnded(process.pid) // false
 * ```
 */
export function matchesProcessEnded(
	pid: number,
	table: string = PROCESS_TABLE,
	scan: (pid: number, table: string) => readonly ProcessTask[] | undefined = scanProcessTasks,
): boolean {
	if (!matchesOwnTable(table)) return false
	if (pid < 0 && matchesTableHidden(table)) return false
	const first = scan(pid, table)
	if (first === undefined) return false
	const second = scan(pid, table)
	return second !== undefined && matchesEndedTasks(first, second)
}

/**
 * Checks whether a process group still holds a member a snapshot of that group named.
 *
 * @remarks
 * A process id and its start time together name one process for the host's whole uptime, so a
 * group that holds a member with both values identical to a snapshot entry is the group the
 * snapshot was taken of, even after its leader's id was freed. An empty snapshot, a table
 * {@link matchesOwnTable} distrusts, and a scan that cannot read the table match nothing.
 *
 * @param group - The positive process-group id
 * @param members - The snapshot, as {@link collectGroupMembers} took it
 * @param table - The process table's root. Default: {@link PROCESS_TABLE}
 * @returns True if a member with an identical id and start time remains in the group; false otherwise
 *
 * @example
 * ```ts
 * matchesGroupMembers(4242, []) // false
 * ```
 */
export function matchesGroupMembers(
	group: number,
	members: readonly ProcessMember[],
	table: string = PROCESS_TABLE,
): boolean {
	if (members.length === 0 || !matchesOwnTable(table)) return false
	const current = scanGroupMembers(group, table)
	return (
		current !== undefined &&
		current.some((member) =>
			members.some((known) => known.pid === member.pid && known.start === member.start),
		)
	)
}

/**
 * Collects the members of the POSIX process group an exited child led, as of the call.
 *
 * @remarks
 * Call it when the child's exit is observed, while the host still reserves the group's id for the
 * members that remain. It returns no member on Windows, for a child without a pid, when the group
 * no longer answers the probe signal, when {@link matchesOwnTable} distrusts the table, and when
 * the table cannot be read, so a later
 * {@link stopGroup} signals nothing then.
 *
 * @param child - The child boundary, which led its own process group
 * @param table - The process table's root. Default: {@link PROCESS_TABLE}
 * @returns The group's members with their start times, or none
 *
 * @example
 * ```ts
 * child.once('exit', () => collectGroupMembers(child))
 * ```
 */
export function collectGroupMembers(
	child: Pick<ProcessChildInterface, 'pid'>,
	table: string = PROCESS_TABLE,
): readonly ProcessMember[] {
	const group = child.pid
	if (process.platform === 'win32' || group === undefined) return Object.freeze([])
	if (!holds(() => process.kill(-group, 0)) || !matchesOwnTable(table)) return Object.freeze([])
	return scanGroupMembers(group, table) ?? Object.freeze([])
}

/**
 * Reports whether a process or POSIX process group still exists.
 *
 * @param pid - A positive process id, or a negative POSIX process-group id
 * @returns True when the host confirms existence or refuses permission and {@link matchesProcessEnded} reads no exit; false for ESRCH or an exited zombie; undefined for another host failure
 * @throws A {@link ProcessError} coded `invalid` for an unsafe integer, zero, minus one, or a negative id on Windows
 * @remarks Negative ids probe POSIX process groups. The `process.platform` branch refuses negative ids on Windows, where the host supports positive process ids only. A zombie answers the probe signal, so an id the host answers reads as ended when the host's process table shows every thread of the process, or of every group member, exited, per {@link matchesProcessEnded}; a group read through a mount that hides processes, and a host without that table, keep the signal's answer.
 * @example
 * ```ts
 * inspectProcess(process.pid) // true
 * ```
 */
export function inspectProcess(pid: number): boolean | undefined {
	if (
		!Number.isSafeInteger(pid) ||
		pid === 0 ||
		pid === -1 ||
		(process.platform === 'win32' && pid < 0)
	) {
		throw createInvalidError('process id', pid)
	}
	try {
		process.kill(pid, 0)
	} catch (error) {
		const code = isError(error) && 'code' in error ? error.code : undefined
		if (code !== 'EPERM') return code === 'ESRCH' ? false : undefined
	}
	return !matchesProcessEnded(pid)
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
	child: Pick<ProcessChildInterface, 'pid' | 'kill'>,
	signal: NodeJS.Signals,
): void {
	try {
		if (process.platform === 'win32' || child.pid === undefined) {
			child.kill(signal)
			return
		}
		process.kill(-child.pid, signal)
	} catch (error) {
		if (isError(error) && 'code' in error && error.code === 'ESRCH') {
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
 * @returns True if the utility reported success; false otherwise (it failed, was unavailable, or was cut off)
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
	child: Pick<ProcessChildInterface, 'exitCode' | 'signalCode' | 'once' | 'off'>,
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
 * @returns True if the host close arrived inside the deadline; false otherwise
 *
 * @example
 * ```ts
 * const closed = await waitForClose(child, 5_000)
 * ```
 */
export function waitForClose(
	child: Pick<ProcessChildInterface, 'once' | 'off'>,
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
 * @returns True if the native exit was observed; false otherwise (`confirm` elapsed without it)
 *
 * @example
 * ```ts
 * const confirmed = await stopChild(child, 5_000, 5_000)
 * ```
 */
export async function stopChild(
	child: ProcessChildInterface,
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
 * Terminates the POSIX process group an exited child led, while the group still has a member.
 *
 * @remarks
 * Prerequisite: the child was spawned `detached` on a POSIX host, so it led its own process group
 * and that group is not the caller's, and `members` is the snapshot {@link collectGroupMembers} took
 * when the child's exit was observed. After every member has left a group, the host can hand its id
 * to an unrelated group, so the id alone names nothing after the child's exit. Before each signal
 * this checks that {@link inspectProcess} reports a member that has not exited, and then, last,
 * that {@link matchesGroupMembers} finds a member of the snapshot, with an identical id and start
 * time, still in the group, so one identity scan is all that separates that check from the
 * signal. The group receives `SIGTERM`, then `SIGKILL` when both still hold after `grace` or after
 * the child's read ends close, whichever comes first. An empty or unreadable snapshot signals
 * nothing, and so does a host without a process table of its own. A descendant forked after the
 * child's exit is reached only while a snapshot member remains in the group, so after every
 * snapshot member, its own ancestors included, has ended, it is not reached. Windows has no
 * process group, and `taskkill` walks only a live root's tree, so this returns immediately there;
 * it also returns immediately while the child has not exited, because {@link stopChild} owns that
 * termination. Never rejects.
 *
 * @param child - The child boundary, which led its own process group
 * @param grace - The cooperative window in milliseconds between `SIGTERM` and `SIGKILL`
 * @param members - The group snapshot taken when the child's exit was observed
 * @returns Nothing
 *
 * @example
 * ```ts
 * const members = collectGroupMembers(child) // when the child's exit is observed
 * await stopGroup(child, 5_000, members)
 * ```
 */
export async function stopGroup(
	child: ProcessChildInterface,
	grace: number,
	members: readonly ProcessMember[],
): Promise<void> {
	const group = child.pid
	if (process.platform === 'win32' || group === undefined || !isExited(child)) return
	// The identity scan runs last in each gate, so only that one scan separates it from the signal.
	if (inspectProcess(-group) !== true || !matchesGroupMembers(group, members)) return
	killProcess(child, 'SIGTERM')
	await waitForClose(child, grace)
	if (inspectProcess(-group) === true && matchesGroupMembers(group, members)) {
		killProcess(child, 'SIGKILL')
	}
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
