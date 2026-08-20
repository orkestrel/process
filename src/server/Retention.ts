import type { RetentionInterface } from './types.js'
import { Buffer } from 'node:buffer'

/**
 * Accumulates byte totals while retaining a bounded stream head.
 *
 * @example
 * ```ts
 * const retention = new Retention()
 * retention.retain(Buffer.from('hello'), 3)?.toString('utf8') // 'hel'
 * retention.retained // 3
 * ```
 */
export class Retention implements RetentionInterface {
	#delivered = 0
	#retained = 0

	/** The bytes delivered by the stream. */
	get delivered(): number {
		return this.#delivered
	}

	/** The bytes retained from the stream head. */
	get retained(): number {
		return this.#retained
	}

	/**
	 * Retains a delivered chunk within a byte limit.
	 *
	 * @param chunk - The delivered chunk, ignored when it is not a buffer
	 * @param limit - The maximum retained byte count
	 * @returns The retained slice, or `undefined` when the chunk contributes no retained bytes
	 */
	retain(chunk: unknown, limit: number): Buffer | undefined {
		if (!Buffer.isBuffer(chunk)) return undefined
		this.#delivered += chunk.byteLength
		const room = limit - this.#retained
		if (room <= 0) return undefined
		const slice = chunk.byteLength <= room ? chunk : Buffer.from(chunk.subarray(0, room))
		this.#retained += slice.byteLength
		return slice
	}
}
