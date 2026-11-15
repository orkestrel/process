import { describe, expect, it } from 'vitest'
import { parseProcessStat } from '@src/server'

describe('parseProcessStat', () => {
	it('reads the state and the group after the last parenthesis of the command name', () => {
		expect(parseProcessStat('42 (node) Z 1 42 42 0 -1')).toEqual({ state: 'Z', group: 42 })
		expect(parseProcessStat('43 (a) b (c)) S 7 41 41')).toEqual({ state: 'S', group: 41 })
	})

	it('refuses text that does not carry a state and a numeric group', () => {
		for (const text of [
			'',
			'42 node S 1 42',
			'42 (node)',
			'42 (node) S 1',
			'42 (node) S 1 x',
			'42 (node)  1 42',
		]) {
			expect(parseProcessStat(text)).toBeUndefined()
		}
	})
})
