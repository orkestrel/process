import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRecorder, waitForDelay } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { isProcessError } from '@src/core'
import { execute } from '@src/server'
import { childCommand, resolveChildFixture } from '../../../setupServer.js'

describe('execute', () => {
	it('spawns the same command file that it validated', async () => {
		const reads = createRecorder<readonly [string]>()
		const result = await execute(
			{
				get file() {
					reads.handler('read')
					return reads.count === 1 ? process.execPath : `${process.execPath}\0changed`
				},
				arguments: [resolveChildFixture(), 'exit', '0'],
			},
			{ workspace: process.cwd() },
		)

		expect(reads.calls).toEqual([['read']])
		expect(result.code).toBe(0)
	})

	it('buffers a successful run and reports it did not fail', async () => {
		const result = await execute(childCommand('exit', '0'), { workspace: process.cwd() })
		expect(result.failed).toBe(false)
		expect(result.code).toBe(0)
		expect(result.stdout).toContain('ran:0')
		expect(result.stderr).toContain('diagnostic:0')
		expect(result.truncated).toBe(false)
		expect(result.aborted).toBe(false)
	})

	it('rejects a failed run with a process error carrying the result', async () => {
		const thrown: unknown = await execute(childCommand('exit', '3'), {
			workspace: process.cwd(),
		}).then(
			() => undefined,
			(error: unknown) => error,
		)
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.result?.code : undefined).toBe(3)
	})

	it('resolves a failed run with the outcome when strict is false', async () => {
		const result = await execute(childCommand('exit', '4'), {
			workspace: process.cwd(),
			strict: false,
		})
		expect(result.failed).toBe(true)
		expect(result.code).toBe(4)
		expect(result.expired).toBe(false)
	})

	it('reports a run that outlasted its timeout as expired rather than aborted', async () => {
		const result = await execute(childCommand('hang'), {
			workspace: process.cwd(),
			timeout: 100,
			grace: 20,
			strict: false,
		})
		expect(result.expired).toBe(true)
		expect(result.aborted).toBe(false)
		expect(result.failed).toBe(true)
	})

	it('reports an externally aborted run as aborted rather than expired', async () => {
		const controller = new AbortController()
		const pending = execute(childCommand('sleep'), {
			workspace: process.cwd(),
			grace: 20,
			signal: controller.signal,
			strict: false,
		})
		controller.abort()
		const result = await pending

		expect(result.aborted).toBe(true)
		expect(result.expired).toBe(false)
		expect(result.failed).toBe(true)
	})

	// Both mechanisms armed on one run. The first to fire terminates the child and disarms the other,
	// so exactly one of `expired` and `aborted` is ever true.
	it('reports the timeout when it fires before an armed abort', async () => {
		const controller = new AbortController()
		const late = setTimeout(() => controller.abort(), 2_000)
		try {
			const result = await execute(childCommand('hang'), {
				workspace: process.cwd(),
				timeout: 100,
				grace: 20,
				signal: controller.signal,
				strict: false,
			})

			expect(result.expired).toBe(true)
			expect(result.aborted).toBe(false)
			expect(result.failed).toBe(true)
		} finally {
			clearTimeout(late)
		}
	})

	it('reports the abort when it fires before an armed timeout', async () => {
		const controller = new AbortController()
		const pending = execute(childCommand('hang'), {
			workspace: process.cwd(),
			timeout: 5_000,
			grace: 20,
			signal: controller.signal,
			strict: false,
		})
		controller.abort()
		const result = await pending

		expect(result.aborted).toBe(true)
		expect(result.expired).toBe(false)
		expect(result.failed).toBe(true)
	})

	// Both deadlines are set to the same delay, so which one the host's timer queue delivers first is
	// not fixed. Exclusivity is the property that must hold whichever wins, so that is what is asserted.
	it('reports exactly one outcome when the timeout and the abort share a deadline', async () => {
		const controller = new AbortController()
		const together = setTimeout(() => controller.abort(), 100)
		try {
			const result = await execute(childCommand('hang'), {
				workspace: process.cwd(),
				timeout: 100,
				grace: 20,
				signal: controller.signal,
				strict: false,
			})

			expect(result.expired).not.toBe(result.aborted)
			expect(result.failed).toBe(true)
		} finally {
			clearTimeout(together)
		}
	})

	it('caps a huge capture at the limit and reports truncation without failing', async () => {
		const result = await execute(childCommand('chatty'), {
			workspace: process.cwd(),
			limit: 1_024,
			strict: false,
		})

		expect(result.truncated).toBe(true)
		expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1_024)
		expect(result.stdout.startsWith('0:')).toBe(true)
		expect(result.failed).toBe(false)
		expect(result.code).toBe(0)
	})

	// The capture keeps one byte beyond `limit`, so the single code-point-boundary trim in
	// `buildExecuteResult` reads the first excluded byte and retreats off a sequence the cut split.
	// This child writes the bytes of `aa€`, whose third byte opens a three-byte sequence, so a
	// byte-exact cut at `limit` would decode as a replacement character instead.
	it('delivers no split multibyte sequence at the capture bound', async () => {
		const result = await execute(
			{
				file: process.execPath,
				arguments: ['-e', "process.stdout.write(Buffer.from('aa\\u20ac', 'utf8'))"],
			},
			{ workspace: process.cwd(), limit: 3, strict: false },
		)

		expect(result.stdout).toBe('aa')
		expect(result.stdout).not.toContain('\u{fffd}')
		expect(result.truncated).toBe(true)
	})

	// The same bound from the other side. This child writes four ASCII bytes then a stray `80`, so
	// the byte the capture reads past `limit` carries the continuation bit pattern without any lead
	// byte opening a sequence that reaches it. The trim keeps all four requested bytes.
	it('delivers the whole limit when the byte past the bound is a stray continuation byte', async () => {
		const result = await execute(
			{
				file: process.execPath,
				arguments: ['-e', 'process.stdout.write(Buffer.from([0x61, 0x61, 0x61, 0x61, 0x80]))'],
			},
			{ workspace: process.cwd(), limit: 4, strict: false },
		)

		expect(result.stdout).toBe('aaaa')
		expect(result.truncated).toBe(true)
	})

	// Both sides of the bound in one row. The capture reads one byte past `limit` and `truncated`
	// reports that the excess arrived, so a run ending exactly at `limit` is untruncated while a run
	// one byte longer is truncated, and the delivered text stays bounded by `limit` in each case.
	it('bounds the captured text by the limit and reports truncation only past it', async () => {
		const exact = await execute(
			{ file: process.execPath, arguments: ['-e', "process.stdout.write('x'.repeat(64))"] },
			{ workspace: process.cwd(), limit: 64, strict: false },
		)
		const over = await execute(
			{ file: process.execPath, arguments: ['-e', "process.stdout.write('x'.repeat(65))"] },
			{ workspace: process.cwd(), limit: 64, strict: false },
		)

		expect(Buffer.byteLength(exact.stdout)).toBe(64)
		expect(exact.truncated).toBe(false)
		expect(Buffer.byteLength(over.stdout)).toBe(64)
		expect(over.truncated).toBe(true)
	})

	it('rejects an unspawnable command with spawn code and the host cause', async () => {
		const thrown: unknown = await execute(
			{
				file: 'orkestrel-nonexistent-binary.exe',
				arguments: [],
				input: 'unspawnable input',
			},
			{ workspace: process.cwd() },
		).then(
			() => undefined,
			(error: unknown) => error,
		)
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('spawn')
		expect(isProcessError(thrown) ? thrown.cause : undefined).toBeInstanceOf(Error)
	})

	// The documented difference between `execute` and `executeSync` on a spawn fault. The errno
	// itself is the host's, so its sign is the property a caller can act on and the property
	// asserted.
	it('reports the host negative errno when the command cannot be spawned', async () => {
		const result = await execute(
			{ file: 'orkestrel-nonexistent-binary.exe', arguments: [] },
			{ workspace: process.cwd(), strict: false },
		)

		expect(result.failed).toBe(true)
		const code = result.code
		if (code === null) throw new Error('execute reported no code for a spawn fault')
		expect(code).toBeLessThan(0)
	})

	it('reports a pending input write fault as the cause of a failed run', async () => {
		const input = 'x'.repeat(4 * 1_024 * 1_024)
		const faulting = {
			file: process.execPath,
			arguments: ['-e', 'setTimeout(() => process.exit(0), 150)'],
		}
		const reading = {
			file: process.execPath,
			arguments: ['-e', 'process.stdin.resume()'],
		}

		const result = await execute(faulting, { input, strict: false })
		const thrown: unknown = await execute(faulting, { input }).then(
			() => undefined,
			(error: unknown) => error,
		)
		const control = await execute(reading, { input })

		expect(result.failed).toBe(true)
		expect(result).toMatchObject({
			expired: false,
			aborted: false,
			truncated: false,
			code: 0,
			signal: null,
		})
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.cause : undefined).toBeInstanceOf(Error)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('input')
		expect(isProcessError(thrown) ? thrown.message : undefined).toBe(
			`Command '${result.command}' failed while writing standard input`,
		)
		expect(control.failed).toBe(false)
		expect(control.code).toBe(0)
	})

	it('refuses a NUL in a per-run environment override before spawning', async () => {
		const nul = String.fromCodePoint(0)
		const thrown: unknown = await execute(childCommand('exit', '0'), {
			workspace: process.cwd(),
			environment: { PROCESS_TEST_KEY: `a${nul}b` },
		}).then(
			() => undefined,
			(error: unknown) => error,
		)

		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
	})

	it('rejects a throwing signal getter before spawning a child', async () => {
		const scratch = createScratch()
		const marker = join(scratch.path, 'hostile-signal.txt')
		const failure = new Error('hostile signal getter')

		try {
			const thrown: unknown = await execute(childCommand('write', marker), {
				workspace: process.cwd(),
				get signal(): AbortSignal {
					throw failure
				},
			}).then(
				() => undefined,
				(error: unknown) => error,
			)
			await waitForDelay(200)

			expect(thrown).toBe(failure)
			expect(existsSync(marker)).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
})
