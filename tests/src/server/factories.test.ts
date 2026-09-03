import type { ProcessExit } from '@src/core'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRecorder, waitForCondition } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { isProcessError } from '@src/core'
import { createProcess, createProcessManager, createSession } from '@src/server'
import { childCommand } from '../../setupServer.js'

// The members each factory's return must carry, read off the interface each one declares as its
// return type. A factory that returned the wrong entity, or a class that lost a member, fails here
// rather than at the first call site that reaches for one.
const PROCESS_MEMBERS: readonly string[] = Object.freeze([
	'pid',
	'code',
	'signal',
	'emitter',
	'lines',
	'evidence',
	'truncated',
	'settled',
	'stopping',
	'exit',
	'send',
	'stop',
	'destroy',
])
const SESSION_MEMBERS: readonly string[] = Object.freeze([
	'pid',
	'code',
	'signal',
	'emitter',
	'evidence',
	'settled',
	'stopping',
	'ending',
	'exit',
	'write',
	'end',
	'stop',
	'destroy',
])
const MANAGER_MEMBERS: readonly string[] = Object.freeze([
	'emitter',
	'count',
	'process',
	'processes',
	'launch',
	'stop',
	'destroy',
])

describe('createProcess', () => {
	it('returns a child carrying every member its interface declares', async () => {
		const child = createProcess({
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
			grace: 20,
		})

		try {
			expect(PROCESS_MEMBERS.filter((member) => !(member in child))).toEqual([])
			expect(await child.exit).toEqual({ code: 0, signal: null, drained: true })
		} finally {
			await child.destroy()
		}
	})

	it('threads the construction options through to the child it returns', async () => {
		const exits = createRecorder<readonly [ProcessExit]>()
		const child = createProcess({
			command: childCommand('exit', '3'),
			workspace: process.cwd(),
			grace: 20,
			on: { exit: exits.handler },
		})

		try {
			const exit = await child.exit
			const lines: string[] = []
			for await (const line of child.lines) lines.push(line)

			// The command reached the spawn, and the `on` hook reached the emitter the factory never
			// touches itself, so the options travelled through the constructor rather than being read
			// by the factory and dropped.
			expect(lines).toEqual(['ran:3'])
			expect(exit.code).toBe(3)
			expect(exits.calls.map((call) => call[0].code)).toEqual([3])
		} finally {
			await child.destroy()
		}
	})

	// The refusal is only worth its name if it happens before the spawn. A marker file dates a
	// spawn: the control child spawns the same fixture through the same factory, so by the time its
	// own marker exists, a child the refused call had spawned would have written one too.
	//
	// The case outlives the condition budget below it, so a condition that never holds reports its
	// own description rather than this case's timeout.
	it('refuses a backlog below one before it spawns anything', { timeout: 20_000 }, async () => {
		const scratch = createScratch()
		const refused = join(scratch.path, 'refused.txt')
		const control = join(scratch.path, 'control.txt')
		let thrown: unknown

		try {
			try {
				createProcess({
					command: childCommand('write', refused),
					workspace: process.cwd(),
					backlog: 0,
				})
			} catch (error) {
				thrown = error
			}
			const spawned = createProcess({
				command: childCommand('write', control),
				workspace: process.cwd(),
				grace: 20,
			})
			try {
				await waitForCondition(
					'the control child writes the marker that dates a real spawn',
					() => existsSync(control),
					{ budget: 10_000 },
				)
			} finally {
				await spawned.destroy()
			}

			expect(isProcessError(thrown)).toBe(true)
			expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
			expect(existsSync(refused)).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
})

describe('createSession', () => {
	it('returns a session carrying every member its interface declares', async () => {
		const session = createSession({
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
			grace: 20,
		})

		try {
			expect(SESSION_MEMBERS.filter((member) => !(member in session))).toEqual([])
			expect(await session.exit).toEqual({ code: 0, signal: null, drained: true })
		} finally {
			await session.destroy()
		}
	})

	it('threads the construction options through to the session it returns', async () => {
		const chunks = createRecorder<readonly [Uint8Array]>()
		const session = createSession({
			command: childCommand('exit', '0'),
			workspace: process.cwd(),
			grace: 20,
			on: { stdout: chunks.handler },
		})

		try {
			await session.exit
			const received = chunks.calls.map((call) => new TextDecoder().decode(call[0])).join('')

			expect(received).toBe('ran:0\n')
		} finally {
			await session.destroy()
		}
	})
})

describe('createProcessManager', () => {
	it('returns an empty registry carrying every member its interface declares', async () => {
		const manager = createProcessManager()

		expect(MANAGER_MEMBERS.filter((member) => !(member in manager))).toEqual([])
		expect(manager.count).toBe(0)
		expect(manager.processes()).toEqual([])
		expect(manager.process('absent')).toBeUndefined()
		await expect(manager.destroy()).resolves.toBeUndefined()
	})

	it('threads the construction options through to the registry it returns', async () => {
		const launches = createRecorder<readonly [string]>()
		const manager = createProcessManager({ on: { launch: launches.handler } })

		try {
			const child = manager.launch('probe', {
				command: childCommand('exit', '0'),
				workspace: process.cwd(),
				grace: 20,
			})

			expect(launches.calls.map((call) => call[0])).toEqual(['probe'])
			expect(manager.count).toBe(1)
			expect(manager.process('probe')).toBe(child)
			expect(await child.exit).toEqual({ code: 0, signal: null, drained: true })
		} finally {
			await manager.destroy()
		}
	})
})
