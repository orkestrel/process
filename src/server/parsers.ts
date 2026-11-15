import type { ProcessStat } from './types.js'

/**
 * Parses one process-table `stat` line into the state, the process group, and the start time a liveness reading needs.
 *
 * @remarks
 * The command name sits in parentheses and can hold spaces and parentheses itself, so the fields
 * are read after the last `)`: the state, the parent id, the group id, and, 19 fields after the
 * state, the start time (`stat` field 22).
 *
 * @param text - The content of a `/proc/<pid>/stat` or `/proc/<pid>/task/<tid>/stat` file
 * @returns The state, the group, and the start time, or `undefined` when the text does not have that form
 *
 * @example
 * ```ts
 * parseProcessStat('42 (node) Z 1 42 42 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 900')
 * // { state: 'Z', group: 42, start: '900' }
 * ```
 */
export function parseProcessStat(text: string): ProcessStat | undefined {
	const close = text.lastIndexOf(')')
	if (close === -1) return undefined
	const fields = text.slice(close + 2).split(' ')
	const [state, , group] = fields
	const start = fields[19]
	if (
		state === undefined ||
		state === '' ||
		group === undefined ||
		!/^\d+$/u.test(group) ||
		start === undefined ||
		!/^\d+$/u.test(start.trim())
	) {
		return undefined
	}
	return Object.freeze({ state, group: Number(group), start: start.trim() })
}
