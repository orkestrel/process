import { describe, expect, it } from 'vitest'
import { parseProcessStat } from '@src/server'

describe('parseProcessStat', () => {
	it('reads the state, the group, and the start time after the last parenthesis of the command name', () => {
		expect(parseProcessStat('42 (node) Z 1 42 42 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 900 0 0')).toEqual(
			{ state: 'Z', group: 42, start: '900' },
		)
		expect(
			parseProcessStat('43 (a) b (c)) S 7 41 41 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 77\n'),
		).toEqual({ state: 'S', group: 41, start: '77' })
	})

	it('refuses text that does not carry a state, a numeric group, and a numeric start time', () => {
		for (const text of [
			'',
			'42 node S 1 42',
			'42 (node)',
			'42 (node) S 1',
			'42 (node) S 1 x',
			'42 (node)  1 42',
			'42 (node) S 1 42 42',
			'42 (node) S 1 42 42 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 x',
		]) {
			expect(parseProcessStat(text)).toBeUndefined()
		}
	})
})
