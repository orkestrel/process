import type { ProcessExit } from '@src/core'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { holds } from '@orkestrel/contract'
import { createRecorder, waitForCondition, waitForDelay } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import { isProcessError, ProcessError } from '@src/core'
import { createSession } from '@src/server'
import { childCommand } from '../../../setupServer.js'

describe('Session bytes', () => {
	// The payload is chosen so no text path can carry it: a NUL at each end of the run, an invalid
	// UTF-8 lead byte, a lone carriage return, an embedded line feed, and no trailing terminator. A
	// decoding face would replace two of those bytes and a framing face would cut the payload at the
	// line feed, so the single event carrying all of them is what discriminates this face.
	it('delivers a binary payload byte-identical, framing nothing and splitting on no line feed', async () => {
		const payload = Uint8Array.from([0, 1, 255, 254, 13, 65, 10, 66, 128, 0])
		const chunks = createRecorder<readonly [Uint8Array]>()
		const session = createSession({
			command: {
				file: process.execPath,
				arguments: ['-e', `process.stdout.write(Buffer.from([${[...payload].join(',')}]))`],
			},
			workspace: process.cwd(),
			grace: 20,
			on: { stdout: chunks.handler },
		})

		const exit = await session.exit
		const received = Buffer.concat(chunks.calls.map((call) => call[0]))

		expect(exit).toEqual({ code: 0, signal: null, drained: true })
		expect([...received]).toEqual([...payload])
		// One host write of one small payload is one host read, so the line feed inside it started no
		// second event. A framer would have reported two.
		expect(chunks.count).toBe(1)
		await session.destroy()
	})

	it('concatenates a multi-chunk stream into the exact bytes the child wrote', async () => {
		const total = 512 * 1_024
		const chunks = createRecorder<readonly [Uint8Array]>()
		const session = createSession({
			command: {
				file: process.execPath,
				arguments: [
					'-e',
					`const b = Buffer.alloc(${total}); for (let i = 0; i < ${total}; i += 1) b[i] = i % 251; process.stdout.write(b)`,
				],
			},
			workspace: process.cwd(),
			grace: 20,
		})
		session.emitter.on('stdout', chunks.handler)

		await session.exit
		const received = Buffer.concat(chunks.calls.map((call) => call[0]))
		const wrong: number[] = []
		for (let index = 0; index < received.length; index += 1) {
			if (received[index] !== index % 251) wrong.push(index)
		}

		// The stream is far larger than one host read, so the assertion is about reassembly rather
		// than about a single chunk: every byte at its own offset, and no byte lost or repeated.
		expect(chunks.count).toBeGreaterThan(1)
		expect(received.length).toBe(total)
		expect(wrong).toEqual([])
		await session.destroy()
	})

	// The ownership contract, read off the arrays themselves. The raw spawn beside it is the control:
	// the same child, the same writes, read through the host's own `data` event. Every chunk that
	// event yields is a `Buffer` the stream allocated and still manages, and no chunk this face emits
	// is, which is what separates a copy from a forwarded reference on every host. How the host
	// allocated a given read is its own decision and is therefore read rather than assumed here; the
	// copy is what makes the emitted array own its whole buffer regardless of that decision, so a
	// consumer can keep one, mutate one, and read its backing buffer end to end without reaching
	// memory anything else holds.
	it('emits each stdout chunk as a plain owned array rather than the host buffer it read', async () => {
		const size = 64
		const writer = `let n = 0; const t = setInterval(() => { process.stdout.write(Buffer.alloc(${size}, n + 1)); n += 1; if (n === 4) { clearInterval(t); process.exit(0) } }, 20)`
		const emitted: Uint8Array[] = []
		const session = createSession({
			command: { file: process.execPath, arguments: ['-e', writer] },
			workspace: process.cwd(),
			grace: 20,
			on: {
				stdout: (chunk) => {
					emitted.push(chunk)
				},
			},
		})
		await session.exit

		const control = spawn(process.execPath, ['-e', writer], { stdio: ['ignore', 'pipe', 'ignore'] })
		const stream = control.stdout
		if (stream === null) throw new Error('the control spawn produced no stdout')
		const host: Uint8Array[] = []
		stream.on('data', (chunk: unknown) => {
			if (Buffer.isBuffer(chunk)) host.push(chunk)
		})
		await once(control, 'close')

		const first = emitted[0]
		if (first === undefined) throw new Error('the session emitted no chunk')
		first.fill(0xaa)

		expect(emitted.length).toBeGreaterThan(1)
		// The control: every chunk the host's own event yields is a `Buffer`, and none this face
		// emits is, so the payload a consumer holds is never the object the stream handed out. A face
		// that forwarded its chunk instead of copying fails exactly here.
		expect(host.length).toBeGreaterThan(1)
		expect(host.every((view) => Buffer.isBuffer(view))).toBe(true)
		expect(emitted.some((view) => Buffer.isBuffer(view))).toBe(false)
		expect(
			emitted.every((view) => view.byteOffset === 0 && view.buffer.byteLength === view.byteLength),
		).toBe(true)
		// Mutating an emitted chunk reaches its whole backing buffer and nothing beyond it.
		expect([...new Uint8Array(first.buffer)]).toEqual(Array.from({ length: size }, () => 0xaa))
		await session.destroy()
	})

	// Ordering, not merely quiet: the read ends are released after the terminal state is delivered,
	// so a consumer that treats the `exit` event as the end of the byte stream is right to.
	it('emits no stdout event after the exit event', async () => {
		const order: string[] = []
		const session = createSession({
			command: childCommand('chatty'),
			workspace: process.cwd(),
			grace: 20,
			on: {
				stdout: () => {
					order.push('stdout')
				},
				exit: () => {
					order.push('exit')
				},
			},
		})

		await session.exit
		await waitForDelay(50)

		expect(order.filter((moment) => moment === 'exit')).toEqual(['exit'])
		expect(order.indexOf('stdout')).toBe(0)
		expect(order.indexOf('exit')).toBe(order.length - 1)
		await session.destroy()
	})
})

describe('Session write', () => {
	it('echoes exactly the bytes written, appending no terminator', async () => {
		const payload = Uint8Array.from([0, 13, 10, 255, 65, 0])
		const received: Uint8Array[] = []
		const session = createSession({
			command: childCommand('raw-echo'),
			workspace: process.cwd(),
			grace: 20,
			on: {
				stdout: (chunk) => {
					received.push(chunk)
				},
			},
		})

		const accepted = await session.write(payload)
		await waitForCondition(
			'the child echoes every byte back',
			() => Buffer.concat(received).length >= payload.length,
			{ budget: 5_000 },
		)
		await session.end()
		await session.exit

		expect(accepted).toBe(true)
		// Byte-for-byte and no longer: a face that framed the write would add a terminator here, and
		// the length assertion is what catches one.
		expect([...Buffer.concat(received)]).toEqual([...payload])
		await session.destroy()
	})

	it('refuses a write after end, inside a stop, and after the child settles', async () => {
		const session = createSession({
			command: childCommand('raw-echo'),
			workspace: process.cwd(),
			grace: 20,
		})
		const open = await session.write(Uint8Array.from([65]))
		await session.end()
		const ended = await session.write(Uint8Array.from([66]))
		await session.exit
		const settled = await session.write(Uint8Array.from([67]))

		const terminating = createSession({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})
		const termination = terminating.stop()
		const stopping = await terminating.write(Uint8Array.from([68]))
		await termination

		// The open channel is the control: the same call on the same face, differing only in which
		// gate has closed by the time it runs.
		expect(open).toBe(true)
		expect(ended).toBe(false)
		expect(settled).toBe(false)
		expect(stopping).toBe(false)
		await session.destroy()
		await terminating.destroy()
	})

	// The bound `delivery` puts on an unconfirmed write, against the unbounded control beside it. The
	// same payload goes to the same non-reading child on both sides: the bounded one settles while
	// the child is still live, and the unbounded one is still pending when the reading is taken.
	it('settles an unconfirmed write false at the delivery bound while the child is still live', async () => {
		const errors = createRecorder<readonly [unknown]>()
		const payload = new Uint8Array(4 * 1_024 * 1_024)
		const bounded = createSession({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
			delivery: 50,
			on: { error: errors.handler },
		})
		const unbounded = createSession({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})

		const settled = await bounded.write(payload)
		const live = { code: bounded.code, signal: bounded.signal }
		const control = unbounded.write(payload)
		const raced = await Promise.race([control, waitForDelay(150).then(() => 'pending')])
		await unbounded.destroy()

		expect(settled).toBe(false)
		expect(errors.count).toBe(0)
		// The terminal pair is still null, so no exit and no teardown settled this write: the bound did.
		expect(live).toEqual({ code: null, signal: null })
		expect(raced).toBe('pending')
		expect(await control).toBe(false)
		await bounded.destroy()
	})

	// Package-initiated closure stays quiet: nothing host-reported happened, so there is nothing to
	// report. The order is pinned beside it, because the settle belongs to the stop path rather than
	// to whatever runs after `destroy`.
	it('settles a pending write false inside teardown and emits no error', async () => {
		const errors = createRecorder<readonly [unknown]>()
		const order: string[] = []
		const session = createSession({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
			on: { error: errors.handler },
		})

		const pending = session.write(new Uint8Array(4 * 1_024 * 1_024)).then((accepted) => {
			order.push('write')
			return accepted
		})
		const raced = await Promise.race([pending, waitForDelay(150).then(() => 'pending')])
		await session.destroy()
		order.push('teardown')

		expect(raced).toBe('pending')
		expect(await pending).toBe(false)
		expect(order).toEqual(['write', 'teardown'])
		expect(errors.count).toBe(0)
	})

	// A host-reported channel fault, driven through the door this host offers: a write the child never
	// read, still pending when the child exits on its own. The parent's pipe then fails — `write EOF`
	// on Windows, `EPIPE` on POSIX — so this asserts the engine's shape rather than the host's errno.
	it('refuses the write and emits one protocol error when the host reports a stdin fault', async () => {
		const errors = createRecorder<readonly [unknown]>()
		const received: Uint8Array[] = []
		const session = createSession({
			command: {
				file: process.execPath,
				arguments: [
					'-e',
					'process.stdout.write("ready\\n"); setTimeout(() => process.exit(0), 150)',
				],
				input: 'initial input',
			},
			workspace: process.cwd(),
			grace: 20,
			on: {
				error: errors.handler,
				stdout: (chunk) => {
					received.push(chunk)
				},
			},
		})
		await waitForCondition(
			'the child announces that it is running',
			() => Buffer.concat(received).toString('utf8').includes('ready\n'),
			{ budget: 5_000 },
		)

		const settled = await session.write(new Uint8Array(4 * 1_024 * 1_024))
		const refused = await session.write(Uint8Array.from([65]))
		await session.exit
		await session.destroy()

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
})

describe('Session end', () => {
	// `end` closes the channel and nothing else. The control is the same call over a child that reads
	// its input and exits on end of it, so the live reading below is a fact about this child rather
	// than about the window being too short to observe anything.
	it('leaves the child running when the input channel closes', async () => {
		const live = createSession({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})
		const reading = createSession({
			command: childCommand('raw-echo'),
			workspace: process.cwd(),
			grace: 20,
		})

		await live.end()
		await reading.end()
		const observed = await Promise.race([
			live.ending.then(() => 'ended'),
			waitForDelay(200).then(() => 'live'),
		])
		const control = await Promise.race([
			reading.ending.then(() => 'ended'),
			waitForDelay(5_000).then(() => 'live'),
		])

		expect(observed).toBe('live')
		expect(live.stopping).toBe(false)
		expect(live.settled).toBe(false)
		expect({ code: live.code, signal: live.signal }).toEqual({ code: null, signal: null })
		// The control ends itself because its input ended, which is what the live reading is measured
		// against: closing the channel reaches a child that reads it and reaches no other.
		expect(control).toBe('ended')
		await live.destroy()
		await reading.destroy()
	})

	it('shares one barrier across every end call', async () => {
		const session = createSession({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})

		const first = session.end()
		const second = session.end()
		await first
		const third = session.end()

		expect(second).toBe(first)
		expect(third).toBe(first)
		await session.destroy()
	})

	// The cooperative shutdown a transport runs: close the input, let the child finish on its own,
	// and never signal it. `stopping` false at the end is what records that no termination happened.
	it('settles ending and exit when the child exits on its own after end, with no stop', async () => {
		const exits = createRecorder<readonly [ProcessExit]>()
		const session = createSession({
			command: childCommand('raw-echo'),
			workspace: process.cwd(),
			grace: 20,
			on: { exit: exits.handler },
		})

		expect(await session.write(Uint8Array.from([65, 66]))).toBe(true)
		await session.end()
		await session.ending
		const exit = await session.exit

		expect(exit).toEqual({ code: 0, signal: null, drained: true })
		expect(session.stopping).toBe(false)
		expect(session.settled).toBe(true)
		expect(exits.count).toBe(1)
		await session.destroy()
	})

	// The escalation the same transport runs when the child ignores end of input: race `ending`
	// against a window of the caller's own, then terminate on expiry.
	it('escalates to stop when the child outlives the closed channel', async () => {
		const session = createSession({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 50,
		})

		await session.end()
		const cooperative = await Promise.race([
			session.ending.then(() => 'ended'),
			waitForDelay(150).then(() => 'expired'),
		])
		const confirmed = await session.stop()
		const exit = await session.exit

		expect(cooperative).toBe('expired')
		expect(confirmed).toBe(true)
		expect(session.stopping).toBe(true)
		expect(exit.code !== null || exit.signal !== null).toBe(true)
		await session.destroy()
	})

	// A channel the consumer ended stays quiet for its remaining life. Its control is the row named
	// `refuses the write and emits one protocol error when the host reports a stdin fault`: the same
	// child, the same unread payload, the same host fault, differing only in whether `end` closed the
	// channel first — and that row records one error where this one records none.
	it('keeps an ended channel quiet when a pending write later faults', async () => {
		const errors = createRecorder<readonly [unknown]>()
		const received: Uint8Array[] = []
		const session = createSession({
			command: {
				file: process.execPath,
				arguments: [
					'-e',
					'process.stdout.write("ready\\n"); setTimeout(() => process.exit(0), 200)',
				],
			},
			workspace: process.cwd(),
			grace: 20,
			on: {
				error: errors.handler,
				stdout: (chunk) => {
					received.push(chunk)
				},
			},
		})
		await waitForCondition(
			'the child announces that it is running',
			() => Buffer.concat(received).toString('utf8').includes('ready\n'),
			{ budget: 5_000 },
		)

		const pending = session.write(new Uint8Array(4 * 1_024 * 1_024))
		await session.end()
		const settled = await pending
		await session.exit

		expect(settled).toBe(false)
		expect(errors.count).toBe(0)
		await session.destroy()
	})

	it('resolves end after a stop and changes nothing', async () => {
		const session = createSession({
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})

		await session.stop()
		const before = {
			settled: session.settled,
			stopping: session.stopping,
			evidence: session.evidence,
			exit: await session.exit,
		}
		await session.end()
		const after = {
			settled: session.settled,
			stopping: session.stopping,
			evidence: session.evidence,
			exit: await session.exit,
		}

		expect(before.settled).toBe(true)
		expect(after).toEqual(before)
		await session.destroy()
	})
})

describe('Session endings', () => {
	// The two endings pulled apart by the one case that separates them: the root exits while a
	// descendant it spawned keeps the inherited read ends open. The control is the same face over a
	// child with no descendant, where the two settle together, so the pending reading below is a fact
	// about the descendant rather than about the race being read too early.
	it('settles ending at the native exit while exit waits on a descendant holding the pipe', async () => {
		const received: Uint8Array[] = []
		const session = createSession({
			command: childCommand('orphan'),
			workspace: process.cwd(),
			grace: 20,
			drain: 500,
			on: {
				stdout: (chunk) => {
					received.push(chunk)
				},
			},
		})
		await waitForCondition(
			'the orphan root announces its descendant and reports that it is exiting',
			() => Buffer.concat(received).toString('utf8').includes('exiting\n'),
			{ budget: 5_000 },
		)
		const announced =
			Buffer.concat(received)
				.toString('utf8')
				.split(/\r\n|\n/u)[0] ?? ''
		const held = Number.parseInt(announced.replace('grandchild:', ''), 10)

		try {
			await session.ending
			const holding = isRunning(held)
			const settledAtEnding = session.settled
			const pending = await Promise.race([
				session.exit.then(() => 'settled'),
				waitForDelay(150).then(() => 'pending'),
			])
			const exit = await session.exit

			const alone = createSession({
				command: childCommand('exit', '0'),
				workspace: process.cwd(),
				grace: 20,
				drain: 500,
			})
			await alone.ending
			const together = await Promise.race([
				alone.exit.then(() => 'settled'),
				waitForDelay(150).then(() => 'pending'),
			])

			// The descendant still holds the read ends at the moment the child's own ending settled,
			// so nothing closed them and only the bound can end the observation.
			expect(holding).toBe(true)
			expect(settledAtEnding).toBe(false)
			expect(session.code).toBe(0)
			expect(pending).toBe('pending')
			expect(exit).toEqual({ code: 0, signal: null, drained: false })
			expect(session.stopping).toBe(false)
			// The control settles both at once, which is what makes the pending reading discriminate.
			expect(together).toBe('settled')
			await alone.destroy()
		} finally {
			holds(() => process.kill(held, 'SIGKILL'))
			await session.destroy()
		}
	})

	it('delivers the terminal state on the exit event and the exit promise alike', async () => {
		const exits = createRecorder<readonly [ProcessExit]>()
		const session = createSession({
			command: childCommand('exit', '7'),
			workspace: process.cwd(),
			grace: 20,
			on: { exit: exits.handler },
		})

		const promised = await session.exit
		const again = await session.exit

		expect(promised).toEqual({ code: 7, signal: null, drained: true })
		expect(again).toEqual(promised)
		expect(exits.count).toBe(1)
		expect(exits.calls[0]?.[0]).toEqual(promised)
		expect(session.code).toBe(7)
		expect(session.signal).toBeNull()
		await session.destroy()
	})

	it('reports a host process id, the live stderr chunks, and the byte-bounded frozen tail', async () => {
		const chunks = createRecorder<readonly [string]>()
		const session = createSession({
			command: childCommand('evidence'),
			workspace: process.cwd(),
			grace: 20,
			evidence: 16,
			on: { stderr: chunks.handler },
		})
		const spawned = session.pid

		const exit = await session.exit
		const live = chunks.calls.map((call) => call[0]).join('')
		const frozen = session.evidence

		if (spawned === undefined) throw new Error('the spawn reported no process id')
		expect(spawned).toBeGreaterThan(0)
		expect(session.pid).toBe(spawned)
		expect(exit.code).toBe(7)
		expect(live).toContain('x'.repeat(4_096))
		expect(live).toContain('token=evidence-secret-tail')
		expect(Buffer.byteLength(frozen)).toBeLessThanOrEqual(16)
		expect(frozen.endsWith('tail')).toBe(true)
		expect(session.evidence).toBe(frozen)
		await session.destroy()
	})

	it('emits the error cause on a spawn fault while still settling both endings', async () => {
		const errors = createRecorder<readonly [unknown]>()
		const session = createSession({
			command: { file: 'orkestrel-nonexistent-binary', arguments: [] },
			workspace: process.cwd(),
			grace: 20,
			on: { error: errors.handler },
		})

		await session.ending
		const exit = await session.exit

		expect(session.pid).toBeUndefined()
		expect(errors.count).toBe(1)
		expect(errors.calls[0]?.[0]).toBeInstanceOf(Error)
		expect(session.settled).toBe(true)
		const code = exit.code
		if (code === null) throw new Error('the spawn fault reported no code')
		expect(code).toBeLessThan(0)
		await session.destroy()
	})
})

describe('Session validation', () => {
	it('refuses a timer option and an empty workspace before anything is spawned', () => {
		expect(() =>
			createSession({
				command: childCommand('exit', '0'),
				workspace: process.cwd(),
				grace: 2 ** 31,
			}),
		).toThrow(ProcessError)
		expect(() => createSession({ command: childCommand('exit', '0'), workspace: '' })).toThrow(
			ProcessError,
		)
	})

	it('codes a refused input as invalid and carries the rejected value', () => {
		let thrown: unknown
		try {
			createSession({
				command: childCommand('exit', '0'),
				workspace: process.cwd(),
				evidence: -1,
			})
		} catch (error) {
			thrown = error
		}

		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
		expect(isProcessError(thrown) ? thrown.context?.value : undefined).toBe(-1)
	})

	it('reads each option once, so a getter runs while nothing has started', async () => {
		let reads = 0
		const session = createSession({
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
			get grace() {
				reads += 1
				return 20
			},
		})

		const exit = await session.exit

		expect(reads).toBe(1)
		expect(exit.code).toBe(0)
		await session.destroy()
	})
})
