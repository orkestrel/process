import type { ProcessExit } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createRecorder, waitForDelay } from '@orkestrel/test'
import { isProcessError } from '@src/core'
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
		expect(exited.calls).toEqual([['job', { code: 0, signal: null }]])

		await manager.destroy()
	})

	it('stops one child, a named set, and reports liveness through the boolean overloads', async () => {
		const manager = createProcessManager()
		manager.launch('a', { command: childCommand('sleep'), workspace: process.cwd(), grace: 20 })
		manager.launch('b', { command: childCommand('sleep'), workspace: process.cwd(), grace: 20 })
		manager.launch('c', { command: childCommand('sleep'), workspace: process.cwd(), grace: 20 })

		const one = await manager.stop('a')
		const missing = await manager.stop('a')
		const set = await manager.stop(['b', 'c'])
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
		manager.launch('a', { command: childCommand('sleep'), workspace: process.cwd(), grace: 20 })
		manager.launch('b', { command: childCommand('sleep'), workspace: process.cwd(), grace: 20 })

		await manager.stop()

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
})
