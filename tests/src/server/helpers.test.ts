import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ProcessChild } from '@src/server'
import { describe, expect, it } from 'vitest'
import { holds } from '@orkestrel/contract'
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
	snapshotCommand,
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

describe('snapshotCommand', () => {
	it('reads each property once and keeps a later mutation out of the snapshot', () => {
		const files: string[] = []
		const argumentsList = ['status']
		const environment: Record<string, string> = { TOKEN: 'a' }
		const snapshot = snapshotCommand({
			get file() {
				files.push('read')
				return files.length === 1 ? 'git' : 'curl'
			},
			arguments: argumentsList,
			environment,
			isolated: true,
		})
		argumentsList.push('--short')
		environment.TOKEN = 'b'

		expect(files.length).toBe(1)
		expect(snapshot.file).toBe('git')
		expect(snapshot.arguments).toEqual(['status'])
		expect(snapshot.environment).toEqual({ TOKEN: 'a' })
		expect(Object.isFrozen(snapshot)).toBe(true)
		expect(Object.isFrozen(snapshot.arguments)).toBe(true)
		expect(Object.isFrozen(snapshot.environment)).toBe(true)
	})

	it('omits an absent optional rather than carrying it as undefined', () => {
		const snapshot = snapshotCommand({ file: 'git', arguments: ['status'] })

		expect(Object.keys(snapshot)).toEqual(['file', 'arguments'])
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
		'resolves a bare name through the effective PATH and PATHEXT',
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
		'tries an extension-bearing name literally before it applies PATHEXT to it',
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

	// Windows is the only host that searches the working directory before `PATH`; every other host
	// resolves a bare name inside its own `execvp`, which never looks there.
	it.skipIf(process.platform !== 'win32')('searches the workspace before the path', () => {
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
	})

	// `execvp` performs the lookup on every host but Windows, so the helper has nothing to do there
	// and Windows is the one host where its answer is not `undefined`.
	it.skipIf(process.platform === 'win32')('leaves the lookup to the host that performs it', () => {
		expect(resolveExecutable('node')).toBeUndefined()
	})
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
		'refuses a defined percent-delimited argument a batch target would otherwise expand',
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

	// Only Windows routes a batch target through a `cmd.exe` command line, so only Windows can show
	// that the quoting survives a path the command line would otherwise split.
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
		await waitForExit(
			{ exitCode: 0, signalCode: null, once: () => undefined, off: () => undefined },
			60_000,
		)

		const started = performance.now()
		await waitForExit(
			{ exitCode: null, signalCode: null, once: () => undefined, off: () => undefined },
			50,
		)

		expect(performance.now() - started).toBeGreaterThanOrEqual(40)
	})

	// The subject is the release channel the published contract declares. A real `EventEmitter`
	// carries `off` whether or not `ProcessChild` names it, so the object here implements exactly the
	// slice the signature takes and nothing more.
	it('releases the exit listener of a child implementing exactly the declared slice', async () => {
		const listeners: Array<() => void> = []
		const child: Pick<ProcessChild, 'exitCode' | 'signalCode' | 'once' | 'off'> = {
			exitCode: null,
			signalCode: null,
			once: (_event, listener) => listeners.push(listener),
			off: (_event, listener) => listeners.splice(listeners.indexOf(listener), 1),
		}

		await waitForExit(child, 20)

		expect(listeners).toEqual([])
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
				off: () => undefined,
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
				off: () => undefined,
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
		'reports failure for a tree no process id owns',
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

	// The fallback is reached by `process.kill` rejecting a negative pid with `ESRCH`. Windows
	// implements no process group, so it refuses a negative pid outright and never reaches it.
	it.skipIf(process.platform === 'win32')(
		'falls back to the direct child when no process group owns its pid',
		() => {
			const signals = createRecorder<readonly [NodeJS.Signals]>()

			killProcess({ pid: 4_194_303, kill: (signal) => (signals.handler(signal), true) }, 'SIGTERM')

			expect(signals.calls).toEqual([['SIGTERM']])
		},
	)

	// A non-detached child stays in the runner's own process group, so no group carries its pid and
	// the group route alone never reaches it. Windows implements no process group: `process.kill`
	// refuses a negative pid there, so only a POSIX host can run this.
	it.skipIf(process.platform === 'win32')(
		'kills a real non-detached child the group route cannot reach',
		async () => {
			const child = spawn(process.execPath, [resolveChildFixture(), 'sleep'], { stdio: 'ignore' })
			const pid = child.pid
			if (pid === undefined) throw new Error('The fixture child reported no pid')
			try {
				// The control is the pre-repair route run on its own: signalling the negated pid reports
				// ESRCH, and the helper swallowed that before the fallback existed, so this child stays
				// alive. Everything the repair added is what happens next.
				let refusal: unknown
				try {
					process.kill(-pid, 'SIGKILL')
				} catch (error) {
					refusal = error
				}
				expect(refusal instanceof Error && 'code' in refusal ? refusal.code : undefined).toBe(
					'ESRCH',
				)
				await waitForDelay(50)
				expect(isExited(child)).toBe(false)

				killProcess(child, 'SIGKILL')
				await waitForExit(child, 2_000)

				expect(child.signalCode).toBe('SIGKILL')
				expect(child.exitCode).toBe(null)
			} finally {
				holds(() => child.kill('SIGKILL'))
			}
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

	// Both mechanisms armed on one run. The first to fire terminates the child and disarms the other,
	// so exactly one of `expired` and `aborted` is ever true.
	it('reports the timeout when it fires before an armed abort', async () => {
		const controller = new AbortController()
		const late = setTimeout(() => controller.abort(), 2_000)
		try {
			const result = await run(childCommand('hang'), {
				workspace: process.cwd(),
				timeout: 100,
				grace: 20,
				signal: controller.signal,
				strict: false,
			})

			expect(result.expired).toBe(true)
			expect(result.aborted).toBe(false)
			expect(result.failed).toBe(true)
		} finally {
			clearTimeout(late)
		}
	})

	it('reports the abort when it fires before an armed timeout', async () => {
		const controller = new AbortController()
		const pending = run(childCommand('hang'), {
			workspace: process.cwd(),
			timeout: 5_000,
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

	// Both deadlines are set to the same delay, so which one the host's timer queue delivers first is
	// not fixed. Exclusivity is the property that must hold whichever wins, so that is what is asserted.
	it('reports exactly one outcome when the timeout and the abort share a deadline', async () => {
		const controller = new AbortController()
		const together = setTimeout(() => controller.abort(), 100)
		try {
			const result = await run(childCommand('hang'), {
				workspace: process.cwd(),
				timeout: 100,
				grace: 20,
				signal: controller.signal,
				strict: false,
			})

			expect(result.expired).not.toBe(result.aborted)
			expect(result.failed).toBe(true)
		} finally {
			clearTimeout(together)
		}
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

	// The documented difference between the two runners on a spawn fault. The errno itself is the
	// host's, so its sign is the property a caller can act on and the property asserted.
	it('reports the host negative errno when the command cannot be spawned', async () => {
		const result = await run(
			{ file: 'orkestrel-nonexistent-binary.exe', arguments: [] },
			{ workspace: process.cwd(), strict: false },
		)

		expect(result.failed).toBe(true)
		const code = result.code
		if (code === null) throw new Error('run reported no code for a spawn fault')
		expect(code).toBeLessThan(0)
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

				// The root deadline has to clear the grandchild's own bootstrap and still fall inside the
				// fixture's 250 ms write delay. The grandchild announces readiness 91-105 ms after the
				// call on this host and writes ~250 ms after that, so 200 ms sits between the two with
				// margin at both ends, where the former 50 ms sat inside the bootstrap window.
				const streamed = await run(childCommand('tree-write', streamedMarker), {
					workspace: process.cwd(),
					timeout: 200,
					grace: 20,
					strict: false,
				})
				expect(streamed.expired).toBe(true)

				// The readiness marker is what separates "termination reached an established grandchild"
				// from "the grandchild never started". Without it the negative below passes for either
				// reason; with it, a grandchild killed during bootstrap rejects here instead.
				await waitForCondition(() => existsSync(`${streamedMarker}.ready`), 6_000)

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

	it('reports null rather than an errno when the command cannot be spawned', () => {
		const result = runSync(
			{ file: 'orkestrel-nonexistent-binary.exe', arguments: [] },
			{ workspace: process.cwd(), strict: false },
		)

		expect(result.failed).toBe(true)
		expect(result.code).toBe(null)
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

	// The two host claims the guide makes about a detached child, driven through one supervisor that
	// holds both children: one left in the supervisor's process group and one detached into its own.
	// A terminal delivers SIGINT to its foreground group and a supervisor is ended by a signal to its
	// group, so a group-directed signal is what both claims are about. Windows has no process group
	// for `process.kill` to address, so only a POSIX host can drive this.
	it.skipIf(process.platform === 'win32')(
		'leaves a detached child beating and uninterrupted after the supervisor group is signalled',
		{ timeout: 20_000 },
		async () => {
			const scratch = createScratch()
			try {
				// Each child records that it received SIGINT and touches a heartbeat file while it lives,
				// so liveness is read from work the child performs rather than from a pid, which a
				// reaped-but-unwaited process answers for too.
				scratch.write(
					'child.mjs',
					[
						"import { writeFileSync } from 'node:fs'",
						'const [marker] = process.argv.slice(2)',
						"process.on('SIGINT', () => writeFileSync(marker + '.sigint', 'interrupted'))",
						"writeFileSync(marker + '.pid', String(process.pid))",
						"setInterval(() => writeFileSync(marker + '.beat', 'alive'), 25)",
					].join('\n'),
				)
				scratch.write(
					'supervisor.mjs',
					[
						"import { spawn } from 'node:child_process'",
						"import { writeFileSync } from 'node:fs'",
						'const [directory] = process.argv.slice(2)',
						"process.on('SIGINT', () => undefined)",
						"for (const name of ['grouped', 'detached']) {",
						"\tconst child = spawn(process.argv[0], [directory + '/child.mjs', directory + '/' + name], {",
						"\t\tdetached: name === 'detached',",
						"\t\tstdio: 'ignore',",
						'\t})',
						'\tchild.unref()',
						'}',
						"writeFileSync(directory + '/supervisor.pid', String(process.pid))",
						'setInterval(() => undefined, 1_000)',
					].join('\n'),
				)
				const grouped = join(scratch.path, 'grouped')
				const detached = join(scratch.path, 'detached')
				const supervisorPid = join(scratch.path, 'supervisor.pid')

				detach(
					{
						file: process.execPath,
						arguments: [join(scratch.path, 'supervisor.mjs'), scratch.path],
					},
					{ workspace: process.cwd() },
				)
				await waitForCondition(
					() =>
						existsSync(supervisorPid) &&
						existsSync(`${grouped}.beat`) &&
						existsSync(`${detached}.beat`),
					10_000,
				)
				const supervisor = Number.parseInt(readFileSync(supervisorPid, 'utf8'), 10)
				const survivor = Number.parseInt(readFileSync(`${detached}.pid`, 'utf8'), 10)
				const member = Number.parseInt(readFileSync(`${grouped}.pid`, 'utf8'), 10)

				try {
					process.kill(-supervisor, 'SIGINT')

					// The control fires first: the child still in the group receives the interrupt.
					await waitForCondition(() => existsSync(`${grouped}.sigint`), 10_000)
					await waitForDelay(200)
					expect(existsSync(`${detached}.sigint`)).toBe(false)

					process.kill(-supervisor, 'SIGKILL')
					await waitForDelay(300)
					const stopped = statSync(`${grouped}.beat`).mtimeMs
					const running = statSync(`${detached}.beat`).mtimeMs
					await waitForDelay(400)

					expect(statSync(`${grouped}.beat`).mtimeMs).toBe(stopped)
					expect(statSync(`${detached}.beat`).mtimeMs).toBeGreaterThan(running)
					expect(existsSync(`${detached}.sigint`)).toBe(false)
				} finally {
					holds(() => process.kill(survivor, 'SIGKILL'))
					holds(() => process.kill(member, 'SIGKILL'))
					holds(() => process.kill(supervisor, 'SIGKILL'))
				}
			} finally {
				scratch.destroy()
			}
		},
	)

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
