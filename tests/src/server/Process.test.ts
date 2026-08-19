import type { ProcessExit } from '@src/core'
import { describe, expect, it } from 'vitest'
import { collect, createRecorder } from '@orkestrel/test'
import { createProcess } from '@src/server'
import { childCommand } from '../../setupServer.js'

describe('Process', () => {
	it('eagerly drains output with no line consumer and still resolves exit', async () => {
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

		const accepted = child.send('ping')
		const first = await iterator.next()
		child.send('stop')
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

		const refused = child.send('ping')
		await child.stop()

		expect(refused).toBe(false)
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
})
