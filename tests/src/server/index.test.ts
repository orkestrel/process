import * as entry from '@src/server'
import { describe, expect, it } from 'vitest'

describe('src server entry', () => {
	it('exposes the supervised-process toolkit through the server barrel', () => {
		expect(Object.keys(entry).sort()).toEqual([
			'Process',
			'ProcessManager',
			'buildRunResult',
			'commandLine',
			'createProcess',
			'createProcessManager',
			'killProcess',
			'mergeEnvironment',
			'requiresShell',
			'run',
			'runSync',
			'trimHead',
			'trimTail',
		])
	})

	it('exports the primitives, runners, and factories as callables', () => {
		expect(typeof entry.Process).toBe('function')
		expect(typeof entry.ProcessManager).toBe('function')
		expect(typeof entry.createProcess).toBe('function')
		expect(typeof entry.createProcessManager).toBe('function')
		expect(typeof entry.run).toBe('function')
		expect(typeof entry.runSync).toBe('function')
	})
})
