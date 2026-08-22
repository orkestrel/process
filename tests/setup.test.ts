import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { childCommand, resolveChildFixture } from './setupServer.js'

// The helper anchors the fixture to the working directory, so this file anchors it to its own
// module URL instead. The two mechanisms disagree whenever the suite runs from anywhere but the
// workspace root, which is the failure the helper's callers would otherwise meet as a spawn fault.
const fixture = fileURLToPath(new URL('./src/server/fixtures/child.mjs', import.meta.url))

describe('resolveChildFixture', () => {
	it('resolves the fixture the suite spawns, independently of the working directory', () => {
		expect(resolveChildFixture()).toBe(fixture)
	})

	it('resolves a path that exists on disk', () => {
		expect(existsSync(resolveChildFixture())).toBe(true)
	})
})

describe('childCommand', () => {
	it('spawns the running runtime rather than a name the host resolver has to find', () => {
		const command = childCommand('exit')
		expect(command.file).toBe(process.execPath)
		expect(existsSync(command.file)).toBe(true)
	})

	it('leads the argument vector with the fixture and follows it with the mode', () => {
		expect(childCommand('tree-write').arguments).toEqual([fixture, 'tree-write'])
	})

	it('appends the detail only when the caller supplies one', () => {
		expect(childCommand('exit', '3').arguments).toEqual([fixture, 'exit', '3'])
	})

	it('returns an argument vector per call, so one command never reaches another', () => {
		const first = childCommand('exit', '3')
		const second = childCommand('tree-write')
		expect(first.arguments).not.toBe(second.arguments)
		expect(first.arguments).not.toEqual(second.arguments)
	})
})
