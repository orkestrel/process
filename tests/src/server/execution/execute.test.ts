import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { waitForDelay } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { isProcessError } from '@src/core'
import { execute } from '@src/server'
import { childCommand, resolveChildFixture } from '../../../setupServer.js'

describe('execute', () => {
	it('spawns the same command file that it validated', async () => {
		let reads = 0
		const result = await execute(
			{
				get file() {
					reads += 1
					return reads === 1 ? process.execPath : `${process.execPath}\0changed`
				},
				arguments: [resolveChildFixture(), 'exit', '0'],
			},
			{ workspace: process.cwd() },
		)

		expect(reads).toBe(1)
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
		let thrown: unknown
		try {
			await execute(childCommand('exit', '3'), { workspace: process.cwd() })
		} catch (error) {
			thrown = error
		}
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

	it('rejects an unspawnable command with spawn code and the host cause', async () => {
		let thrown: unknown
		try {
			await execute(
				{
					file: 'orkestrel-nonexistent-binary.exe',
					arguments: [],
					input: 'unspawnable input',
				},
				{ workspace: process.cwd() },
			)
		} catch (error) {
			thrown = error
		}
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
		let thrown: unknown
		try {
			await execute(faulting, { input })
		} catch (error) {
			thrown = error
		}
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
		let thrown: unknown
		try {
			await execute(childCommand('exit', '0'), {
				workspace: process.cwd(),
				environment: { PROCESS_TEST_KEY: `a${nul}b` },
			})
		} catch (error) {
			thrown = error
		}

		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
	})
})

describe('execute', () => {
	it('rejects a throwing signal getter before spawning a child', async () => {
		const scratch = createScratch()
		const marker = join(scratch.path, 'hostile-signal.txt')
		const failure = new Error('hostile signal getter')
		let thrown: unknown

		try {
			try {
				await execute(childCommand('write', marker), {
					workspace: process.cwd(),
					get signal(): AbortSignal {
						throw failure
					},
				})
			} catch (error) {
				thrown = error
			}
			await waitForDelay(200)

			expect(thrown).toBe(failure)
			expect(existsSync(marker)).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
})
