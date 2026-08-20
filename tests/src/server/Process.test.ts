import type { ProcessExit } from '@src/core'
import { getEventListeners } from 'node:events'
import { describe, expect, it } from 'vitest'
import { holds } from '@orkestrel/contract'
import { collect, createRecorder, waitForDelay } from '@orkestrel/test'
import { isProcessError, ProcessError } from '@src/core'
import { createProcess } from '@src/server'
import { childCommand, resolveChildFixture } from '../../setupServer.js'

describe('Process', () => {
	it('drains output with no line consumer and still resolves exit', async () => {
		const child = createProcess({
			command: childCommand('chatty'),
			workspace: process.cwd(),
			grace: 20,
		})

		const exit = await child.exit
		const lines = await collect(child.lines)

		expect(exit).toEqual({ code: 0, signal: null })
		expect(lines).toHaveLength(4_096)
		expect(lines[0]).toBe(`0:${'x'.repeat(128)}`)
	})

	it('stops retaining lines past the backlog when no consumer ever attaches', async () => {
		const child = createProcess({
			command: childCommand('chatty'),
			workspace: process.cwd(),
			grace: 20,
			backlog: 1_024,
		})

		const exit = await child.exit
		const lines = await collect(child.lines)

		expect(exit).toEqual({ code: 0, signal: null })
		expect(lines.length).toBeGreaterThan(0)
		expect(lines.length).toBeLessThan(4_096)
		expect(lines[0]).toBe(`0:${'x'.repeat(128)}`)
	})

	it('stops retaining empty lines past the backlog when no consumer ever attaches', async () => {
		const child = createProcess({
			command: childCommand('empty'),
			workspace: process.cwd(),
			grace: 20,
			backlog: 64,
		})

		const exit = await child.exit
		const lines = await collect(child.lines)

		expect(exit).toEqual({ code: 0, signal: null })
		expect(lines.length).toBeGreaterThan(0)
		// Every line the fixture writes carries zero payload bytes, so a backlog that charges only the
		// payload never fills and the mark never bounds anything.
		expect(lines.length).toBeLessThanOrEqual(64)
	})

	it('loses no line for a consumer holding a chatty child at the backlog mark', async () => {
		const child = createProcess({
			command: childCommand('chatty'),
			workspace: process.cwd(),
			grace: 20,
			backlog: 4_096,
		})

		const lines = await collect(child.lines)
		const exit = await child.exit

		expect(exit).toEqual({ code: 0, signal: null })
		expect(lines).toHaveLength(4_096)
		expect(lines[4_095]).toBe(`4095:${'x'.repeat(128)}`)
	})

	it('delivers a final stdout line written without a trailing newline', async () => {
		const child = createProcess({
			command: childCommand('partial-line'),
			workspace: process.cwd(),
			grace: 20,
		})

		const lines = await collect(child.lines)
		await child.exit

		expect(lines).toEqual(['first-line', 'final-partial-line'])
	})

	it('forwards complete stderr live while retaining only the byte-bounded tail', async () => {
		const chunks = createRecorder<readonly [string]>()
		const child = createProcess({
			command: childCommand('evidence'),
			workspace: process.cwd(),
			grace: 20,
			evidence: 16,
			on: { stderr: chunks.handler },
		})

		await child.exit

		const live = chunks.calls.map((call) => call[0]).join('')
		expect(live).toContain('x'.repeat(4_096))
		expect(live).toContain('token=evidence-secret-tail')
		expect(Buffer.byteLength(child.evidence)).toBeLessThanOrEqual(16)
		expect(child.evidence.endsWith('tail')).toBe(true)
	})

	it('bounds a multibyte stderr tail without splitting a code point', async () => {
		const child = createProcess({
			command: childCommand('unicode-evidence'),
			workspace: process.cwd(),
			grace: 20,
			evidence: 31,
		})

		await child.exit

		expect(Buffer.byteLength(child.evidence)).toBeLessThanOrEqual(31)
		expect(child.evidence).not.toContain('\u{fffd}')
		expect(child.evidence.endsWith('tail')).toBe(true)
	})

	it('emits the terminal state on the exit event and the exit promise alike', async () => {
		const exits = createRecorder<readonly [ProcessExit]>()
		const child = createProcess({
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
			grace: 20,
			on: { exit: exits.handler },
		})

		const promised = await child.exit

		expect(promised).toEqual({ code: 0, signal: null })
		expect(exits.count).toBe(1)
		expect(exits.calls[0]?.[0]).toEqual(promised)
	})

	it('accepts a line on an open stdin channel and echoes it back', async () => {
		const child = createProcess({
			command: childCommand('echo'),
			workspace: process.cwd(),
			grace: 20,
			writable: true,
		})
		const iterator = child.lines[Symbol.asyncIterator]()

		const accepted = await child.send('ping')
		const first = await iterator.next()
		await child.send('stop')
		await child.exit

		expect(accepted).toBe(true)
		expect(first.value).toBe('echo:ping')
	})

	it('refuses a line on a closed stdin channel', async () => {
		const child = createProcess({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})

		const refused = await child.send('ping')
		await child.stop()

		expect(refused).toBe(false)
	})

	it('settles a write the child never reads once teardown destroys the channel', async () => {
		const child = createProcess({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
			writable: true,
		})

		const delivery = child.send('x'.repeat(4 * 1_024 * 1_024))
		const raced = await Promise.race([delivery, waitForDelay(150).then(() => 'pending')])
		await child.destroy()

		expect(raced).toBe('pending')
		expect(await delivery).toBe(false)
	})

	it('collapses a double stop and a concurrent abort onto one termination', async () => {
		const controller = new AbortController()
		const child = createProcess({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 100,
			signal: controller.signal,
		})

		const first = child.stop()
		const second = child.stop()
		controller.abort()
		const third = child.stop()

		expect(second).toBe(first)
		expect(third).toBe(first)
		await Promise.all([first, second, third])

		const once = await child.exit
		const again = await child.exit
		expect(again).toEqual(once)
	})

	it('terminates a child that installs no shutdown handler and confirms its exit', async () => {
		const child = createProcess({
			command: childCommand('hang'),
			workspace: process.cwd(),
			grace: 20,
		})

		const confirmed = await child.stop()
		const exit = await child.exit

		expect(confirmed).toBe(true)
		expect(exit.code !== 0 || exit.signal !== null).toBe(true)
	})

	// Escalation exists only where a cooperative signal exists. `stopChild` ends a Windows tree with
	// `taskkill /F /T`, which delivers no `SIGTERM` and offers the child no chance to ignore one, so
	// only a POSIX host can observe the grace window elapse and `SIGKILL` follow.
	it.skipIf(process.platform === 'win32')(
		'escalates when process groups accept SIGTERM before SIGKILL',
		async () => {
			const child = createProcess({
				command: childCommand('trap'),
				workspace: process.cwd(),
				grace: 50,
			})
			const iterator = child.lines[Symbol.asyncIterator]()
			const ready = await iterator.next()

			const confirmed = await child.stop()
			const exit = await child.exit

			expect(ready.value).toBe('trapped')
			expect(confirmed).toBe(true)
			expect(exit.signal).toBe('SIGKILL')
			expect(exit.code).toBeNull()
		},
	)

	it('caps retained lines while termination drains a flooding child', async () => {
		const backlog = 1_024
		const child = createProcess({
			command: childCommand('flood'),
			workspace: process.cwd(),
			grace: 100,
			backlog,
		})
		const iterator = child.lines[Symbol.asyncIterator]()
		const ready = await iterator.next()
		await waitForDelay(50)

		const confirmed = await child.stop()
		const exit = await child.exit
		const retained = await collect(child.lines)
		const bytes = retained.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0)

		expect(ready.value).toBe('ready')
		expect(confirmed).toBe(true)
		expect(exit.signal).toBe('SIGKILL')
		expect(bytes).toBeLessThanOrEqual(backlog * 2)
		expect(child.truncated).toBe(true)
	})

	it('confirms a stop for a child that already exited', async () => {
		const child = createProcess({
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
			grace: 20,
		})
		await child.exit

		expect(await child.stop()).toBe(true)
	})

	it('stops and destroys a dead child whose stdio a descendant still holds', async () => {
		const child = createProcess({
			command: childCommand('orphan'),
			workspace: process.cwd(),
			grace: 20,
		})
		const iterator = child.lines[Symbol.asyncIterator]()
		const first = await iterator.next()
		const second = await iterator.next()
		const held = Number.parseInt(String(first.value).replace('grandchild:', ''), 10)

		try {
			expect(second.value).toBe('exiting')
			await waitForDelay(250)

			const confirmed = await child.stop()
			await child.destroy()
			const settlement = await Promise.race([
				child.exit.then(() => 'closed'),
				waitForDelay(150).then(() => 'held'),
			])

			expect(confirmed).toBe(true)
			expect(child.emitter.destroyed).toBe(true)
			expect(settlement).toBe('held')
		} finally {
			holds(() => process.kill(held, 'SIGKILL'))
		}
	})

	// A descendant is reached by process-tree id on Windows and by process group everywhere else, so
	// each host proves its own mechanism. This one drives `taskkill /T`, which has no POSIX peer.
	it.skipIf(process.platform !== 'win32')(
		'kills a grandchild while taskkill.exe can address the live root tree',
		async () => {
			const child = createProcess({
				command: childCommand('tree'),
				workspace: process.cwd(),
				grace: 20,
			})
			const iterator = child.lines[Symbol.asyncIterator]()
			const first = await iterator.next()
			const held = Number.parseInt(String(first.value).replace('grandchild:', ''), 10)

			try {
				expect(holds(() => process.kill(held, 0))).toBe(true)

				await child.stop()
				await waitForDelay(100)

				expect(holds(() => process.kill(held, 0))).toBe(false)
			} finally {
				holds(() => process.kill(held, 'SIGKILL'))
			}
		},
	)

	// A process group is signalled by negated pid, which Windows does not implement: `process.kill`
	// rejects a negative pid there, so only a POSIX host can prove the group reaches a descendant.
	it.skipIf(process.platform === 'win32')(
		'kills a grandchild while process.kill accepts a negative process-group id',
		async () => {
			const child = createProcess({
				command: childCommand('tree'),
				workspace: process.cwd(),
				grace: 20,
			})
			const iterator = child.lines[Symbol.asyncIterator]()
			const first = await iterator.next()
			const held = Number.parseInt(String(first.value).replace('grandchild:', ''), 10)

			try {
				expect(holds(() => process.kill(held, 0))).toBe(true)

				await child.stop()
				const settlement = await Promise.race([
					child.exit.then(() => 'closed'),
					waitForDelay(100).then(() => 'held'),
				])

				expect(settlement).toBe('closed')
			} finally {
				holds(() => process.kill(held, 'SIGKILL'))
			}
		},
	)

	it('emits the error cause on a spawn fault while still resolving exit', async () => {
		const errors = createRecorder<readonly [unknown]>()
		const child = createProcess({
			command: { file: 'orkestrel-nonexistent-binary', arguments: [] },
			workspace: process.cwd(),
			grace: 20,
			on: { error: errors.handler },
		})

		const exit = await child.exit

		expect(errors.count).toBe(1)
		expect(errors.calls[0]?.[0]).toBeInstanceOf(Error)
		expect(exit.code).not.toBe(0)
	})

	it('emits no error event when the child exits cleanly', async () => {
		const errors = createRecorder<readonly [unknown]>()
		const child = createProcess({
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
			grace: 20,
			on: { error: errors.handler },
		})

		const exit = await child.exit

		expect(exit).toEqual({ code: 0, signal: null })
		expect(errors.count).toBe(0)
	})

	it('destroys the observation emitter after stopping the child', async () => {
		const child = createProcess({
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
			grace: 20,
		})
		await child.exit

		const ending = child.destroy()
		expect(child.destroy()).toBe(ending)
		await ending

		expect(child.emitter.destroyed).toBe(true)
	})

	it('removes the caller abort listener when teardown begins before close', async () => {
		const controller = new AbortController()
		const exits = createRecorder<readonly [ProcessExit]>()
		const child = createProcess({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
			signal: controller.signal,
			on: { exit: exits.handler },
		})

		expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
		const ending = child.destroy()
		expect(exits.count).toBe(0)
		expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
		await ending
	})

	it('gives an isolated child its own overrides without the parent environment', async () => {
		process.env.PROCESS_PARENT_KEY = 'parent'
		try {
			const isolated = createProcess({
				command: {
					...childCommand('environment', 'PROCESS_PARENT_KEY'),
					environment: { PROCESS_TEST_KEY: 'child' },
					isolated: true,
				},
				workspace: process.cwd(),
				grace: 20,
			})
			const inherited = createProcess({
				command: childCommand('environment', 'PROCESS_PARENT_KEY'),
				workspace: process.cwd(),
				grace: 20,
			})

			const isolatedLines = await collect(isolated.lines)
			const inheritedLines = await collect(inherited.lines)

			expect(isolatedLines).toEqual(['value:'])
			expect(inheritedLines).toEqual(['value:parent'])
		} finally {
			delete process.env.PROCESS_PARENT_KEY
		}
	})
})

describe('Process validation', () => {
	it('accepts NUL as standard-input payload', async () => {
		const input = `left${String.fromCodePoint(0)}right\n`
		const child = createProcess({
			command: {
				file: process.execPath,
				arguments: ['-e', 'process.stdin.pipe(process.stdout)'],
				input,
			},
			workspace: process.cwd(),
		})

		const lines = await collect(child.lines)
		await child.exit

		expect(lines).toEqual([input.slice(0, -1)])
	})

	it('spawns the same command file that it validated', async () => {
		let reads = 0
		const child = createProcess({
			command: {
				get file() {
					reads += 1
					return reads === 1 ? process.execPath : `${process.execPath}\0changed`
				},
				arguments: [resolveChildFixture(), 'exit', '0'],
			},
			workspace: process.cwd(),
		})

		const exit = await child.exit

		expect(reads).toBe(1)
		expect(exit.code).toBe(0)
	})

	it('refuses a NUL inside a command argument', () => {
		expect(() =>
			createProcess({
				command: { file: process.execPath, arguments: ['--eval', 'a\0b'] },
				workspace: process.cwd(),
			}),
		).toThrow(ProcessError)
	})

	it('refuses a timer option the host would truncate to one millisecond', () => {
		expect(() =>
			createProcess({
				command: childCommand('exit', '0'),
				workspace: process.cwd(),
				grace: 2 ** 31,
			}),
		).toThrow(ProcessError)
	})

	it('refuses a backlog that leaves no room for one line', () => {
		expect(() =>
			createProcess({
				command: childCommand('exit', '0'),
				workspace: process.cwd(),
				backlog: 0,
			}),
		).toThrow(ProcessError)
	})

	it('refuses a fractional byte bound and an empty workspace', () => {
		expect(() =>
			createProcess({
				command: childCommand('exit', '0'),
				workspace: process.cwd(),
				evidence: 1.5,
			}),
		).toThrow(ProcessError)
		expect(() => createProcess({ command: childCommand('exit', '0'), workspace: '' })).toThrow(
			ProcessError,
		)
	})

	it('codes a refused input as invalid and carries the rejected value', () => {
		let thrown: unknown
		try {
			createProcess({
				command: childCommand('exit', '0'),
				workspace: process.cwd(),
				backlog: -1,
			})
		} catch (error) {
			thrown = error
		}

		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
		expect(isProcessError(thrown) ? thrown.context?.value : undefined).toBe(-1)
	})
})
