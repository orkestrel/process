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
	// carried is the only observer that child ever has. Its terminal event is what separates a refusal
	// that spawned and cleaned up from a refusal that never spawned at all: every other observable
	// here reads the same either way.
	it(
		'refuses a launch whose own options destroyed the registry mid-construction, and tears down the child that launch spawned',
		// The fixture exits on `SIGTERM`, so the refused child's teardown is bounded by `grace` and the
		// confirmation of that exit rather than by the `SIGKILL` window. The condition budget outlasts
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
			const settled = refused.count

			// The control is the same fixture, the same hook, and the same barrier with the race removed.
			// A registered child delivers its terminal moment to an `on` hook, so an empty recorder above
			// reports a child that never existed rather than a hook this path never installs.
			const covered = createProcessManager()
			const registered = createRecorder<readonly [ProcessExit]>()
			covered.launch('registered', {
				command: childCommand('sleep'),
				workspace: process.cwd(),
				grace: 20,
				on: { exit: registered.handler },
			})
			await covered.destroy()

			// Read the terminal moment again on its own budget before asserting the snapshot, so a
			// snapshot that was empty at the barrier is diagnosed as barrier timing rather than as a
			// child that never terminated.
			await waitForCondition(
				'the refused launch reaches the terminal moment of the child it spawned',
				() => refused.count === 1,
				{ budget: 5_000 },
			)

			expect(isProcessError(thrown)).toBe(true)
			expect(isProcessError(thrown) ? thrown.code : undefined).toBe('protocol')
			expect(manager.count).toBe(0)
			expect(registered.count).toBe(1)
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

	// The registry refuses this launch and tears its child down itself, so nothing else can observe
	// that child. The barrier is therefore the only thing that can carry the teardown, and this asks
	// whether it does: the terminal moment of the child the registry started tearing down must have
	// arrived by the time the caller resumes.
	it('reaches the terminal moment of a child spawned during a destroy race before its barrier resolves', async () => {
		const manager = createProcessManager()
		const scratch = createScratch()
		const marker = join(scratch.path, 'raced.pid')
		const raced = createRecorder<readonly [ProcessExit]>()
		const teardown: Array<Promise<void>> = []
		let pid = 0

		try {
			let thrown: unknown
			try {
				manager.launch('racer', {
					command: childCommand('announce', marker),
					workspace: process.cwd(),
					on: { exit: raced.handler },
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
			const settled = raced.count

			// The control is the same fixture, the same recorder, and the same barrier with the race
			// removed: a registered child's terminal moment lands before `destroy` resolves, so the
			// recorder reads one there whenever the barrier carried the teardown.
			const covered = createProcessManager()
			const registered = createRecorder<readonly [ProcessExit]>()
			covered.launch('registered', {
				command: childCommand('announce', join(scratch.path, 'registered.pid')),
				workspace: process.cwd(),
				grace: 20,
				on: { exit: registered.handler },
			})
			await covered.destroy()

			// The refused launch really spawned a child that really ends, so a terminal moment absent
			// at the barrier is one the barrier did not wait for rather than one that never arrives.
			await waitForCondition(
				'the refused launch tears down the child it spawned',
				() => raced.count === 1,
				{ budget: 10_000 },
			)
			if (existsSync(marker)) pid = Number.parseInt(readFileSync(marker, 'utf8'), 10)

			expect(isProcessError(thrown) ? thrown.code : undefined).toBe('protocol')
			expect(registered.count).toBe(1)
			expect(raced.count).toBe(1)
			expect(settled).toBe(1)
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
