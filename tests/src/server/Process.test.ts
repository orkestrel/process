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

	// The framing contract, driven through the shipped `readline` path. Each child writes its bytes
	// with `-e` rather than through a fixture mode, so the exact terminators under test sit beside
	// the lines they must produce. The lone-CR rows are what discriminate this framer from a
	// line-feed-only one: a framer that ignored a bare carriage return would yield `a\rb` for the
	// `carriage` child and one whole line for the redrawing child.
	it('terminates a line on a line feed, a CRLF pair, and a bare carriage return alike', async () => {
		const feed = createProcess({
			command: { file: process.execPath, arguments: ['-e', 'process.stdout.write("a\\nb\\n")'] },
			workspace: process.cwd(),
			grace: 20,
		})
		const carriage = createProcess({
			command: { file: process.execPath, arguments: ['-e', 'process.stdout.write("a\\rb\\n")'] },
			workspace: process.cwd(),
			grace: 20,
		})
		const pair = createProcess({
			command: { file: process.execPath, arguments: ['-e', 'process.stdout.write("a\\r\\nb\\n")'] },
			workspace: process.cwd(),
			grace: 20,
		})
		const consecutive = createProcess({
			command: { file: process.execPath, arguments: ['-e', 'process.stdout.write("a\\r\\rb\\n")'] },
			workspace: process.cwd(),
			grace: 20,
		})
		const trailing = createProcess({
			command: { file: process.execPath, arguments: ['-e', 'process.stdout.write("x\\ry\\rz")'] },
			workspace: process.cwd(),
			grace: 20,
		})

		expect(await collect(feed.lines)).toEqual(['a', 'b'])
		expect(await collect(carriage.lines)).toEqual(['a', 'b'])
		expect(await collect(pair.lines)).toEqual(['a', 'b'])
		// A carriage return terminates in every position, so the run between two of them frames an
		// empty line rather than collapsing.
		expect(await collect(consecutive.lines)).toEqual(['a', '', 'b'])
		// No trailing terminator: the last redraw still arrives as its own line when stdout closes.
		expect(await collect(trailing.lines)).toEqual(['x', 'y', 'z'])
	})

	// The consequence a consumer meets: a child redrawing one status line yields one line per redraw
	// rather than one line for the bar.
	it('yields one line per carriage-return redraw', async () => {
		const child = createProcess({
			command: {
				file: process.execPath,
				arguments: ['-e', 'process.stdout.write("10%\\r50%\\r100%\\n")'],
			},
			workspace: process.cwd(),
			grace: 20,
		})

		expect(await collect(child.lines)).toEqual(['10%', '50%', '100%'])
	})

	// The join half of the framing rule, which needs the pair to arrive in separate chunks: the child
	// writes the carriage return, yields to its own event loop, then writes the line feed. A framer
	// that treated each chunk independently would report an empty line between `a` and `b`.
	it('joins a CRLF pair split across delivered chunks into one break', async () => {
		const child = createProcess({
			command: {
				file: process.execPath,
				arguments: [
					'-e',
					'process.stdout.write("a\\r"); setTimeout(() => { process.stdout.write("\\nb\\n"); process.exit(0) }, 60)',
				],
			},
			workspace: process.cwd(),
			grace: 20,
		})

		expect(await collect(child.lines)).toEqual(['a', 'b'])
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

	it('keeps an ended channel quiet after its input phase settles and a later host fault arrives', async () => {
		const errors = createRecorder<readonly [unknown]>()
		const child = createProcess({
			command: {
				file: process.execPath,
				arguments: ['-e', 'setTimeout(() => process.exit(0), 150)'],
				input: 'x'.repeat(4 * 1_024 * 1_024),
			},
			workspace: process.cwd(),
			grace: 20,
			on: { error: errors.handler },
		})

		await child.exit
		const refused = await child.send('after end')
		await child.destroy()

		expect(refused).toBe(false)
		expect(errors.count).toBe(0)
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

	// The bound `delivery` puts on an unconfirmed write. Its control is the proof named `settles a
	// write the child never reads once teardown destroys the channel`: the same 4 MB write to the same
	// non-reading child, with no `delivery`, stays pending until teardown destroys the channel. Here
	// the write settles while the child is still live and nothing has been torn down, which is the
	// whole of what the option adds.
	it('settles an unconfirmed write false at the delivery bound while the child is still live', async () => {
		const errors = createRecorder<readonly [unknown]>()
		const child = createProcess({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
			writable: true,
			delivery: 50,
			on: { error: errors.handler },
		})

		const settled = await child.send('x'.repeat(4 * 1_024 * 1_024))
		const live = { code: child.code, signal: child.signal }
		await child.destroy()

		expect(settled).toBe(false)
		expect(errors.count).toBe(0)
		// The terminal pair is still null, so no exit and no teardown settled this write: the bound did.
		expect(live).toEqual({ code: null, signal: null })
	})

	it('confirms a write to a reading child when delivery is bounded', async () => {
		const child = createProcess({
			command: childCommand('echo'),
			workspace: process.cwd(),
			grace: 20,
			writable: true,
			delivery: 250,
		})

		const accepted = await child.send('ping')
		await child.send('stop')
		await child.exit

		expect(accepted).toBe(true)
	})

	// A host-reported channel fault, driven through the door this host offers: a write the child never
	// read, still pending when the child exits on its own. The parent's pipe then fails — `write EOF`
	// on Windows, `EPIPE` on POSIX — and the contract is the same either way, so this asserts the
	// engine's shape rather than the host's errno. Its quiet counterpart is the proof named `settles a
	// pending write false inside teardown and emits no error`: the same pending write, settled by the
	// package's own teardown instead, emits nothing.
	it('refuses the write and emits one protocol error when the host reports a stdin fault', async () => {
		const errors = createRecorder<readonly [unknown]>()
		const child = createProcess({
			command: {
				file: process.execPath,
				arguments: ['-e', 'console.log("ready"); setTimeout(() => process.exit(0), 150)'],
				input: 'initial input',
			},
			workspace: process.cwd(),
			grace: 20,
			writable: true,
			on: { error: errors.handler },
		})
		const iterator = child.lines[Symbol.asyncIterator]()
		const ready = await iterator.next()

		const settled = await child.send('x'.repeat(4 * 1_024 * 1_024))
		const refused = await child.send('after the fault')
		await child.exit
		await child.destroy()

		expect(ready.value).toBe('ready')
		expect(settled).toBe(false)
		// One failure state per channel: the write callback and the stream error report it once, and
		// every later write is refused with no further event.
		expect(refused).toBe(false)
		expect(errors.count).toBe(1)
		const fault = errors.calls[0]?.[0]
		expect(isProcessError(fault)).toBe(true)
		expect(isProcessError(fault) ? fault.code : undefined).toBe('protocol')
		expect(fault instanceof Error && fault.cause instanceof Error).toBe(true)
	})

	// Package-initiated closure stays quiet. Nothing host-reported happened, so there is nothing to
	// report: the pending write resolves false and no `error` event fires. The order is pinned beside
	// it, because the settle belongs to the stop path rather than to whatever runs after `destroy`.
	it('settles a pending write false inside teardown and emits no error', async () => {
		const errors = createRecorder<readonly [unknown]>()
		const order: string[] = []
		const child = createProcess({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
			writable: true,
			on: { error: errors.handler },
		})

		const pending = child.send('x'.repeat(4 * 1_024 * 1_024)).then((accepted) => {
			order.push('write')
			return accepted
		})
		const raced = await Promise.race([pending, waitForDelay(150).then(() => 'pending')])
		await child.destroy()
		order.push('teardown')

		expect(raced).toBe('pending')
		expect(await pending).toBe(false)
		expect(order).toEqual(['write', 'teardown'])
		expect(errors.count).toBe(0)
	})

	// Version 0.0.4 accepted a write issued after `stop` began, then destroyed the pipe. The retained
	// contract refuses that write because teardown cannot confirm delivery it is about to discard.
	it('refuses a send after teardown begins', async () => {
		const child = createProcess({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
			writable: true,
		})

		const stopping = child.stop()
		const accepted = await child.send('after stop')
		await stopping

		expect(accepted).toBe(false)
	})

	it('collapses repeated stops and a concurrent abort onto one termination', async () => {
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
		'escalates to SIGKILL when the child traps SIGTERM and stays alive',
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

	// The flooding child traps the stop signal, so what its exit reports is whatever this host reports
	// for a trapped child — which is host-varying and therefore read at runtime rather than assumed.
	// The reading is taken through the same `stop` door the proof uses, from a real child that installs
	// a handler, with an untrapped child beside it as the control that proves the reading discriminates.
	// Where the two disagree the host delivers a cooperative signal a child can ignore, the grace window
	// elapses, and `SIGKILL` follows. Where they agree the host's stop path offers no signal to trap, so
	// no escalation exists to observe: measured on Windows 11 with Node v24.18.1 on 2026-08-21,
	// `taskkill /F /T` ends a trapped and an untrapped child alike at `{ code: 1, signal: null }`.
	it('caps retained lines while termination drains a flooding child', async () => {
		const trapping = createProcess({
			command: childCommand('trap'),
			workspace: process.cwd(),
			grace: 50,
		})
		const trappingIterator = trapping.lines[Symbol.asyncIterator]()
		const trapped = await trappingIterator.next()
		await trapping.stop()
		const trappedExit = await trapping.exit
		const untrapped = createProcess({
			command: childCommand('hang'),
			workspace: process.cwd(),
			grace: 50,
		})
		await untrapped.stop()
		const untrappedExit = await untrapped.exit

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

		expect(trapped.value).toBe('trapped')
		expect(ready.value).toBe('ready')
		expect(confirmed).toBe(true)
		// The probe against its control: either trapping the stop signal changes the terminal pair, and
		// the trapped child carries the escalation, or the two children report alike and this host's stop
		// path offers no signal to trap. A host that reported a trapped child differently without
		// escalating to `SIGKILL` fails here.
		expect(
			trappedExit.signal === 'SIGKILL' ||
				(trappedExit.code === untrappedExit.code && trappedExit.signal === untrappedExit.signal),
		).toBe(true)
		// The flooding child traps the same signal, so it ends exactly as this host ends a trapped child.
		// Where the host escalates, that reading is `SIGKILL` and this line carries the POSIX expectation.
		expect(exit).toEqual(trappedExit)
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
		'kills a grandchild through the tree while the root is still live',
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
		'kills a grandchild through the process group while the root is still live',
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
		// The documented outcome is the host's negative errno rather than any non-zero code, and
		// `null` satisfies "not zero" while carrying none of it. The errno is the host's, so its sign
		// is the property a caller can act on.
		const code = exit.code
		if (code === null) throw new Error('the spawn fault reported no code')
		expect(code).toBeLessThan(0)
	})

	it('reports a host process id from the moment construction returns and keeps it past exit', async () => {
		const child = createProcess({
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
			grace: 20,
		})

		const spawned = child.pid
		const exit = await child.exit

		if (spawned === undefined) throw new Error('the spawn reported no process id')
		expect(spawned).toBeGreaterThan(0)
		expect(child.pid).toBe(spawned)
		expect(exit).toEqual({ code: 0, signal: null })
	})

	it('declares the pid, code, and signal members, reports no id and a null live pair for a spawn that produced no child, and settles exit with the fault code', async () => {
		const child = createProcess({
			command: { file: 'orkestrel-nonexistent-binary', arguments: [] },
			workspace: process.cwd(),
			grace: 20,
		})

		// An absent member also reads undefined, so presence is pinned apart from the value: the
		// getters live on the class, and this line is false on a class that never declared them.
		expect('pid' in child && 'code' in child && 'signal' in child).toBe(true)

		const spawned = child.pid
		const live = { code: child.code, signal: child.signal }
		const exit = await child.exit

		expect(spawned).toBeUndefined()
		expect(live).toEqual({ code: null, signal: null })
		expect(child.pid).toBeUndefined()
		const code = exit.code
		if (code === null) throw new Error('the spawn fault reported no code')
		expect(code).toBeLessThan(0)
		// The host records the same negative errno on the child itself, so the synchronous pair and
		// the settled exit agree on the fault.
		expect(child.code).toBe(code)
	})

	it('reports a null code and signal while the child is live', async () => {
		const child = createProcess({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})

		const live = { code: child.code, signal: child.signal }
		await child.stop()
		await child.destroy()

		expect(live).toEqual({ code: null, signal: null })
	})

	it('reports the host terminal pair after the child exits', async () => {
		const child = createProcess({
			command: childCommand('exit', '7'),
			workspace: process.cwd(),
			grace: 20,
		})

		const exit = await child.exit

		expect(exit).toEqual({ code: 7, signal: null })
		expect(child.code).toBe(7)
		expect(child.signal).toBeNull()
	})

	it('reports the terminal pair while a descendant holds the stdio and exit stays pending', async () => {
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
			const settlement = await Promise.race([
				child.exit.then(() => 'closed'),
				waitForDelay(150).then(() => 'held'),
			])

			expect(settlement).toBe('held')
			expect(child.code).toBe(0)
			expect(child.signal).toBeNull()
		} finally {
			holds(() => process.kill(held, 'SIGKILL'))
			await child.destroy()
		}
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
