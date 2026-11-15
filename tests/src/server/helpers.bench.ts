import { Buffer } from 'node:buffer'
import { expect, it } from 'vitest'
import { trimTail } from '@src/server'
import { TRIM_CHUNK, TRIM_EVIDENCE, TRIM_RUN, TRIM_SHARE } from '../../setupServer.js'

// The cost `Supervisor` pays per stderr chunk to keep its evidence tail: one `trimTail` over the
// retained tail plus one delivered chunk, at the 64 KiB evidence bound. The control is the walk
// 0.0.20 shipped, which built an array of the bound's length on every call; it is the method the
// index walk replaced, so the shipped walk keeps its place while its median stays under
// `TRIM_SHARE` of the control's. No gate collects this file; run it with
// `npm run test:bench -- tests/src/server/helpers.bench.ts`.

it('trims a 64 KiB evidence tail at a share of the array walk it replaced', async ({ bench }) => {
	const input = Buffer.concat([
		Buffer.alloc(TRIM_CHUNK - 1, 0x61),
		Buffer.from('\u{e9}'),
		Buffer.alloc(TRIM_EVIDENCE - 1, 0x61),
	])
	const results = await bench.compare(
		bench('index walk', () => trimTail(input, TRIM_EVIDENCE)),
		bench('array walk', () => {
			const offset = input.byteLength - TRIM_EVIDENCE
			for (const start of Array.from(
				{ length: input.byteLength - offset },
				(_, index) => offset + index,
			)) {
				const byte = input[start]
				if (byte === undefined || (byte & 0xc0) !== 0x80) return Buffer.from(input.subarray(start))
			}
			return Buffer.alloc(0)
		}),
		TRIM_RUN,
	)
	const shipped = results.get('index walk').latency.p50
	const control = results.get('array walk').latency.p50
	console.log('trim at 64 KiB', shipped, control, shipped / control)

	expect(trimTail(input, TRIM_EVIDENCE).equals(input.subarray(TRIM_CHUNK + 1))).toBe(true)
	expect(shipped).toBeLessThan(control * TRIM_SHARE)
}, 600_000)
