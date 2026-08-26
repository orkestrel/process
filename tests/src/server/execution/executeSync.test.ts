import { Buffer } from 'node:buffer'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { holds } from '@orkestrel/contract'
import { waitForCondition } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { isProcessError } from '@src/core'
import { execute, executeSync } from '@src/server'
import { childCommand, resolveChildFixture } from '../../../setupServer.js'

describe('executeSync', () => {
	it(
		'leaves an established grandchild running after a root-only timeout where asynchronous execution ends the tree',
		// Sized from a contended run rather than an isolated one: this proof drives real process
		// creation, which cost 75-163 ms per interpreter unloaded on this host and reached 2.5 s for
		// the same spawn under load, so a budget sized from the isolated 4.2 s cost of this file would
		// report contention as a timeout carrying no diagnostic about the code.
		{ timeout: 40_000 },
		async () => {
			const scratch = createScratch()
			let held = 0
			try {
				const blockingMarker = join(scratch.path, 'blocking.txt')

				// The root must outlive the grandchild's interpreter startup, or this measures bootstrap
				// rather than termination. Node bootstraps in 45.7-49.9 ms on this host, so the former
				// 50 ms root timeout was a coin flip and lost three times in six.
				const blocking = executeSync(childCommand('tree-write', blockingMarker), {
					workspace: process.cwd(),
					timeout: 400,
					strict: false,
				})
				expect(blocking.expired).toBe(true)

				// The claim is about an ESTABLISHED descendant. The root's 50 ms deadline is shorter than
				// Node's own bootstrap on some hosts, so waiting a fixed interval measures whether the
				// grandchild finished starting rather than whether termination reached it. Waiting for the
				// fixture's readiness line removes that race: measured without it, three of six trials
				// never wrote at all.
				await waitForCondition(
					"the blocking grandchild's readiness marker appearing on disk",
					() => existsSync(`${blockingMarker}.ready`),
					{ budget: 6_000 },
				)
				await waitForCondition(
					'the blocking grandchild writing its marker file',
					() => existsSync(blockingMarker),
					{ budget: 6_000 },
				)
				expect(existsSync(blockingMarker)).toBe(true)

				// The asynchronous contrast reads the descendant itself rather than a marker file. A
				// marker cannot report termination here: the `delayed-write` descendant writes 250 ms
				// after announcing readiness, while a Windows tree kill has to launch `taskkill.exe` as
				// its own process, and that launch alone costs 343-835 ms against a nonexistent pid on
				// this host before any tree is walked. Measured through this `execute` call with the
				// descendant's write delay as the only variable, a 250 ms delay left the marker written
				// and a 5 s delay left it absent, with the descendant gone in each case. So the marker's
				// absence measures process-creation latency, and the descendant's own departure measures
				// what this test claims.
				const streamed = await execute(childCommand('tree'), {
					workspace: process.cwd(),
					timeout: 3_000,
					grace: 20,
					strict: false,
				})
				expect(streamed.expired).toBe(true)

				// The published pid is what makes the descendant ESTABLISHED: the fixture writes it after
				// its own spawn returns, so a run reporting one had the descendant in its tree before the
				// deadline fired. The deadline has to outlast that spawn, and asserting the publication is
				// what keeps a host too slow to reach it failing here rather than passing below for a
				// descendant that never existed.
				const [line = ''] = streamed.stdout.split('\n')
				held = Number.parseInt(line.replace('grandchild:', ''), 10)
				expect(Number.isInteger(held)).toBe(true)

				// The descendant holds `sleep`, which exits for nothing but a kill, and nothing addresses
				// it after its root is gone. Its departure is therefore the tree kill's own work, and the
				// budget bounds how long that kill may take rather than asserting how fast it is.
				await waitForCondition(
					'the descendant of the terminated root leaves the host',
					() => !isRunning(held),
					{ budget: 15_000 },
				)
				expect(isRunning(held)).toBe(false)
			} finally {
				if (held > 0) holds(() => process.kill(held, 'SIGKILL'))
				scratch.destroy()
			}
		},
	)

	it('sends string input as bytes, so a NUL in the payload reaches the child', () => {
		// input is stdin payload rather than a spawn-bound string, so it carries no NUL restriction.
		// Passing the string through unconverted made spawnSync reject it with Unknown encoding: buffer.
		const payload = 'before\u0000after\nstop\n'
		const result = executeSync(childCommand('echo'), {
			workspace: process.cwd(),
			input: payload,
			strict: false,
		})
		expect(result.failed).toBe(false)
		// The child echoes the line it read, so a NUL surviving the transfer proves the payload was
		// sent as bytes rather than rejected or re-encoded.
		expect(result.stdout).toContain('before\u0000after')
	})

	it('spawns the same command file that it validated', () => {
		let reads = 0
		const result = executeSync(
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

	it('codes an invalid changing command as invalid before spawn', () => {
		let reads = 0
		let thrown: unknown
		try {
			executeSync({
				get file() {
					reads += 1
					return reads === 1 ? `${process.execPath}\0invalid` : process.execPath
				},
				arguments: [resolveChildFixture(), 'exit', '0'],
			})
		} catch (error) {
			thrown = error
		}

		expect(reads).toBe(1)
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
	})

	it('buffers a successful synchronous run', () => {
		const result = executeSync(childCommand('exit', '0'), { workspace: process.cwd() })
		expect(result.failed).toBe(false)
		expect(result.stdout).toContain('ran:0')
	})

	it('resolves a failed synchronous run with the outcome when strict is false', () => {
		const result = executeSync(childCommand('exit', '5'), {
			workspace: process.cwd(),
			strict: false,
		})
		expect(result.failed).toBe(true)
		expect(result.code).toBe(5)
	})

	it('throws a process error for a failed synchronous run by default', () => {
		let thrown: unknown
		try {
			executeSync(childCommand('exit', '6'), { workspace: process.cwd() })
		} catch (error) {
			thrown = error
		}
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.result?.code : undefined).toBe(6)
	})

	it('fails a synchronous run whose output overflowed the limit', () => {
		const result = executeSync(childCommand('chatty'), {
			workspace: process.cwd(),
			limit: 1_024,
			strict: false,
		})

		expect(result.truncated).toBe(true)
		expect(result.failed).toBe(true)
		expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1_024)
	})

	it('passes a shell metacharacter through as one argument', () => {
		const result = executeSync(
			{ file: 'node', arguments: [resolveChildFixture(), 'args', 'a&b'] },
			{ workspace: process.cwd(), strict: false },
		)

		expect(result.failed).toBe(false)
		expect(result.stdout).toContain('args:a&b')
	})

	it('threads the spawn cause onto the rejected process error', () => {
		let thrown: unknown
		try {
			executeSync(
				{ file: 'orkestrel-nonexistent-binary.exe', arguments: [] },
				{ workspace: process.cwd() },
			)
		} catch (error) {
			thrown = error
		}
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.cause : undefined).toBeInstanceOf(Error)
	})

	it('reports null rather than an errno when the command cannot be spawned', () => {
		const result = executeSync(
			{ file: 'orkestrel-nonexistent-binary.exe', arguments: [] },
			{ workspace: process.cwd(), strict: false },
		)

		expect(result.failed).toBe(true)
		expect(result.code).toBe(null)
	})

	it('refuses a NUL in a per-run environment override before spawning', () => {
		const nul = String.fromCodePoint(0)
		let thrown: unknown
		try {
			executeSync(childCommand('exit', '0'), {
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

describe('executeSync', () => {
	it('runs the child in the workspace it validated', () => {
		const validated = createScratch()
		const later = createScratch()
		let reads = 0

		try {
			const result = executeSync(
				{ file: process.execPath, arguments: ['-e', 'process.stdout.write(process.cwd())'] },
				{
					get workspace(): string {
						reads += 1
						return reads === 1 ? validated.path : later.path
					},
				},
			)

			expect(realpathSync(result.stdout)).toBe(realpathSync(validated.path))
		} finally {
			validated.destroy()
			later.destroy()
		}
	})
})
