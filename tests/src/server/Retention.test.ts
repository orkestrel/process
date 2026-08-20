import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { Retention } from '@src/server'

describe('Retention', () => {
	it('accumulates delivered and retained totals across a truncating stream', () => {
		const retention = new Retention()
		const head = retention.retain(Buffer.from('hello'), 3)
		const tail = retention.retain(Buffer.from('world'), 3)
		const ignored = retention.retain('not a chunk', 3)

		expect(head?.toString('utf8')).toBe('hel')
		expect(tail).toBeUndefined()
		expect(ignored).toBeUndefined()
		expect(retention.delivered).toBe(10)
		expect(retention.retained).toBe(3)
	})
})
