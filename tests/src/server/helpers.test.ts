import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRecorder, waitForDelay } from '@orkestrel/test'
import { waitForCondition } from '../../setup.js'
import { createScratch } from '@orkestrel/test/server'
import { isProcessError, ProcessError } from '@src/core'
import {
	buildExecutableCandidates,
	buildPlatformSpawn,
	buildRunResult,
	buildSpawn,
	detach,
	formatCommand,
	isExited,
	isFile,
	killProcess,
	killTree,
	mergeEnvironment,
	mergePlatformEnvironment,
	quoteArgument,
	readPlatformVariable,
	readVariable,
	resolveExecutable,
	retainChunk,
	run,
	runSync,
	stopChild,
	trimHead,
	trimTail,
	validateBytes,
	validateCommand,
	validateEnvironment,
	validateText,
	validateTimer,
	validateWorkspace,
	waitForExit,
} from '@src/server'
import { childCommand, resolveChildFixture } from '../../setupServer.js'

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

describe('formatCommand', () => {
	it('joins the executable and its arguments', () => {
		expect(formatCommand({ file: 'git', arguments: ['status', '--short'] })).toBe(
			'git status --short',
		)
	})
})

describe('readVariable', () => {
	it('reads a differently cased key the way the host resolves it', () => {
		// Windows resolves an environment key case-insensitively and every other host does not, so
		// the expected answer is read from the host the test runs on.
		const folded = process.platform === 'win32'

		expect(readVariable({ PROCESS_TEST_KEY: 'exact' }, 'PROCESS_TEST_KEY')).toBe('exact')
		expect(readVariable({ Process_Test_Key: 'folded' }, 'PROCESS_TEST_KEY')).toBe(
			folded ? 'folded' : undefined,
		)
		expect(readVariable({}, 'PROCESS_TEST_KEY')).toBeUndefined()
	})

	it('folds a Windows key and preserves a POSIX key distinction from the same input', () => {
		const environment = { Path: 'C:\\tools' }

		expect(readPlatformVariable(environment, 'PATH', 'win32')).toBe('C:\\tools')
		expect(readPlatformVariable(environment, 'PATH', 'linux')).toBeUndefined()
		expect(readPlatformVariable({ PATH: '/usr/bin' }, 'PATH', 'linux')).toBe('/usr/bin')
	})
})

describe('isFile', () => {
	it('accepts a regular file and refuses a directory or a missing path', () => {
		expect(isFile(process.execPath)).toBe(true)
		expect(isFile(process.cwd())).toBe(false)
		expect(isFile(join(process.cwd(), 'orkestrel-nonexistent-path'))).toBe(false)
	})
})

describe('quoteArgument', () => {
	it('quotes only a token a command line would otherwise split or interpret', () => {
		expect(quoteArgument('status')).toBe('status')
		expect(quoteArgument('a&b')).toBe('"a&b"')
		expect(quoteArgument('two words')).toBe('"two words"')
		expect(quoteArgument('')).toBe('""')
		expect(quoteArgument('say "hi"')).toBe('"say ""hi"""')
	})
})

describe('resolveExecutable', () => {
	it('builds the Windows search order and leaves the POSIX lookup to execvp', () => {
		const environment = { Path: 'C:\\bin;D:\\tools', PathExt: '.CMD;.EXE' }

		expect(buildExecutableCandidates('report.txt', 'C:\\workspace', environment, 'win32')).toEqual([
			'C:\\workspace\\report.txt',
			'C:\\workspace\\report.txt.CMD',
			'C:\\workspace\\report.txt.EXE',
			'C:\\bin\\report.txt',
			'C:\\bin\\report.txt.CMD',
			'C:\\bin\\report.txt.EXE',
			'D:\\tools\\report.txt',
			'D:\\tools\\report.txt.CMD',
			'D:\\tools\\report.txt.EXE',
		])
		expect(buildExecutableCandidates('report.txt', '/workspace', environment, 'linux')).toEqual([])
	})

	// A bare command name is resolved by the caller only on Windows, where the host appends a
	// PATHEXT extension and searches the working directory first. Every other host resolves the
	// file inside its own `execvp`, so there is nothing here to reproduce.
	it.skipIf(process.platform !== 'win32')(
		'resolves a bare name when the filesystem applies Windows case folding',
		() => {
			const scratch = createScratch()
			try {
				scratch.write('tool.cmd', '@echo off\r\necho tool-ran\r\n')

				// Windows folds a path's case, and the resolved extension is spelled the way
				// `PATHEXT` spells it rather than the way the directory entry does.
				expect(
					resolveExecutable('tool', {
						environment: { PATH: scratch.path },
					})?.toLowerCase(),
				).toBe(join(scratch.path, 'tool.cmd').toLowerCase())
				expect(
					resolveExecutable('tool', {
						environment: { PATH: scratch.path, PATHEXT: '.EXE' },
					}),
				).toBeUndefined()
				expect(resolveExecutable('tool', { environment: {} })).toBeUndefined()
			} finally {
				scratch.destroy()
			}
		},
	)

	// Windows is the only host that applies `PATHEXT` at all, so it is the only host that can show
	// which candidate a name carrying its own extension resolves to.
	it.skipIf(process.platform !== 'win32')(
		'tries an extension-bearing name when the filesystem applies Windows path rules',
		() => {
			const scratch = createScratch()
			try {
				scratch.write('report.txt', 'not an executable\r\n')
				scratch.write('report.txt.cmd', '@echo off\r\necho appended\r\n')
				scratch.write('notes.txt.cmd', '@echo off\r\necho appended\r\n')

				// The literal name is a regular file, so it wins over every appended candidate.
				expect(
					resolveExecutable('report.txt', {
						environment: { PATH: scratch.path },
					})?.toLowerCase(),
				).toBe(join(scratch.path, 'report.txt').toLowerCase())
				// With no literal file to find, `PATHEXT` still applies to a name that carries an
				// extension of its own.
				expect(
					resolveExecutable('notes.txt', {
						environment: { PATH: scratch.path },
					})?.toLowerCase(),
				).toBe(join(scratch.path, 'notes.txt.cmd').toLowerCase())
			} finally {
				scratch.destroy()
			}
		},
	)

	it.skipIf(process.platform !== 'win32')(
		'searches the workspace when the filesystem applies Windows path rules',
		() => {
			const scratch = createScratch()
			try {
				scratch.write('tool.cmd', '@echo off\r\necho workspace-ran\r\n')

				expect(
					resolveExecutable('tool', {
						workspace: scratch.path,
						environment: {},
					})?.toLowerCase(),
				).toBe(join(scratch.path, 'tool.cmd').toLowerCase())
			} finally {
				scratch.destroy()
			}
		},
	)

	it.skipIf(process.platform === 'win32')(
		'leaves the lookup to execvp when the host implements that API',
		() => {
			expect(resolveExecutable('node')).toBeUndefined()
		},
	)
})

describe('buildPlatformSpawn', () => {
	it('routes and quotes a Windows batch target while a POSIX host spawns it directly', () => {
		const command = { file: 'greet.cmd', arguments: ['a&b'] }

		expect(
			buildPlatformSpawn(command, 'C:\\tools\\greet.cmd', { ComSpec: 'C:\\cmd.exe' }, 'win32'),
		).toEqual({
			file: 'C:\\cmd.exe',
			arguments: ['/d', '/s', '/c', '""C:\\tools\\greet.cmd" "a&b""'],
			verbatim: true,
		})
		expect(buildPlatformSpawn(command, '/tools/greet.cmd', {}, 'linux')).toEqual({
			file: '/tools/greet.cmd',
			arguments: ['a&b'],
			verbatim: false,
		})
	})

	it('refuses a percent sign only for a Windows batch target', () => {
		const command = { file: 'greet.cmd', arguments: ['%PATH%'] }

		expect(() => buildPlatformSpawn(command, 'C:\\tools\\greet.cmd', {}, 'win32')).toThrow(
			ProcessError,
		)
		expect(buildPlatformSpawn(command, '/tools/greet.cmd', {}, 'linux')).toEqual({
			file: '/tools/greet.cmd',
			arguments: ['%PATH%'],
			verbatim: false,
		})
	})
})

describe('buildSpawn', () => {
	it('spawns a resolvable executable directly and never verbatim', () => {
		const plan = buildSpawn({ file: process.execPath, arguments: ['--version'] })

		expect(plan.file).toBe(process.execPath)
		expect(plan.arguments).toEqual(['--version'])
		expect(plan.verbatim).toBe(false)
	})

	it('passes a percent-delimited argument literally to a target that is not batch', () => {
		const plan = buildSpawn({ file: process.execPath, arguments: ['%s', '%PATH%'] })
		const result = runSync(
			{ file: process.execPath, arguments: [resolveChildFixture(), 'args', '%s', '%PATH%'] },
			{ workspace: process.cwd(), strict: false },
		)

		expect(plan.arguments).toEqual(['%s', '%PATH%'])
		expect(plan.verbatim).toBe(false)
		expect(result.failed).toBe(false)
		expect(result.stdout).toContain('args:%s|%PATH%')
	})

	// Only Windows resolves and runs a batch target, so only Windows can drive the expansion this
	// refusal exists to prevent.
	it.skipIf(process.platform !== 'win32')(
		'refuses a defined percent-delimited argument when cmd.exe expands environment variables',
		() => {
			const scratch = createScratch()
			try {
				scratch.write('greet.cmd', '@echo off\r\necho got:%1\r\n')
				const file = join(scratch.path, 'greet.cmd')

				let thrown: unknown
				try {
					runSync({ file, arguments: ['%PATH%'] }, { workspace: process.cwd(), strict: false })
				} catch (error) {
					thrown = error
				}

				expect(isProcessError(thrown)).toBe(true)
				expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
				expect(isProcessError(thrown) ? thrown.context?.value : undefined).toBe('%PATH%')
			} finally {
				scratch.destroy()
			}
		},
	)

	it.skipIf(process.platform !== 'win32')(
		'runs a batch script whose spaced path cmd.exe must parse',
		() => {
			const scratch = createScratch()
			try {
				scratch.write('with space/greet.cmd', '@echo off\r\necho cmd-ran %1\r\n')
				const file = join(scratch.path, 'with space', 'greet.cmd')

				const result = runSync({ file, arguments: ['hello'] }, { strict: false })

				expect(result.failed).toBe(false)
				expect(result.stdout).toContain('cmd-ran hello')
			} finally {
				scratch.destroy()
			}
		},
	)
})

describe('validateText', () => {
	it('accepts a spawn-safe string and refuses a NUL or a missing required value', () => {
		expect(validateText('status', 'command argument', false)).toBeUndefined()
		expect(validateText('', 'command argument', false)).toBeUndefined()
		expect(() => validateText('', 'command file', true)).toThrow(ProcessError)
		expect(() => validateText(`a${String.fromCodePoint(0)}b`, 'command file', true)).toThrow(
			ProcessError,
		)
		expect(() => validateText(7, 'command file', true)).toThrow(ProcessError)
	})
})

describe('validateTimer', () => {
	it('accepts a schedulable delay and refuses one the host would truncate', () => {
		expect(validateTimer(undefined, "option 'grace'")).toBeUndefined()
		expect(validateTimer(0, "option 'grace'")).toBeUndefined()
		expect(validateTimer(2_147_483_647, "option 'grace'")).toBeUndefined()
		expect(() => validateTimer(2_147_483_648, "option 'grace'")).toThrow(ProcessError)
		expect(() => validateTimer(-1, "option 'grace'")).toThrow(ProcessError)
		expect(() => validateTimer(1.5, "option 'grace'")).toThrow(ProcessError)
		expect(() => validateTimer(Number.NaN, "option 'grace'")).toThrow(ProcessError)
	})

	it('refuses negative zero, which reads as a delay and is not a non-negative integer', () => {
		expect(() => validateTimer(-0, "option 'grace'")).toThrow(ProcessError)
	})
})

describe('validateBytes', () => {
	it('accepts a byte bound at or above its minimum and refuses anything else', () => {
		expect(validateBytes(undefined, "option 'limit'", 0)).toBeUndefined()
		expect(validateBytes(0, "option 'limit'", 0)).toBeUndefined()
		expect(() => validateBytes(0, "option 'backlog'", 1)).toThrow(ProcessError)
		expect(() => validateBytes(-1, "option 'limit'", 0)).toThrow(ProcessError)
		expect(() => validateBytes(1.5, "option 'limit'", 0)).toThrow(ProcessError)
		expect(() => validateBytes(Number.POSITIVE_INFINITY, "option 'limit'", 0)).toThrow(ProcessError)
	})
})

describe('validateEnvironment', () => {
	it('accepts an override map and refuses an empty name or a NUL in either half', () => {
		const nul = String.fromCodePoint(0)

		expect(validateEnvironment(undefined)).toBeUndefined()
		expect(
			validateEnvironment({ PROCESS_TEST_KEY: 'value', PROCESS_UNSET_KEY: undefined }),
		).toBeUndefined()
		expect(() => validateEnvironment({ '': 'value' })).toThrow(ProcessError)
		expect(() => validateEnvironment({ [`a${nul}b`]: 'value' })).toThrow(ProcessError)
		expect(() => validateEnvironment({ PROCESS_TEST_KEY: `a${nul}b` })).toThrow(ProcessError)
	})
})

describe('validateCommand', () => {
	it('refuses an empty file, a NUL anywhere, and an empty environment key', () => {
		const nul = String.fromCodePoint(0)

		expect(validateCommand({ file: 'git', arguments: ['status'] })).toBeUndefined()
		expect(() => validateCommand({ file: '', arguments: [] })).toThrow(ProcessError)
		expect(() => validateCommand({ file: `git${nul}`, arguments: [] })).toThrow(ProcessError)
		expect(() => validateCommand({ file: 'git', arguments: [`a${nul}b`] })).toThrow(ProcessError)
		expect(() =>
			validateCommand({ file: 'git', arguments: [], environment: { '': 'value' } }),
		).toThrow(ProcessError)
		expect(() =>
			validateCommand({ file: 'git', arguments: [], environment: { KEY: `a${nul}b` } }),
		).toThrow(ProcessError)
	})

	it('codes a refused command as invalid and carries the rejected value', () => {
		let thrown: unknown
		try {
			validateWorkspace('')
		} catch (error) {
			thrown = error
		}

		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
		expect(isProcessError(thrown) ? thrown.context?.value : undefined).toBe('')
	})
})

describe('retainChunk', () => {
	it('retains the head up to the limit while counting everything delivered', () => {
		const chunks: Buffer[] = []
		const counts: number[] = [0, 0]

		retainChunk(Buffer.from('hello'), chunks, counts, 3)
		retainChunk(Buffer.from('world'), chunks, counts, 3)
		retainChunk('not a chunk', chunks, counts, 3)

		expect(Buffer.concat(chunks).toString('utf8')).toBe('hel')
		expect(counts).toEqual([10, 3])
	})
})

describe('isExited', () => {
	it('reports the terminal state from the code or the signal the host recorded', () => {
		expect(isExited({ exitCode: null, signalCode: null })).toBe(false)
		expect(isExited({ exitCode: 0, signalCode: null })).toBe(true)
		expect(isExited({ exitCode: null, signalCode: 'SIGKILL' })).toBe(true)
	})
})

describe('waitForExit', () => {
	it('returns at once for an exited child and at the deadline for a live one', async () => {
		await waitForExit({ exitCode: 0, signalCode: null, once: () => undefined }, 60_000)

		const started = performance.now()
		await waitForExit({ exitCode: null, signalCode: null, once: () => undefined }, 50)

		expect(performance.now() - started).toBeGreaterThanOrEqual(40)
	})

	it('removes every exit listener after repeated deadlines', async () => {
		const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null })

		for (let call = 0; call < 12; call += 1) await waitForExit(child, 1)

		expect(child.listenerCount('exit')).toBe(0)
	})
})

describe('stopChild', () => {
	it('signals nothing once the host has recorded the native exit', async () => {
		const signals = createRecorder<readonly [NodeJS.Signals]>()

		const confirmed = await stopChild(
			{
				pid: 4_194_303,
				exitCode: 0,
				signalCode: null,
				kill: (signal) => (signals.handler(signal), true),
				once: () => undefined,
			},
			20,
			100,
		)

		expect(confirmed).toBe(true)
		expect(signals.count).toBe(0)
	})

	it('signals a live child and reports an unconfirmed termination', async () => {
		const signals = createRecorder<readonly [NodeJS.Signals]>()

		const confirmed = await stopChild(
			{
				pid: undefined,
				exitCode: null,
				signalCode: null,
				kill: (signal) => (signals.handler(signal), true),
				once: () => undefined,
			},
			20,
			100,
		)

		expect(confirmed).toBe(false)
		expect(signals.count).toBeGreaterThan(0)
	})
})

describe('killTree', () => {
	// `taskkill` is the Windows utility that ends a process tree by root id; a POSIX host reaches a
	// tree through its process group instead, so there is no peer to drive here.
	it.skipIf(process.platform !== 'win32')(
		'reports failure for an unowned tree when taskkill.exe is available',
		async () => {
			expect(await killTree(4_194_303, 5_000)).toBe(false)
		},
	)
})

describe('mergeEnvironment', () => {
	it('layers overrides over the parent environment and unsets an undefined value', () => {
		const merged = mergeEnvironment(
			false,
			{ PROCESS_TEST_KEY: 'base' },
			{ PROCESS_TEST_KEY: undefined },
		)
		expect(merged.PROCESS_TEST_KEY).toBeUndefined()
		expect(merged.PATH).toBe(process.env.PATH)
	})

	it('folds Windows keys and preserves POSIX keys from the same explicit parent', () => {
		const parent = { PROCESS_PARENT_KEY: 'parent' }
		const base = { PROCESS_TEST_KEY: 'first' }
		const override = { process_test_key: 'second' }
		const windows = mergePlatformEnvironment('win32', parent, false, base, override)
		const posix = mergePlatformEnvironment('linux', parent, false, base, override)

		expect(windows).toEqual({ PROCESS_PARENT_KEY: 'parent', process_test_key: 'second' })
		expect(posix).toEqual({
			PROCESS_PARENT_KEY: 'parent',
			PROCESS_TEST_KEY: 'first',
			process_test_key: 'second',
		})
	})

	it('folds a differently cased key the way the host resolves it', () => {
		// Windows resolves an environment key case-insensitively and every other host does not, so the
		// expected key count is read from the host the test runs on.
		const folded = process.platform === 'win32'
		const merged = mergeEnvironment(
			false,
			{ PROCESS_TEST_KEY: 'first' },
			{ process_test_key: 'second' },
		)
		const keys = Object.keys(merged).filter((key) => key.toUpperCase() === 'PROCESS_TEST_KEY')

		expect(keys).toHaveLength(folded ? 1 : 2)
		expect(merged.process_test_key).toBe('second')
	})

	it('excludes the parent environment for an isolated command', () => {
		const merged = mergeEnvironment(true, {
			PROCESS_TEST_KEY: 'only',
		})

		expect(merged.PROCESS_TEST_KEY).toBe('only')
		expect(Object.keys(merged)).toEqual(['PROCESS_TEST_KEY'])
	})
})

describe('buildRunResult', () => {
	it('derives failure from the exit, a signal, an expiry, an abort, or a host fault', () => {
		const empty = Buffer.alloc(0)
		const ok = buildRunResult({
			command: 'c',
			stdout: Buffer.from('out'),
			stderr: Buffer.from('err'),
			code: 0,
			signal: null,
			expired: false,
			aborted: false,
			truncated: false,
			limit: 1_024,
		})

		expect(ok).toEqual({
			command: 'c',
			stdout: 'out',
			stderr: 'err',
			code: 0,
			signal: null,
			failed: false,
			expired: false,
			aborted: false,
			truncated: false,
		})
		expect(
			buildRunResult({
				command: 'c',
				stdout: empty,
				stderr: empty,
				code: 1,
				signal: null,
				expired: false,
				aborted: false,
				truncated: false,
				limit: 1_024,
			}).failed,
		).toBe(true)
		expect(
			buildRunResult({
				command: 'c',
				stdout: empty,
				stderr: empty,
				code: null,
				signal: 'SIGTERM',
				expired: false,
				aborted: false,
				truncated: false,
				limit: 1_024,
			}).failed,
		).toBe(true)
		expect(
			buildRunResult({
				command: 'c',
				stdout: empty,
				stderr: empty,
				code: 0,
				signal: null,
				expired: true,
				aborted: false,
				truncated: false,
				limit: 1_024,
			}).failed,
		).toBe(true)
		expect(
			buildRunResult({
				command: 'c',
				stdout: empty,
				stderr: empty,
				code: 0,
				signal: null,
				expired: false,
				aborted: true,
				truncated: false,
				limit: 1_024,
			}).failed,
		).toBe(true)
		expect(
			buildRunResult({
				command: 'c',
				stdout: empty,
				stderr: empty,
				code: 0,
				signal: null,
				expired: false,
				aborted: false,
				truncated: false,
				limit: 1_024,
				cause: new Error('spawn'),
			}).failed,
		).toBe(true)
	})

	it('keeps truncation out of the failure derivation', () => {
		const result = buildRunResult({
			command: 'c',
			stdout: Buffer.from('output'),
			stderr: Buffer.alloc(0),
			code: 0,
			signal: null,
			expired: false,
			aborted: false,
			truncated: true,
			limit: 3,
		})

		expect(result.failed).toBe(false)
		expect(result.truncated).toBe(true)
		expect(result.stdout).toBe('out')
	})
})

describe('killProcess', () => {
	it('signals a pid-less child boundary directly', () => {
		const signals = createRecorder<readonly [NodeJS.Signals]>()
		killProcess({ pid: undefined, kill: (signal) => (signals.handler(signal), true) }, 'SIGTERM')
		expect(signals.calls).toEqual([['SIGTERM']])
	})

	it.skipIf(process.platform === 'win32')(
		'falls back to the direct child when process.kill reports ESRCH for a negative group id',
		() => {
			const signals = createRecorder<readonly [NodeJS.Signals]>()

			killProcess({ pid: 4_194_303, kill: (signal) => (signals.handler(signal), true) }, 'SIGTERM')

			expect(signals.calls).toEqual([['SIGTERM']])
		},
	)
})

describe('run', () => {
	it('spawns the same command file that it validated', async () => {
		let reads = 0
		const result = await run(
			{
				get file() {
					reads += 1
					return reads === 1 ? process.execPath : `${process.execPath}\0changed`
				},
				arguments: [resolveChildFixture(), 'exit', '0'],
			},
			{ workspace: process.cwd() },
		)

		expect(reads).toBe(1)
		expect(result.code).toBe(0)
	})

	it('buffers a successful run and reports it did not fail', async () => {
		const result = await run(childCommand('exit', '0'), { workspace: process.cwd() })
		expect(result.failed).toBe(false)
		expect(result.code).toBe(0)
		expect(result.stdout).toContain('ran:0')
		expect(result.stderr).toContain('diagnostic:0')
		expect(result.truncated).toBe(false)
		expect(result.aborted).toBe(false)
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

	it('resolves a failed run with the outcome when strict is false', async () => {
		const result = await run(childCommand('exit', '4'), { workspace: process.cwd(), strict: false })
		expect(result.failed).toBe(true)
		expect(result.code).toBe(4)
		expect(result.expired).toBe(false)
	})

	it('reports a run that outlasted its timeout as expired rather than aborted', async () => {
		const result = await run(childCommand('hang'), {
			workspace: process.cwd(),
			timeout: 100,
			grace: 20,
			strict: false,
		})
		expect(result.expired).toBe(true)
		expect(result.aborted).toBe(false)
		expect(result.failed).toBe(true)
	})

	it('reports an externally aborted run as aborted rather than expired', async () => {
		const controller = new AbortController()
		const pending = run(childCommand('sleep'), {
			workspace: process.cwd(),
			grace: 20,
			signal: controller.signal,
			strict: false,
		})
		controller.abort()
		const result = await pending

		expect(result.aborted).toBe(true)
		expect(result.expired).toBe(false)
		expect(result.failed).toBe(true)
	})

	it('caps a huge capture at the limit and reports truncation without failing', async () => {
		const result = await run(childCommand('chatty'), {
			workspace: process.cwd(),
			limit: 1_024,
			strict: false,
		})

		expect(result.truncated).toBe(true)
		expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1_024)
		expect(result.stdout.startsWith('0:')).toBe(true)
		expect(result.failed).toBe(false)
		expect(result.code).toBe(0)
	})

	it('threads the spawn cause onto the rejected process error', async () => {
		let thrown: unknown
		try {
			await run(
				{ file: 'orkestrel-nonexistent-binary.exe', arguments: [] },
				{ workspace: process.cwd() },
			)
		} catch (error) {
			thrown = error
		}
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.cause : undefined).toBeInstanceOf(Error)
	})

	it('refuses a NUL in a per-run environment override before spawning', async () => {
		const nul = String.fromCodePoint(0)
		let thrown: unknown
		try {
			await run(childCommand('exit', '0'), {
				workspace: process.cwd(),
				environment: { PROCESS_TEST_KEY: `a${nul}b` },
			})
		} catch (error) {
			thrown = error
		}

		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
	})
})

describe('runSync', () => {
	it(
		'leaves an established grandchild running after a root-only timeout where run ends the tree',
		{ timeout: 20_000 },
		async () => {
			const scratch = createScratch()
			try {
				const blockingMarker = join(scratch.path, 'blocking.txt')
				const streamedMarker = join(scratch.path, 'streamed.txt')

				// The root must outlive the grandchild's interpreter startup, or this measures bootstrap
				// rather than termination. Node bootstraps in 45.7-49.9 ms on this host, so the former
				// 50 ms root timeout was a coin flip and lost three times in six.
				const blocking = runSync(childCommand('tree-write', blockingMarker), {
					workspace: process.cwd(),
					timeout: 400,
					strict: false,
				})
				expect(blocking.expired).toBe(true)

				// The claim is about an ESTABLISHED descendant. The root's 50 ms deadline is shorter than
				// Node's own bootstrap on some hosts, so waiting a fixed interval measures whether the
				// grandchild finished starting rather than whether termination reached it. Waiting for the
				// fixture's readiness line removes that race: measured without it, three of six trials
				// never wrote at all.
				await waitForCondition(() => existsSync(`${blockingMarker}.ready`), 6_000)
				await waitForCondition(() => existsSync(blockingMarker), 6_000)
				expect(existsSync(blockingMarker)).toBe(true)

				const streamed = await run(childCommand('tree-write', streamedMarker), {
					workspace: process.cwd(),
					timeout: 50,
					grace: 20,
					strict: false,
				})
				expect(streamed.expired).toBe(true)

				// Tree termination reaches the grandchild, so its marker never appears. A fixed wait is the
				// right instrument for a negative: it bounds how long absence must hold, sized above the
				// ~295 ms a surviving grandchild takes to write.
				await waitForDelay(600)
				expect(existsSync(streamedMarker)).toBe(false)
			} finally {
				scratch.destroy()
			}
		},
	)

	it('sends string input as bytes, so a NUL in the payload reaches the child', () => {
		// input is stdin payload rather than a spawn-bound string, so it carries no NUL restriction.
		// Passing the string through unconverted made spawnSync reject it with Unknown encoding: buffer.
		const payload = 'before\u0000after\nstop\n'
		const result = runSync(childCommand('echo'), {
			workspace: process.cwd(),
			input: payload,
			strict: false,
		})
		expect(result.failed).toBe(false)
		// The child echoes the line it read, so a NUL surviving the transfer proves the payload was
		// sent as bytes rather than rejected or re-encoded.
		expect(result.stdout).toContain('before\u0000after')
	})

	it('spawns the same command file that it validated', () => {
		let reads = 0
		const result = runSync(
			{
				get file() {
					reads += 1
					return reads === 1 ? process.execPath : `${process.execPath}\0changed`
				},
				arguments: [resolveChildFixture(), 'exit', '0'],
			},
			{ workspace: process.cwd() },
		)

		expect(reads).toBe(1)
		expect(result.code).toBe(0)
	})

	it('codes an invalid changing command as invalid before spawn', () => {
		let reads = 0
		let thrown: unknown
		try {
			runSync({
				get file() {
					reads += 1
					return reads === 1 ? `${process.execPath}\0invalid` : process.execPath
				},
				arguments: [resolveChildFixture(), 'exit', '0'],
			})
		} catch (error) {
			thrown = error
		}

		expect(reads).toBe(1)
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
	})

	it('buffers a successful synchronous run', () => {
		const result = runSync(childCommand('exit', '0'), { workspace: process.cwd() })
		expect(result.failed).toBe(false)
		expect(result.stdout).toContain('ran:0')
	})

	it('resolves a failed synchronous run with the outcome when strict is false', () => {
		const result = runSync(childCommand('exit', '5'), { workspace: process.cwd(), strict: false })
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

	it('fails a synchronous run whose output overflowed the limit', () => {
		const result = runSync(childCommand('chatty'), {
			workspace: process.cwd(),
			limit: 1_024,
			strict: false,
		})

		expect(result.truncated).toBe(true)
		expect(result.failed).toBe(true)
		expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1_024)
	})

	it('passes a shell metacharacter through as one argument', () => {
		const result = runSync(
			{ file: 'node', arguments: [resolveChildFixture(), 'args', 'a&b'] },
			{ workspace: process.cwd(), strict: false },
		)

		expect(result.failed).toBe(false)
		expect(result.stdout).toContain('args:a&b')
	})

	it('threads the spawn cause onto the rejected process error', () => {
		let thrown: unknown
		try {
			runSync(
				{ file: 'orkestrel-nonexistent-binary.exe', arguments: [] },
				{ workspace: process.cwd() },
			)
		} catch (error) {
			thrown = error
		}
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.cause : undefined).toBeInstanceOf(Error)
	})

	it('refuses a NUL in a per-run environment override before spawning', () => {
		const nul = String.fromCodePoint(0)
		let thrown: unknown
		try {
			runSync(childCommand('exit', '0'), {
				workspace: process.cwd(),
				environment: { PROCESS_TEST_KEY: `a${nul}b` },
			})
		} catch (error) {
			thrown = error
		}

		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
	})
})

describe('detach', () => {
	it('spawns the same command file that it validated', async () => {
		const scratch = createScratch()
		let reads = 0
		try {
			const marker = join(scratch.path, 'snapshot.txt')
			detach(
				{
					get file() {
						reads += 1
						return reads === 1 ? process.execPath : `${process.execPath}\0changed`
					},
					arguments: [resolveChildFixture(), 'write', marker],
				},
				{ workspace: process.cwd() },
			)
			for (let attempt = 0; attempt < 60 && !existsSync(marker); attempt += 1) {
				await waitForDelay(50)
			}

			expect(reads).toBe(1)
			expect(readFileSync(marker, 'utf8')).toBe('detached')
		} finally {
			scratch.destroy()
		}
	})

	it('spawns a fire-and-forget child that runs after the call returns', async () => {
		const scratch = createScratch()
		try {
			const marker = join(scratch.path, 'detached.txt')

			detach(childCommand('write', marker), { workspace: process.cwd() })
			for (let attempt = 0; attempt < 60 && !existsSync(marker); attempt += 1) {
				await waitForDelay(50)
			}

			expect(readFileSync(marker, 'utf8')).toBe('detached')
		} finally {
			scratch.destroy()
		}
	})

	it('refuses an invalid command before anything is spawned', () => {
		let thrown: unknown
		try {
			detach({ file: '', arguments: [] })
		} catch (error) {
			thrown = error
		}

		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
	})
})
