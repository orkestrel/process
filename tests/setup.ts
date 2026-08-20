import { waitForDelay } from '@orkestrel/test'

/**
 * Waits until a condition holds, rejecting once a poll fails at or after its budget.
 *
 * @param condition - The observable condition to poll. A promise resolving to `true` is awaited.
 * @param budget - The milliseconds after which a failed poll rejects. Default: `1000`.
 * @param interval - The delay between polls in milliseconds. Default: `10`.
 * @returns A promise that resolves once the condition holds.
 * @throws When a poll fails at or after the budget.
 *
 * @remarks
 * The budget bounds when rejection becomes possible rather than the wait as a whole. The deadline is
 * read only after a failed poll, so rejection lands at or after the budget and never inside it, and
 * the longest a caller waits is the budget plus one interval plus one evaluation of the condition. A
 * condition slower than the budget overshoots it by its own duration.
 *
 * The deadline is measured with `performance.now()`, which is monotonic and does not move when the
 * host's wall clock does. A helper whose only job is bounding a wait must not have its deadline
 * shifted by a clock adjustment taken mid-wait.
 *
 * Prefer this to a fixed delay wherever a test waits for something another process produces. A fixed
 * delay encodes one host's timing and fails on a slower one, or passes on a faster one while the
 * condition it meant to observe never held.
 *
 * @example
 * ```ts
 * await waitForCondition(() => existsSync(marker), 5_000)
 * ```
 */
export async function waitForCondition(
	condition: () => boolean | Promise<boolean>,
	budget = 1000,
	interval = 10,
): Promise<void> {
	const deadline = performance.now() + budget
	while (!(await condition())) {
		if (performance.now() >= deadline) {
			throw new Error(`The condition did not hold within ${budget}ms`)
		}
		await waitForDelay(interval)
	}
}
