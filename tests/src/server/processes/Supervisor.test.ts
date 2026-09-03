import type { ProcessExit } from '@src/core'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { holds } from '@orkestrel/contract'
import { createRecorder, waitForCondition, waitForDelay } from '@orkestrel/test'
import { Supervisor } from '@src/server'
import { childCommand } from '../../../setupServer.js'

// The engine drives a real child through a literal face, which is what a consumer composing a
// third face of its own writes. Each case records the moments in one shared recorder, so the order
// the engine reports them in is read off the sequence rather than inferred from separate counts.

describe('Supervisor moments', () => {
	it('hands the face its terminal moment before it releases the face', async () => {
		const moments = createRecorder<readonly [string]>()
		const exits = createRecorder<readonly [ProcessExit]>()
		const engine = new Supervisor(
			{ command: childCommand('exit', '0'), workspace: process.cwd(), grace: 20 },
			{
				chunk: () => moments.handler('chunk'),
				fault: () => moments.handler('fault'),
				close: () => moments.handler('close'),
				terminal: (exit) => {
					exits.handler(exit)
					moments.handler('terminal')
				},
				teardown: () => moments.handler('teardown'),
			},
		)

		try {
			const exit = await engine.exit
			const beforeTeardown = moments.calls.map((call) => call[0])
			await engine.destroy()
			const order = moments.calls.map((call) => call[0])

			// The face's read pipeline ends, then the frozen state arrives, and only a `destroy` releases
			// the face. A teardown that ran first would leave a consumer's own surface gone while the
			// terminal value it describes was still being delivered.
			expect(beforeTeardown).not.toContain('teardown')
			expect(order.indexOf('close')).toBeLessThan(order.indexOf('terminal'))
			expect(order.indexOf('terminal')).toBeLessThan(order.indexOf('teardown'))
			expect(order.filter((moment) => moment === 'terminal')).toEqual(['terminal'])
			expect(order.filter((moment) => moment === 'teardown')).toEqual(['teardown'])
			expect(exits.calls.map((call) => call[0])).toEqual([exit])
			expect(exit).toEqual({ code: 0, signal: null, drained: true })
		} finally {
			await engine.destroy()
		}
	})

	// A paused stdout holds the child's own write, and therefore its exit. `relieve` is the moment
	// the face is told to let go, and it is worth nothing after the termination sequence: by then the
	// signal has already been sent to a child that cannot write.
	//
	// The case outlives the condition budget below it, so a condition that never holds reports its
	// own description rather than this case's timeout.
	it(
		'releases the face before the termination sequence rather than after it',
		{ timeout: 20_000 },
		async () => {
			const moments = createRecorder<readonly [string]>()
			const engine = new Supervisor(
				{ command: childCommand('flood'), workspace: process.cwd(), grace: 20, drain: 400 },
				{
					chunk: () => moments.handler('chunk'),
					fault: () => moments.handler('fault'),
					relieve: () => moments.handler('relieve'),
					close: () => moments.handler('close'),
					terminal: () => moments.handler('terminal'),
					teardown: () => moments.handler('teardown'),
				},
			)

			try {
				// No consumer is attached, so the host stream stays paused and buffers: the face is holding
				// this child's backpressure for real.
				await waitForCondition(
					'the flood child fills the read end no consumer is draining',
					() => engine.stdout.readableLength > 0,
					{ budget: 10_000 },
				)

				const termination = engine.stop()
				const relieved = moments.calls.map((call) => call[0]).includes('relieve')
				const settledAtRelease = engine.settled
				engine.stdout.resume()
				await termination
				await engine.exit
				await engine.destroy()
				const order = moments.calls.map((call) => call[0])

				expect(relieved).toBe(true)
				expect(settledAtRelease).toBe(false)
				expect(engine.stopping).toBe(true)
				expect(order.filter((moment) => moment === 'relieve')).toEqual(['relieve'])
				expect(order.indexOf('relieve')).toBeLessThan(order.indexOf('terminal'))
			} finally {
				await engine.destroy()
			}
		},
	)

	// The case outlives the condition budget below it, so a condition that never holds reports its
	// own description rather than this case's timeout.
	it(
		'settles ending at the native exit while a descendant holds the read ends open',
		{ timeout: 20_000 },
		async () => {
			const moments = createRecorder<readonly [string]>()
			const received: string[] = []
			// The drain window is left at its default, so the pendency race below reads the same
			// margin the sibling comparator in `Process.test.ts` reads. An override sized just past
			// the race turns a contended run into a red gate reporting a timeout.
			const engine = new Supervisor(
				{ command: childCommand('orphan'), workspace: process.cwd(), grace: 20 },
				{
					chunk: () => moments.handler('chunk'),
					fault: () => moments.handler('fault'),
					close: () => moments.handler('close'),
					terminal: () => moments.handler('terminal'),
					teardown: () => moments.handler('teardown'),
				},
			)
			engine.stdout.on('data', (chunk: Buffer) => {
				received.push(chunk.toString('utf8'))
			})

			let held: number | undefined
			try {
				await waitForCondition(
					'the orphan root announces the descendant holding its read ends',
					() => received.join('').includes('\n'),
					{ budget: 10_000 },
				)
				const [line = ''] = received.join('').split(/\r\n|\n/u)
				held = Number.parseInt(line.replace('grandchild:', ''), 10)

				await engine.ending
				const settlement = await Promise.race([
					engine.exit.then(() => 'settled'),
					waitForDelay(150).then(() => 'pending'),
				])

				// The child's own ending and the supervision's ending are distinct: the root exited, and
				// the terminal moment still waits out the drain window a descendant is holding open.
				expect(settlement).toBe('pending')
				expect(engine.code).toBe(0)
				expect(engine.settled).toBe(false)
				expect((await engine.exit).drained).toBe(false)
				expect(moments.calls.map((call) => call[0])).not.toContain('fault')
			} finally {
				const pid = held
				if (pid !== undefined) holds(() => process.kill(pid, 'SIGKILL'))
				await engine.destroy()
			}
		},
	)
})

describe('Supervisor channel', () => {
	it('refuses a delivery once a termination has begun', async () => {
		const moments = createRecorder<readonly [string]>()
		const engine = new Supervisor(
			{
				command: childCommand('raw-echo'),
				workspace: process.cwd(),
				writable: true,
				grace: 20,
			},
			{
				chunk: () => moments.handler('chunk'),
				fault: () => moments.handler('fault'),
				close: () => moments.handler('close'),
				terminal: () => moments.handler('terminal'),
				teardown: () => moments.handler('teardown'),
			},
		)

		try {
			const accepted = await engine.deliver(Buffer.from('before\n', 'utf8'))
			const termination = engine.stop()
			const refused = await engine.deliver(Buffer.from('after\n', 'utf8'))
			await termination
			await engine.destroy()

			// Teardown discards the channel, so a write accepted after a stop began would claim a
			// delivery the package is about to throw away.
			expect(accepted).toBe(true)
			expect(refused).toBe(false)
			expect(moments.calls.map((call) => call[0])).not.toContain('fault')
		} finally {
			await engine.destroy()
		}
	})

	it('shares one barrier across every close of the input channel', async () => {
		const moments = createRecorder<readonly [string]>()
		const engine = new Supervisor(
			{
				command: childCommand('raw-echo'),
				workspace: process.cwd(),
				writable: true,
				grace: 20,
			},
			{
				chunk: () => moments.handler('chunk'),
				fault: () => moments.handler('fault'),
				close: () => moments.handler('close'),
				terminal: () => moments.handler('terminal'),
				teardown: () => moments.handler('teardown'),
			},
		)

		try {
			const first = engine.end()
			const second = engine.end()
			await first
			const refused = await engine.deliver(Buffer.from('after\n', 'utf8'))
			const exit = await engine.exit
			await engine.destroy()

			// The child ends itself because its input ended, so the closure terminated nothing: no signal
			// was sent and the exit is the child's own.
			expect(first).toBe(second)
			expect(refused).toBe(false)
			expect(exit).toEqual({ code: 0, signal: null, drained: true })
			expect(moments.calls.map((call) => call[0])).not.toContain('fault')
		} finally {
			await engine.destroy()
		}
	})
})
