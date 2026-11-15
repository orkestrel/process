import type { ProcessCommand } from '@src/core'
import { join } from 'node:path'

/**
 * Resolves the self-contained child-process fixture entrypoint.
 *
 * @returns The absolute path to the spawnable fixture
 */
export function resolveChildFixture(): string {
	return join(process.cwd(), 'tests', 'src', 'server', 'fixtures', 'child.mjs')
}

/**
 * Builds a command that drives the child fixture in one of its behavior modes.
 *
 * @param mode - The fixture behavior mode
 * @param detail - An optional per-mode argument, such as an exit code
 * @returns The spawnable command for the current Node runtime
 */
export function childCommand(mode: string, detail?: string): ProcessCommand {
	const argumentsList =
		detail === undefined ? [resolveChildFixture(), mode] : [resolveChildFixture(), mode, detail]
	return { file: process.execPath, arguments: argumentsList }
}

// The members each factory's return must carry, read off the interface each one declares as its
// return type. A factory that returned the wrong entity, or a class that lost a member, fails here
// rather than at the first call site that reaches for one.
export const PROCESS_MEMBERS: readonly string[] = Object.freeze([
	'pid',
	'code',
	'signal',
	'emitter',
	'lines',
	'evidence',
	'truncated',
	'settled',
	'terminated',
	'exit',
	'send',
	'stop',
	'destroy',
])
export const DUPLEX_MEMBERS: readonly string[] = Object.freeze([
	'pid',
	'code',
	'signal',
	'emitter',
	'evidence',
	'settled',
	'terminated',
	'ended',
	'exit',
	'write',
	'end',
	'stop',
	'destroy',
])
export const MANAGER_MEMBERS: readonly string[] = Object.freeze([
	'emitter',
	'count',
	'process',
	'processes',
	'launch',
	'stop',
	'destroy',
])

/**
 * Builds one process-table `stat` line in the layout Linux publishes, for an inert table fixture.
 *
 * @param pid - The process id the line opens with
 * @param command - The command name, written inside parentheses
 * @param state - The one-letter scheduler state
 * @param group - The process-group id
 * @param start - The start time in clock ticks, `stat` field 22
 * @returns The line, with the parent id `1` and every other field zero or its idle value
 */
export function buildProcessStat(
	pid: number,
	command: string,
	state: string,
	group: number,
	start: number,
): string {
	return `${String(pid)} (${command}) ${state} 1 ${String(group)} ${String(group)} 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 ${String(start)} 0 0`
}

/**
 * Builds the `self/mountinfo` line of a `proc` mount at a table root, for an inert table fixture.
 *
 * @param table - The mount point, which a process-table reader compares with its table root; each
 * space is written as the `\040` escape the kernel writes
 * @param options - The file-system options, such as `rw,hidepid=2`
 * @param optional - The optional fields before the `-` separator, such as `shared:12`. Default: none
 * @returns The line, ending in a line feed
 */
export function buildProcessMount(table: string, options: string, optional?: string): string {
	const point = table.replaceAll(' ', '\\040')
	const fields = optional === undefined ? '' : ` ${optional}`
	return `22 27 0:21 / ${point} rw,relatime${fields} - proc proc ${options}\n`
}

// The stderr tail bench reads one trim of a retained tail plus one delivered chunk at the evidence
// bound the audit read (64 KiB), with the cut on a continuation byte so the walk steps past it. The
// shipped walk must cost at most `TRIM_SHARE` of the per-call array walk it replaced, the audit's
// -90% bar for the repair.
export const TRIM_EVIDENCE = 65_536
export const TRIM_CHUNK = 1_024
export const TRIM_SHARE = 0.1
export const TRIM_RUN = Object.freeze({ time: 1_000, warmupTime: 200, iterations: 50 })

/** Records the exit listeners installed by a bounded native-exit wait. */
export class ExitBoundary {
	#listeners: Array<() => void> = []
	readonly exitCode = null
	readonly signalCode = null

	get listeners(): ReadonlyArray<() => void> {
		return this.#listeners
	}

	once(_event: 'exit', listener: () => void): void {
		this.#listeners = [...this.#listeners, listener]
	}

	off(_event: 'exit', listener: () => void): void {
		this.#listeners.splice(this.#listeners.indexOf(listener), 1)
	}
}
