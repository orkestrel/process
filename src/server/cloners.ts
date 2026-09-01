import type { ProcessCommand } from '@src/core'

/**
 * Takes one owned frozen snapshot of a caller's command.
 *
 * @remarks
 * Every public entry point snapshots before it validates, so the object validated is the object
 * spawned. Each property is read exactly once, because reading one runs the caller's own getter: a
 * command whose `file` changes between reads would otherwise validate one executable and spawn
 * another. The argument vector and the environment record are copied and frozen, so a caller
 * mutating either after the call cannot reach the spawn. An absent optional stays absent rather than
 * becoming an explicit `undefined`.
 *
 * @param command - The caller's command, whose properties may be getters
 * @returns A frozen command carrying the values read at this instant
 *
 * @example
 * ```ts
 * snapshotCommand({ file: 'git', arguments: ['status'] }) // { file: 'git', arguments: ['status'] }
 * ```
 */
export function snapshotCommand(command: ProcessCommand): ProcessCommand {
	const file = command.file
	const argumentsList = Object.freeze([...command.arguments])
	const sourceEnvironment = command.environment
	const environment =
		sourceEnvironment === undefined ? undefined : Object.freeze({ ...sourceEnvironment })
	const input = command.input
	const isolated = command.isolated
	return Object.freeze({
		file,
		arguments: argumentsList,
		...(environment === undefined ? {} : { environment }),
		...(input === undefined ? {} : { input }),
		...(isolated === undefined ? {} : { isolated }),
	})
}
