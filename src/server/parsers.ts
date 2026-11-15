import type { ProcessStat } from './types.js'

/**
 * Parses one process-table `stat` line into the state and the process group a liveness reading needs.
 *
 * @remarks
 * The command name sits in parentheses and can hold spaces and parentheses itself, so the fields
 * are read after the last `)`: the state, the parent id, then the group id.
 *
 * @param text - The content of a `/proc/<pid>/stat` or `/proc/<pid>/task/<tid>/stat` file
 * @returns The state and the group, or `undefined` when the text does not have that form
 *
 * @example
 * ```ts
 * parseProcessStat('42 (node) Z 1 42 42') // { state: 'Z', group: 42 }
 * ```
 */
export function parseProcessStat(text: string): ProcessStat | undefined {
	const close = text.lastIndexOf(')')
	if (close === -1) return undefined
	const [state, , group] = text.slice(close + 2).split(' ')
	if (state === undefined || state === '' || group === undefined || !/^\d+$/u.test(group)) {
		return undefined
	}
	return Object.freeze({ state, group: Number(group) })
}
