import * as entry from '@src/server'
import { describe, expect, it } from 'vitest'

describe('src server entry', () => {
	it('exposes the supervised-process toolkit through the server barrel', () => {
		expect(Object.keys(entry).sort()).toEqual([
			'Process',
			'ProcessManager',
			'buildExecutableCandidates',
			'buildExecuteResult',
			'buildPlatformSpawn',
			'buildSpawn',
			'createProcess',
			'createProcessManager',
			'detach',
			'execute',
			'executeSync',
			'formatCommand',
			'isExited',
			'isFile',
			'killProcess',
			'killTree',
			'mergeEnvironment',
			'mergePlatformEnvironment',
			'quoteArgument',
			'readPlatformVariable',
			'readVariable',
			'resolveExecutable',
			'retainChunk',
			'snapshotCommand',
			'stopChild',
			'trimHead',
			'trimTail',
			'validateBytes',
			'validateCommand',
			'validateEnvironment',
			'validateText',
			'validateTimer',
			'validateWorkspace',
			'waitForExit',
		])
	})

	it('exports the primitives, runners, and factories as callables', () => {
		expect(typeof entry.Process).toBe('function')
		expect(typeof entry.ProcessManager).toBe('function')
		expect(typeof entry.createProcess).toBe('function')
		expect(typeof entry.createProcessManager).toBe('function')
		expect(typeof entry.execute).toBe('function')
		expect(typeof entry.executeSync).toBe('function')
		expect(typeof entry.detach).toBe('function')
	})
})
