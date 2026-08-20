import { describe, expect, it } from 'vitest'
import { waitForDelay } from '@orkestrel/test'
import { waitForCondition } from './setup.js'

describe('waitForCondition', () => {
	it('resolves as soon as a synchronous condition holds', async () => {
		let held = false
		setTimeout(() => {
			held = true
		}, 40)
		const started = performance.now()
		await waitForCondition(() => held, 1_000, 5)
		const elapsed = performance.now() - started
		expect(held).toBe(true)
		// The property is that it returns near the event rather than near the budget, so it is
		// asserted as a relationship to the budget rather than as the number one run produced.
		expect(elapsed).toBeLessThan(500)
	})

	it('awaits a condition that resolves asynchronously', async () => {
		let held = false
		setTimeout(() => {
			held = true
		}, 40)
		await waitForCondition(
			async () => {
				await waitForDelay(1)
				return held
			},
			1_000,
			5,
		)
		expect(held).toBe(true)
	})

	it('rejects with the budget named when the condition never holds', async () => {
		const started = performance.now()
		const error = await waitForCondition(() => false, 60, 5).then(
			() => undefined,
			(thrown: unknown) => thrown,
		)
		const elapsed = performance.now() - started
		expect(error).toBeInstanceOf(Error)
		expect(String(error)).toContain('60ms')
		expect(elapsed).toBeGreaterThanOrEqual(60)
	})

	it('polls at least twice before giving up, so a late condition is still observed', async () => {
		let polls = 0
		let held = false
		setTimeout(() => {
			held = true
		}, 30)
		await waitForCondition(
			() => {
				polls += 1
				return held
			},
			1_000,
			5,
		)
		expect(polls).toBeGreaterThan(1)
	})

	it('returns without polling twice when the condition already holds', async () => {
		let polls = 0
		await waitForCondition(() => {
			polls += 1
			return true
		})
		expect(polls).toBe(1)
	})
})
