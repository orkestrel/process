import { waitForDelay } from '@orkestrel/test'

/**
 * Waits until a condition holds, rejecting when the budget elapses.
 *
 * @param condition - The observable condition to poll. A promise resolving to `true` is awaited.
 * @param budget - The longest wait in milliseconds. Default: `1000`.
 * @param interval - The delay between polls in milliseconds. Default: `10`.
 * @returns A promise that resolves once the condition holds.
 * @throws When the budget elapses before the condition holds.
 *
 * @remarks
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
