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
