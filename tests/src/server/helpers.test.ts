import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { createRecorder } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { isProcessError } from '@src/core'
import {
	buildRunResult,
	commandLine,
	killProcess,
	mergeEnvironment,
	requiresShell,
	run,
	runSync,
	trimHead,
	trimTail,
} from '@src/server'
import { childCommand } from '../../setupServer.js'

describe('trimTail', () => {
	it('returns the whole buffer when it fits the limit', () => {
		expect(trimTail(Buffer.from('hello'), 8).toString('utf8')).toBe('hello')
	})

	it('keeps the trailing bytes without splitting a code point', () => {
		const buffer = Buffer.from(`ab${'\u{1f642}'}`)
		const trimmed = trimTail(buffer, 5)
		expect(trimmed.byteLength).toBe(5)
		expect(trimmed.toString('utf8')).toBe(`b${'\u{1f642}'}`)
	})
})

describe('trimHead', () => {
	it('returns the whole buffer when it fits the limit', () => {
		expect(trimHead(Buffer.from('hello'), 8).toString('utf8')).toBe('hello')
	})

	it('keeps the leading bytes without splitting a code point', () => {
		const buffer = Buffer.from(`${'\u{1f642}'}ab`)
		const trimmed = trimHead(buffer, 5)
		expect(trimmed.byteLength).toBe(5)
		expect(trimmed.toString('utf8')).toBe(`${'\u{1f642}'}a`)
	})
})

describe('requiresShell', () => {
	it('routes batch and bare commands through a shell only on Windows', () => {
		// A batch shim and a bare PATHEXT name are Windows-only shell-dispatch cases; a real
		// executable extension and every POSIX command spawn directly.
		const windows = process.platform === 'win32'
		expect(requiresShell('deploy.cmd')).toBe(windows)
		expect(requiresShell('deploy.bat')).toBe(windows)
		expect(requiresShell('git')).toBe(windows)
		expect(requiresShell(process.execPath)).toBe(false)
	})
})

describe('commandLine', () => {
	it('joins the executable and its arguments', () => {
		expect(commandLine({ file: 'git', arguments: ['status', '--short'] })).toBe(
			'git status --short',
		)
	})
})

describe('mergeEnvironment', () => {
	it('layers overrides over the parent environment and unsets an undefined value', () => {
		const merged = mergeEnvironment({ PROCESS_TEST_KEY: 'base' }, { PROCESS_TEST_KEY: undefined })
		expect(merged.PROCESS_TEST_KEY).toBeUndefined()
		expect(merged.PATH).toBe(process.env.PATH)
	})
})

describe('buildRunResult', () => {
	it('derives failure from the exit, a signal, or a timeout', () => {
		const ok = buildRunResult('c', Buffer.from('out'), Buffer.from('err'), 0, null, false, 1_024)
		expect(ok).toEqual({
			command: 'c',
			stdout: 'out',
			stderr: 'err',
			code: 0,
			signal: null,
			failed: false,
			timedOut: false,
		})
		const empty = Buffer.alloc(0)
		expect(buildRunResult('c', empty, empty, 1, null, false, 1_024).failed).toBe(true)
		expect(buildRunResult('c', empty, empty, null, 'SIGTERM', false, 1_024).failed).toBe(true)
		expect(buildRunResult('c', empty, empty, 0, null, true, 1_024).failed).toBe(true)
	})
})

describe('killProcess', () => {
	it('signals a pid-less child boundary directly', () => {
		const signals = createRecorder<readonly [NodeJS.Signals]>()
		killProcess({ pid: undefined, kill: (signal) => (signals.handler(signal), true) }, 'SIGTERM')
		expect(signals.calls).toEqual([['SIGTERM']])
	})
})

describe('run', () => {
	it('buffers a successful run and reports it did not fail', async () => {
		const result = await run(childCommand('exit', '0'), { workspace: process.cwd() })
		expect(result.failed).toBe(false)
		expect(result.code).toBe(0)
		expect(result.stdout).toContain('ran:0')
		expect(result.stderr).toContain('diagnostic:0')
	})

	it('rejects a failed run with a process error carrying the result', async () => {
		let thrown: unknown
		try {
			await run(childCommand('exit', '3'), { workspace: process.cwd() })
		} catch (error) {
			thrown = error
		}
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.result?.code : undefined).toBe(3)
	})

	it('resolves a failed run with the outcome when reject is false', async () => {
		const result = await run(childCommand('exit', '4'), { workspace: process.cwd(), reject: false })
		expect(result.failed).toBe(true)
		expect(result.code).toBe(4)
		expect(result.timedOut).toBe(false)
	})

	it('terminates a run that outlasts its timeout and flags it timed out', async () => {
		const result = await run(childCommand('hang'), {
			workspace: process.cwd(),
			timeout: 100,
			grace: 20,
			reject: false,
		})
		expect(result.timedOut).toBe(true)
		expect(result.failed).toBe(true)
	})

	it('terminates a run when its signal aborts', async () => {
		const controller = new AbortController()
		const pending = run(childCommand('hang'), {
			workspace: process.cwd(),
			grace: 20,
			signal: controller.signal,
			reject: false,
		})
		controller.abort()
		const result = await pending
		expect(result.failed).toBe(true)
		expect(result.timedOut).toBe(false)
	})
})

describe('runSync', () => {
	it('buffers a successful synchronous run', () => {
		const result = runSync(childCommand('exit', '0'), { workspace: process.cwd() })
		expect(result.failed).toBe(false)
		expect(result.stdout).toContain('ran:0')
	})

	it('resolves a failed synchronous run with the outcome when reject is false', () => {
		const result = runSync(childCommand('exit', '5'), { workspace: process.cwd(), reject: false })
		expect(result.failed).toBe(true)
		expect(result.code).toBe(5)
	})

	it('throws a process error for a failed synchronous run by default', () => {
		let thrown: unknown
		try {
			runSync(childCommand('exit', '6'), { workspace: process.cwd() })
		} catch (error) {
			thrown = error
		}
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.result?.code : undefined).toBe(6)
	})

	// A `.cmd` batch file is a Windows-only construct: requiresShell returns false off win32, so the
	// shell-dispatch path this drives cannot exist on a POSIX host. The platform-conditional result
	// of requiresShell itself is proven unconditionally in the requiresShell suite above.
	it.skipIf(process.platform !== 'win32')(
		'runs a Windows batch command through the shell path',
		() => {
			const scratch = createScratch()
			try {
				scratch.write('greet.cmd', '@echo off\r\necho cmd-ran\r\n')
				const file = join(scratch.path, 'greet.cmd')
				expect(requiresShell(file)).toBe(true)
				const result = runSync({ file, arguments: [] })
				expect(result.failed).toBe(false)
				expect(result.stdout).toContain('cmd-ran')
			} finally {
				scratch.destroy()
			}
		},
	)
})
