import type { ProcessExit } from '@src/core'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { holds } from '@orkestrel/contract'
import { createRecorder, waitForCondition, waitForDelay } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { isProcessError, ProcessError } from '@src/core'
import { createProcessManager } from '@src/server'
import { childCommand } from '../../setupServer.js'

describe('ProcessManager', () => {
	it('registers children by id, in launch order, and reports the live count', async () => {
		const manager = createProcessManager()
		const first = manager.launch('a', {
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})
		const second = manager.launch('b', {
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})

		expect(manager.count).toBe(2)
		expect(manager.process('a')).toBe(first)
		expect(manager.process('b')).toBe(second)
		expect(manager.process('missing')).toBeUndefined()
		expect(manager.processes()).toEqual([first, second])

		await manager.destroy()
	})

	it('emits launch on registration and throws a duplicate error on a live id', async () => {
		const manager = createProcessManager()
		const launched = createRecorder<readonly [string]>()
		manager.emitter.on('launch', launched.handler)
		const options = { command: childCommand('sleep'), workspace: process.cwd(), grace: 20 }

		manager.launch('unit', options)
		let thrown: unknown
		try {
			manager.launch('unit', options)
		} catch (error) {
			thrown = error
		}

		expect(launched.calls).toEqual([['unit']])
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('duplicate')

		await manager.destroy()
	})

	it('auto-evicts a settled child and emits its departure', async () => {
		const manager = createProcessManager()
		const exited = createRecorder<readonly [string, ProcessExit]>()
		manager.emitter.on('exit', exited.handler)

		const child = manager.launch('job', {
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
			grace: 20,
		})
		await child.exit
		await waitForDelay()

		expect(manager.count).toBe(0)
		expect(manager.process('job')).toBeUndefined()
		expect(exited.calls).toEqual([['job', { code: 0, signal: null, drained: true }]])

		await manager.destroy()
	})

	it('still holds the child while a listener on its own exit event runs', async () => {
		const manager = createProcessManager()
		const child = manager.launch('job', {
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
			grace: 20,
		})
		let registered: boolean | undefined
		child.emitter.on('exit', () => {
			registered = manager.process('job') === child
		})

		await child.exit
		await waitForDelay()

		expect(registered).toBe(true)
		expect(manager.count).toBe(0)

		await manager.destroy()
	})

	it('ignores a forged exit event and keeps the child registered', async () => {
		const manager = createProcessManager()
		const child = manager.launch('forged', {
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})

		child.emitter.emit('exit', { code: 0, signal: null, drained: true })
		await waitForDelay()

		expect(manager.count).toBe(1)
		expect(manager.process('forged')).toBe(child)

		await manager.destroy()
	})

	it('releases a reserved id when construction refuses the options', async () => {
		const manager = createProcessManager()

		expect(() =>
			manager.launch('slot', {
				command: childCommand('exit', '0'),
				workspace: process.cwd(),
				backlog: 0,
			}),
		).toThrow(ProcessError)
		const child = manager.launch('slot', {
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
		})

		expect(manager.process('slot')).toBe(child)

		await manager.destroy()
	})

	it('refuses a launch once destruction has begun', async () => {
		const manager = createProcessManager()
		const ending = manager.destroy()

		let thrown: unknown
		try {
			manager.launch('late', { command: childCommand('exit', '0'), workspace: process.cwd() })
		} catch (error) {
			thrown = error
		}
		await ending

		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('protocol')
	})

	// The refusal hands the caller nothing and tears its own child down, so a hook the refused options
	// carried is the only observer that child ever has. Its terminal event answers the two questions
	// nothing else here can separate: whether the launch spawned a child at all, and whether the
	// destroy barrier carried that child's teardown. The refusal, the empty registry, and the absent
	// handle read the same for a refusal that spawned and cleaned up, a refusal that spawned nothing,
	// and a refusal whose child outlived the barrier.
	it(
		'refuses a launch whose own options destroyed the registry mid-construction, and reaches the terminal moment of the child that launch spawned before its barrier resolves',
		// The fixture handles `SIGTERM`, so the refused child's teardown is bounded by `grace` plus the
		// confirmation of its exit rather than by the `SIGKILL` window. The condition budget outlasts
		// that bound, so its expiry reports a terminal moment that never arrived rather than one that
		// arrived late. The timeout clears the budget, the refused launch's barrier, the control's
		// barrier, and the real spawns, sized from this file's cost inside a full contended
		// `npm run test:src`.
		{ timeout: 15_000 },
		async () => {
			const manager = createProcessManager()
			const refused = createRecorder<readonly [ProcessExit]>()
			const teardown: Array<Promise<void>> = []

			let thrown: unknown
			try {
				manager.launch('racer', {
					command: childCommand('sleep'),
					workspace: process.cwd(),
					on: { exit: refused.handler },
					// Reading an option is the one point a caller's own code runs between the destroy
					// check and the spawned child, so a getter is the narrowest form of that window.
					get grace() {
						if (teardown.length === 0) teardown.push(manager.destroy())
						return 20
					},
				})
			} catch (error) {
				thrown = error
			}
			await Promise.all(teardown)
			// The recorder as the barrier resolved. Every later read waits, so this snapshot is the only
			// value that can report whether the barrier itself carried the teardown.
			const settled = refused.count

			// The control is the same fixture, the same hook, and the same barrier with the race removed.
			// A registered child delivers its terminal moment to an `on` hook before `destroy` resolves,
			// so an empty recorder above reports a child that never existed rather than a hook this path
			// never installs.
			const covered = createProcessManager()
			const registered = createRecorder<readonly [ProcessExit]>()
			covered.launch('registered', {
				command: childCommand('sleep'),
				workspace: process.cwd(),
				grace: 20,
				on: { exit: registered.handler },
			})
			await covered.destroy()
			// Read the control before waiting on the refused recorder, so an uninstalled hook and an
			// absent refused child fail at different lines.
			expect(registered.count).toBe(1)

			// Read the refused recorder again on its own budget, so a snapshot that was empty at the
			// barrier is diagnosed as barrier timing rather than as a child that never terminated.
			await waitForCondition(
				'the refused launch reaches the terminal moment of the child it spawned',
				() => refused.count === 1,
				{ budget: 5_000 },
			)
			const terminal = refused.calls[0]?.[0]

			expect(isProcessError(thrown)).toBe(true)
			expect(isProcessError(thrown) ? thrown.code : undefined).toBe('protocol')
			expect(manager.count).toBe(0)
			// A launch that spawned nothing reaches the terminal moment too: a spawn fault settles the
			// host's negative errno as the code, and a cutoff that confirmed nothing settles both fields
			// null. Only a code the child itself returned or a signal that ended it reports a child that
			// really ran, and this fixture ends one of those two ways on every host.
			expect(terminal).toSatisfy(
				(pair: ProcessExit | undefined) =>
					pair !== undefined && ((pair.code !== null && pair.code >= 0) || pair.signal !== null),
				'the refused launch recorded the terminal pair of a child that ran',
			)
			expect(settled).toBe(1)
		},
	)

	it('strands no child when an option getter destroys the registry and then throws', async () => {
		const manager = createProcessManager()
		const scratch = createScratch()
		const marker = join(scratch.path, 'stranded.pid')
		const teardown: Array<Promise<void>> = []
		let pid = 0

		try {
			let thrown: unknown
			try {
				manager.launch('thrower', {
					command: childCommand('announce', marker),
					workspace: process.cwd(),
					grace: 20,
					// A getter that tears the registry down and then refuses. Nothing can release a
					// child spawned before this ran: the throw leaves no reference to it and the
					// destroy barrier it started has already settled.
					get writable(): boolean {
						if (teardown.length === 0) teardown.push(manager.destroy())
						throw new Error('option getter refused')
					},
				})
			} catch (error) {
				thrown = error
			}
			await Promise.all(teardown)
			// The fixture publishes its own process id the moment it starts, so an absent marker after
			// the child-startup window proves that the refused launch spawned nothing at all.
			await waitForDelay(1_000)
			if (existsSync(marker)) pid = Number.parseInt(readFileSync(marker, 'utf8'), 10)

			expect(thrown).toBeInstanceOf(Error)
			expect(isProcessError(thrown)).toBe(false)
			expect(manager.count).toBe(0)
			expect(existsSync(marker)).toBe(false)
			expect(pid).toBe(0)
		} finally {
			if (pid > 0) holds(() => process.kill(pid, 'SIGKILL'))
			scratch.destroy()
		}
	})

	it('stops one child, a named set, and reports liveness through the boolean overloads', async () => {
		const manager = createProcessManager()
		const first = manager.launch('a', {
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})
		const second = manager.launch('b', {
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})
		const third = manager.launch('c', {
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})

		const one = await manager.stop('a')
		await first.exit
		await waitForDelay()
		const missing = await manager.stop('a')
		const set = await manager.stop(['b', 'c'])
		await Promise.all([second.exit, third.exit])
		await waitForDelay()
		const partial = await manager.stop(['c', 'missing'])

		expect(one).toBe(true)
		expect(missing).toBe(false)
		expect(set).toBe(true)
		expect(partial).toBe(false)
		expect(manager.count).toBe(0)

		await manager.destroy()
	})

	it('stops every live child on the no-argument overload', async () => {
		const manager = createProcessManager()
		const first = manager.launch('a', {
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})
		const second = manager.launch('b', {
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
		})

		await manager.stop()
		await Promise.all([first.exit, second.exit])
		await waitForDelay()

		expect(manager.count).toBe(0)
		await manager.destroy()
	})

	it('destroys every child and the registry emitter, and shares one barrier', async () => {
		const manager = createProcessManager()
		manager.launch('a', { command: childCommand('sleep'), workspace: process.cwd(), grace: 20 })

		const ending = manager.destroy()
		expect(manager.destroy()).toBe(ending)
		await ending

		expect(manager.count).toBe(0)
		expect(manager.emitter.destroyed).toBe(true)
	})

	// Version 0.0.5 left this registry holding a child whose `exit` promise a descendant deferred for
	// that descendant's whole life, so the departure never landed. The bound is what ends it now, and
	// the departure carries which way the terminal moment arrived.
	it('evicts a child whose descendant holds the pipe at the drain cutoff and reports the departure undrained', async () => {
		const manager = createProcessManager()
		const exited = createRecorder<readonly [string, ProcessExit]>()
		manager.emitter.on('exit', exited.handler)
		const holder = manager.launch('holder', {
			command: childCommand('orphan'),
			workspace: process.cwd(),
			grace: 20,
			drain: 200,
		})
		// The control is an ordinary child in the same registry, torn down by the same call and the
		// same bound. Its own streams close, so it departs through the close rather than the cutoff.
		manager.launch('ordinary', {
			command: childCommand('sleep'),
			workspace: process.cwd(),
			grace: 20,
			drain: 200,
		})
		const iterator = holder.lines[Symbol.asyncIterator]()
		const first = await iterator.next()
		const held = Number.parseInt(String(first.value).replace('grandchild:', ''), 10)

		try {
			await waitForCondition(
				'the orphan root exits and leaves its descendant holding the pipe',
				() => holder.code !== null,
				{ budget: 5_000 },
			)

			const started = performance.now()
			await manager.destroy()
			const elapsed = performance.now() - started
			// Nothing closed the pipe: the holder is alive at the instant the barrier resolved.
			const holding = isRunning(held)
			const holderExit = exited.calls.find((call) => call[0] === 'holder')?.[1]
			const ordinaryExit = exited.calls.find((call) => call[0] === 'ordinary')?.[1]

			expect(holding).toBe(true)
			expect(exited.count).toBe(2)
			expect(ordinaryExit?.drained).toBe(true)
			expect(holderExit?.drained).toBe(false)
			expect(manager.count).toBe(0)
			// The registry owed one bounded tree kill plus the 200ms bound. Without the bound it owes
			// the descendant's whole life and never returns.
			expect(elapsed).toBeLessThan(2_000)
		} finally {
			holds(() => process.kill(held, 'SIGKILL'))
		}
	})
})
