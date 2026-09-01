import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ProcessChild } from '@src/server'
import { describe, expect, it } from 'vitest'
import { holds } from '@orkestrel/contract'
import { createRecorder, waitForCondition, waitForDelay } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { isProcessError, ProcessError } from '@src/core'
import {
	buildExecutableCandidates,
	buildPlatformSpawn,
	buildExecuteResult,
	buildSpawn,
	captureChunk,
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
	detach,
	execute,
	executeSync,
	stopChild,
	trimHead,
	trimTail,
	validateBytes,
	validateCommand,
	validateEnvironment,
	validateText,
	validateTimer,
	validateWorkspace,
	waitForClose,
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

	// The first excluded byte opens its own code point, so no sequence spans the cut and the full
	// limit survives. This is the example the TSDoc and the guide both document.
	it('cuts at the limit when the first excluded byte begins its own code point', () => {
		expect(trimHead(Buffer.from('hello'), 3).toString('utf8')).toBe('hel')
	})

	// `61 61 61 61 80` is invalid UTF-8: the trailing byte carries the continuation bit pattern but
	// no lead byte opened a sequence that reaches it. Retreating off it would drop a valid ASCII byte
	// the caller asked for, so the retreat reads the lead byte's declared length before it fires.
	it('keeps every byte inside the limit when the excluded byte is a stray continuation byte', () => {
		const trimmed = trimHead(Buffer.from([0x61, 0x61, 0x61, 0x61, 0x80]), 4)
		expect(trimmed.byteLength).toBe(4)
		expect(trimmed.toString('utf8')).toBe('aaaa')
	})

	// The bytes of `aa\u20ac` captured one byte past a limit of 3. The lead byte `e2` at index 2
	// declares a three-byte sequence, so the sequence runs past the cut at index 3 and the retreat
	// drops it whole rather than delivering a replacement character.
	it('retreats to the start of a sequence that reaches past the cut', () => {
		const trimmed = trimHead(Buffer.from([0x61, 0x61, 0xe2, 0x82]), 3)
		expect(trimmed.toString('utf8')).toBe('aa')
		expect(trimmed.toString('utf8')).not.toContain('\u{fffd}')
	})

	// A lead byte opens at most a four-byte sequence, so the retreat scans at most three bytes back
	// from the cut. A buffer of nothing but continuation bytes has no lead byte to find, so the scan
	// ends at its own bound and the limit's bytes survive unaltered instead of the walk running to
	// zero.
	it('keeps the limit bytes when no lead byte precedes the cut', () => {
		const trimmed = trimHead(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80]), 3)
		expect(trimmed.byteLength).toBe(3)
		expect([...trimmed]).toEqual([0x80, 0x80, 0x80])
	})

	// A limit of zero excludes the byte at index 0, so the backward scan starts before the buffer.
	it('returns no bytes at a limit of zero', () => {
		expect(trimHead(Buffer.from([0x80, 0x80]), 0).byteLength).toBe(0)
	})
})
describe('captureChunk', () => {
	it('keeps the leading bytes the capture still has room for', () => {
		expect(captureChunk(Buffer.from('hello'), 3)?.toString('utf8')).toBe('hel')
	})

	it('returns the delivered buffer itself when the whole chunk fits its room', () => {
		const chunk = Buffer.from('hello')
		expect(captureChunk(chunk, 8)).toBe(chunk)
	})

	// A capture that has already taken its byte past `limit` reports a room of zero, and a caller
	// subtracting a retained total from a shrinking bound can present a negative one, so both ends of
	// the exhausted range refuse.
	it('refuses a chunk after the room is exhausted, at zero and below it', () => {
		expect(captureChunk(Buffer.from('hello'), 0)).toBeUndefined()
		expect(captureChunk(Buffer.from('hello'), -1)).toBeUndefined()
	})

	// A stream `data` listener receives an `unknown` payload, so a chunk that is not a buffer
	// contributes nothing and reports it rather than throwing.
	it('refuses a chunk that is not a buffer', () => {
		expect(captureChunk('hello', 3)).toBeUndefined()
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
		const result = executeSync(
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
					executeSync({ file, arguments: ['%PATH%'] }, { workspace: process.cwd(), strict: false })
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

				const result = executeSync({ file, arguments: ['hello'] }, { strict: false })

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
})

describe('validateWorkspace', () => {
	it('codes a refused workspace as invalid and carries the rejected value', () => {
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

describe('waitForClose', () => {
	it('reports a close that arrived inside the deadline, a deadline that elapsed first, and leaves the child holding neither listener', async () => {
		const closing = spawn(process.execPath, [resolveChildFixture(), 'exit', '0'], {
			stdio: 'ignore',
		})
		// The control is the same call against a child whose close cannot arrive inside the deadline:
		// the fixture holds its handles until something ends it, so only the bound can end this wait.
		const holding = spawn(process.execPath, [resolveChildFixture(), 'sleep'], { stdio: 'ignore' })
		const closingBaseline = closing.listenerCount('close')
		const holdingBaseline = holding.listenerCount('close')

		try {
			const arrived = await waitForClose(closing, 10_000)
			const started = performance.now()
			const expired = await waitForClose(holding, 50)
			const elapsed = performance.now() - started

			expect(arrived).toBe(true)
			expect(closing.listenerCount('close')).toBe(closingBaseline)
			expect(expired).toBe(false)
			expect(elapsed).toBeGreaterThanOrEqual(40)
			expect(isExited(holding)).toBe(false)
			expect(holding.listenerCount('close')).toBe(holdingBaseline)
		} finally {
			holds(() => holding.kill('SIGKILL'))
		}
	})

	it('accumulates no listener across repeated deadlines', async () => {
		const child = spawn(process.execPath, [resolveChildFixture(), 'sleep'], { stdio: 'ignore' })
		const baseline = child.listenerCount('close')

		try {
			for (let call = 0; call < 12; call += 1) await waitForClose(child, 1)

			expect(child.listenerCount('close')).toBe(baseline)
		} finally {
			holds(() => child.kill('SIGKILL'))
		}
	})
})

describe('stopChild', () => {
	it('signals nothing after the host has recorded the native exit', async () => {
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

	// `taskkill /F /T` is the only route to a descendant on this host, and `stopChild` selects it by
	// reading `process.platform`, so no POSIX host reaches the branch under test. The fixture also
	// detaches its descendant on `win32` alone, because a non-detached one there dies with its root
	// and would prove nothing about the tree kill.
	it.skipIf(process.platform !== 'win32')(
		'reaches a detached descendant while the root is alive and leaves one whose root already exited',
		async () => {
			const rooted = spawn(process.execPath, [resolveChildFixture(), 'tree'], {
				stdio: ['ignore', 'pipe', 'ignore'],
			})
			// The control is the same descendant shape whose root ends itself first. Nothing addresses
			// the descendant once its root is gone, which is the residual limit the guide records.
			const orphaned = spawn(process.execPath, [resolveChildFixture(), 'orphan'], {
				stdio: ['ignore', 'pipe', 'ignore'],
			})
			let rootedOutput = ''
			let orphanedOutput = ''
			rooted.stdout.on('data', (chunk: Buffer) => {
				rootedOutput += chunk.toString('utf8')
			})
			orphaned.stdout.on('data', (chunk: Buffer) => {
				orphanedOutput += chunk.toString('utf8')
			})
			let held = 0
			let abandoned = 0

			try {
				await waitForCondition(
					'both fixtures announce the descendant they spawned',
					() => rootedOutput.includes('\n') && orphanedOutput.includes('\n'),
					{ budget: 10_000 },
				)
				const [rootedLine = ''] = rootedOutput.split('\n')
				const [orphanedLine = ''] = orphanedOutput.split('\n')
				held = Number.parseInt(rootedLine.replace('grandchild:', ''), 10)
				abandoned = Number.parseInt(orphanedLine.replace('grandchild:', ''), 10)
				await waitForCondition(
					'the orphan root exits and abandons its descendant',
					() => isExited(orphaned),
					{ budget: 10_000 },
				)

				const rootedConfirmed = await stopChild(rooted, 20, 5_000)
				const orphanedConfirmed = await stopChild(orphaned, 20, 5_000)
				await waitForCondition(
					'the descendant of the live root leaves the host',
					() => !isRunning(held),
					{ budget: 10_000 },
				)

				expect(rootedConfirmed).toBe(true)
				expect(isRunning(held)).toBe(false)
				expect(orphanedConfirmed).toBe(true)
				expect(isRunning(abandoned)).toBe(true)
			} finally {
				if (held > 0) holds(() => process.kill(held, 'SIGKILL'))
				if (abandoned > 0) holds(() => process.kill(abandoned, 'SIGKILL'))
				holds(() => rooted.kill('SIGKILL'))
				holds(() => orphaned.kill('SIGKILL'))
			}
		},
	)

	// A pid identifies a process only while something holds that process open. An exited boundary
	// carries a pid the host has already reaped and may already have handed to something else, so the
	// live process spawned here stands in for whatever now owns that number. Every route out of the
	// helper — the POSIX signal, the Windows tree kill, the direct kill — addresses the pid, so that
	// process staying alive is what reports that no route ran. The boundary is a value rather than a
	// spawned child because a real child cannot both report an exit and still own its pid.
	it('addresses nothing for an already-exited child whose pid a live process now carries', async () => {
		const signals = createRecorder<readonly [NodeJS.Signals]>()
		const reused = spawn(process.execPath, [resolveChildFixture(), 'sleep'], {
			stdio: 'ignore',
		})
		// The control is an identical child no boundary names: it reports what this fixture does when
		// nothing addresses it, so the addressed process surviving is the guard rather than the shape.
		const untouched = spawn(process.execPath, [resolveChildFixture(), 'sleep'], {
			stdio: 'ignore',
		})
		const stale = reused.pid
		const bystander = untouched.pid
		if (stale === undefined || bystander === undefined) {
			throw new Error('a fixture child reported no process id')
		}

		try {
			const confirmed = await stopChild(
				{
					pid: stale,
					exitCode: 0,
					signalCode: null,
					kill: (signal) => (signals.handler(signal), true),
					once: () => undefined,
					off: () => undefined,
				},
				20,
				5_000,
			)
			// Long enough for a `taskkill.exe` spawn to have started, run, and reaped the tree it was
			// given, so the survival below is a route that never ran rather than one still running.
			await waitForDelay(500)

			expect(confirmed).toBe(true)
			expect(signals.count).toBe(0)
			expect(isRunning(stale)).toBe(true)
			expect(isRunning(bystander)).toBe(true)
		} finally {
			holds(() => reused.kill('SIGKILL'))
			holds(() => untouched.kill('SIGKILL'))
		}
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

describe('buildExecuteResult', () => {
	it('derives failure from the exit, a signal, an expiry, an abort, or a host fault', () => {
		const empty = Buffer.alloc(0)
		const ok = buildExecuteResult({
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
			buildExecuteResult({
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
			buildExecuteResult({
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
			buildExecuteResult({
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
			buildExecuteResult({
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
			buildExecuteResult({
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
		const result = buildExecuteResult({
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

describe('execute', () => {
	it('spawns the same command file that it validated', async () => {
		let reads = 0
		const result = await execute(
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
		const result = await execute(childCommand('exit', '0'), { workspace: process.cwd() })
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
			await execute(childCommand('exit', '3'), { workspace: process.cwd() })
		} catch (error) {
			thrown = error
		}
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.result?.code : undefined).toBe(3)
	})

	it('resolves a failed run with the outcome when strict is false', async () => {
		const result = await execute(childCommand('exit', '4'), {
			workspace: process.cwd(),
			strict: false,
		})
		expect(result.failed).toBe(true)
		expect(result.code).toBe(4)
		expect(result.expired).toBe(false)
	})

	it('reports a run that outlasted its timeout as expired rather than aborted', async () => {
		const result = await execute(childCommand('hang'), {
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
		const pending = execute(childCommand('sleep'), {
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
			const result = await execute(childCommand('hang'), {
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
		const pending = execute(childCommand('hang'), {
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
			const result = await execute(childCommand('hang'), {
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
		const result = await execute(childCommand('chatty'), {
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

	// The capture keeps one byte beyond `limit`, so the single code-point-boundary trim in
	// `buildExecuteResult` reads the first excluded byte and retreats off a sequence the cut split.
	// This child writes the bytes of `aa€`, whose third byte opens a three-byte sequence, so a
	// byte-exact cut at `limit` would decode as a replacement character instead.
	it('delivers no split multibyte sequence at the capture bound', async () => {
		const result = await execute(
			{
				file: process.execPath,
				arguments: ['-e', "process.stdout.write(Buffer.from('aa\\u20ac', 'utf8'))"],
			},
			{ workspace: process.cwd(), limit: 3, strict: false },
		)

		expect(result.stdout).toBe('aa')
		expect(result.stdout).not.toContain('\u{fffd}')
		expect(result.truncated).toBe(true)
	})

	// The same bound from the other side. This child writes four ASCII bytes then a stray `80`, so
	// the byte the capture reads past `limit` carries the continuation bit pattern without any lead
	// byte opening a sequence that reaches it. The trim keeps all four requested bytes.
	it('delivers the whole limit when the byte past the bound is a stray continuation byte', async () => {
		const result = await execute(
			{
				file: process.execPath,
				arguments: ['-e', 'process.stdout.write(Buffer.from([0x61, 0x61, 0x61, 0x61, 0x80]))'],
			},
			{ workspace: process.cwd(), limit: 4, strict: false },
		)

		expect(result.stdout).toBe('aaaa')
		expect(result.truncated).toBe(true)
	})

	// Both sides of the bound in one row. The capture reads one byte past `limit` and `truncated`
	// reports that the excess arrived, so a run ending exactly at `limit` is untruncated while a run
	// one byte longer is truncated, and the delivered text stays bounded by `limit` in each case.
	it('bounds the captured text by the limit and reports truncation only past it', async () => {
		const exact = await execute(
			{ file: process.execPath, arguments: ['-e', "process.stdout.write('x'.repeat(64))"] },
			{ workspace: process.cwd(), limit: 64, strict: false },
		)
		const over = await execute(
			{ file: process.execPath, arguments: ['-e', "process.stdout.write('x'.repeat(65))"] },
			{ workspace: process.cwd(), limit: 64, strict: false },
		)

		expect(Buffer.byteLength(exact.stdout)).toBe(64)
		expect(exact.truncated).toBe(false)
		expect(Buffer.byteLength(over.stdout)).toBe(64)
		expect(over.truncated).toBe(true)
	})

	it('rejects an unspawnable command with spawn code and the host cause', async () => {
		let thrown: unknown
		try {
			await execute(
				{
					file: 'orkestrel-nonexistent-binary.exe',
					arguments: [],
					input: 'unspawnable input',
				},
				{ workspace: process.cwd() },
			)
		} catch (error) {
			thrown = error
		}
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('spawn')
		expect(isProcessError(thrown) ? thrown.cause : undefined).toBeInstanceOf(Error)
	})

	// The documented difference between `execute` and `executeSync` on a spawn fault. The errno
	// itself is the host's, so its sign is the property a caller can act on and the property
	// asserted.
	it('reports the host negative errno when the command cannot be spawned', async () => {
		const result = await execute(
			{ file: 'orkestrel-nonexistent-binary.exe', arguments: [] },
			{ workspace: process.cwd(), strict: false },
		)

		expect(result.failed).toBe(true)
		const code = result.code
		if (code === null) throw new Error('execute reported no code for a spawn fault')
		expect(code).toBeLessThan(0)
	})

	it('reports a pending input write fault as the cause of a failed run', async () => {
		const input = 'x'.repeat(4 * 1_024 * 1_024)
		const faulting = {
			file: process.execPath,
			arguments: ['-e', 'setTimeout(() => process.exit(0), 150)'],
		}
		const reading = {
			file: process.execPath,
			arguments: ['-e', 'process.stdin.resume()'],
		}

		const result = await execute(faulting, { input, strict: false })
		let thrown: unknown
		try {
			await execute(faulting, { input })
		} catch (error) {
			thrown = error
		}
		const control = await execute(reading, { input })

		expect(result.failed).toBe(true)
		expect(result).toMatchObject({
			expired: false,
			aborted: false,
			truncated: false,
			code: 0,
			signal: null,
		})
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.cause : undefined).toBeInstanceOf(Error)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('input')
		expect(isProcessError(thrown) ? thrown.message : undefined).toBe(
			`Command '${result.command}' failed while writing standard input`,
		)
		expect(control.failed).toBe(false)
		expect(control.code).toBe(0)
	})

	it('refuses a NUL in a per-run environment override before spawning', async () => {
		const nul = String.fromCodePoint(0)
		let thrown: unknown
		try {
			await execute(childCommand('exit', '0'), {
				workspace: process.cwd(),
				environment: { PROCESS_TEST_KEY: `a${nul}b` },
			})
		} catch (error) {
			thrown = error
		}

		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
	})

	it('rejects a throwing signal getter before spawning a child', async () => {
		const scratch = createScratch()
		const marker = join(scratch.path, 'hostile-signal.txt')
		const failure = new Error('hostile signal getter')
		let thrown: unknown

		try {
			try {
				await execute(childCommand('write', marker), {
					workspace: process.cwd(),
					get signal(): AbortSignal {
						throw failure
					},
				})
			} catch (error) {
				thrown = error
			}
			await waitForDelay(200)

			expect(thrown).toBe(failure)
			expect(existsSync(marker)).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
})

describe('executeSync', () => {
	it(
		'leaves an established grandchild running after a root-only timeout where asynchronous execution ends the tree',
		// Sized from a contended run rather than an isolated one: this proof drives real process
		// creation, which cost 75-163 ms per interpreter unloaded on this host and reached 2.5 s for
		// the same spawn under load, so a budget sized from the isolated 4.2 s cost of this file would
		// report contention as a timeout carrying no diagnostic about the code.
		{ timeout: 40_000 },
		async () => {
			const scratch = createScratch()
			let held = 0
			try {
				const blockingMarker = join(scratch.path, 'blocking.txt')

				// The root must outlive the grandchild's interpreter startup, or this measures bootstrap
				// rather than termination. Node bootstraps in 45.7-49.9 ms on this host, so the former
				// 50 ms root timeout was a coin flip and lost three times in six.
				const blocking = executeSync(childCommand('tree-write', blockingMarker), {
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
				await waitForCondition(
					"the blocking grandchild's readiness marker appearing on disk",
					() => existsSync(`${blockingMarker}.ready`),
					{ budget: 6_000 },
				)
				await waitForCondition(
					'the blocking grandchild writing its marker file',
					() => existsSync(blockingMarker),
					{ budget: 6_000 },
				)
				expect(existsSync(blockingMarker)).toBe(true)

				// The asynchronous contrast reads the descendant itself rather than a marker file. A
				// marker cannot report termination here: the `delayed-write` descendant writes 250 ms
				// after announcing readiness, while a Windows tree kill has to launch `taskkill.exe` as
				// its own process, and that launch alone costs 343-835 ms against a nonexistent pid on
				// this host before any tree is walked. Measured through this `execute` call with the
				// descendant's write delay as the only variable, a 250 ms delay left the marker written
				// and a 5 s delay left it absent, with the descendant gone in each case. So the marker's
				// absence measures process-creation latency, and the descendant's own departure measures
				// what this test claims.
				const streamed = await execute(childCommand('tree'), {
					workspace: process.cwd(),
					timeout: 3_000,
					grace: 20,
					strict: false,
				})
				expect(streamed.expired).toBe(true)

				// The published pid is what makes the descendant ESTABLISHED: the fixture writes it after
				// its own spawn returns, so a run reporting one had the descendant in its tree before the
				// deadline fired. The deadline has to outlast that spawn, and asserting the publication is
				// what keeps a host too slow to reach it failing here rather than passing below for a
				// descendant that never existed.
				const [line = ''] = streamed.stdout.split('\n')
				held = Number.parseInt(line.replace('grandchild:', ''), 10)
				expect(Number.isInteger(held)).toBe(true)

				// The descendant holds `sleep`, which exits for nothing but a kill, and nothing addresses
				// it after its root is gone. Its departure is therefore the tree kill's own work, and the
				// budget bounds how long that kill may take rather than asserting how fast it is.
				await waitForCondition(
					'the descendant of the terminated root leaves the host',
					() => !isRunning(held),
					{ budget: 15_000 },
				)
				expect(isRunning(held)).toBe(false)
			} finally {
				if (held > 0) holds(() => process.kill(held, 'SIGKILL'))
				scratch.destroy()
			}
		},
	)

	it('sends string input as bytes, so a NUL in the payload reaches the child', () => {
		// input is stdin payload rather than a spawn-bound string, so it carries no NUL restriction.
		// Passing the string through unconverted made spawnSync reject it with Unknown encoding: buffer.
		const payload = 'before\u0000after\nstop\n'
		const result = executeSync(childCommand('echo'), {
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
		const result = executeSync(
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
			executeSync({
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
		const result = executeSync(childCommand('exit', '0'), { workspace: process.cwd() })
		expect(result.failed).toBe(false)
		expect(result.stdout).toContain('ran:0')
	})

	it('resolves a failed synchronous run with the outcome when strict is false', () => {
		const result = executeSync(childCommand('exit', '5'), {
			workspace: process.cwd(),
			strict: false,
		})
		expect(result.failed).toBe(true)
		expect(result.code).toBe(5)
	})

	it('throws a process error for a failed synchronous run by default', () => {
		let thrown: unknown
		try {
			executeSync(childCommand('exit', '6'), { workspace: process.cwd() })
		} catch (error) {
			thrown = error
		}
		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.result?.code : undefined).toBe(6)
	})

	it('fails a synchronous run whose output overflowed the limit', () => {
		const result = executeSync(childCommand('chatty'), {
			workspace: process.cwd(),
			limit: 1_024,
			strict: false,
		})

		expect(result.truncated).toBe(true)
		expect(result.failed).toBe(true)
		expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1_024)
	})

	// The guide claims neither run function returns a split sequence, and each reaches that from a
	// different side. `execute` bounds its own capture one byte past `limit`; `executeSync` hands
	// `limit` to the host as `maxBuffer`, and a child that overruns the ceiling still returns the
	// bytes the host had already read, so the same trim has its excluded byte. This child writes the
	// bytes of `aa\u20acbb\u20ac`, whose third and sixth bytes open three-byte sequences, and every
	// limit across the string is driven so no cut position is left unproven.
	it('delivers no split multibyte sequence at any synchronous capture bound', () => {
		const command = {
			file: process.execPath,
			arguments: ['-e', "process.stdout.write(Buffer.from('aa\\u20acbb\\u20ac', 'utf8'))"],
		}

		for (let limit = 1; limit <= 11; limit += 1) {
			const result = executeSync(command, { workspace: process.cwd(), limit, strict: false })
			expect(result.stdout).not.toContain('\u{fffd}')
			expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(limit)
		}
	})

	it('passes a shell metacharacter through as one argument', () => {
		const result = executeSync(
			{ file: 'node', arguments: [resolveChildFixture(), 'args', 'a&b'] },
			{ workspace: process.cwd(), strict: false },
		)

		expect(result.failed).toBe(false)
		expect(result.stdout).toContain('args:a&b')
	})

	it('threads the spawn cause onto the rejected process error', () => {
		let thrown: unknown
		try {
			executeSync(
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
		const result = executeSync(
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
			executeSync(childCommand('exit', '0'), {
				workspace: process.cwd(),
				environment: { PROCESS_TEST_KEY: `a${nul}b` },
			})
		} catch (error) {
			thrown = error
		}

		expect(isProcessError(thrown)).toBe(true)
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('invalid')
	})

	it('runs the child in the workspace it validated', () => {
		const validated = createScratch()
		const later = createScratch()
		let reads = 0

		try {
			const result = executeSync(
				{ file: process.execPath, arguments: ['-e', 'process.stdout.write(process.cwd())'] },
				{
					get workspace(): string {
						reads += 1
						return reads === 1 ? validated.path : later.path
					},
				},
			)

			expect(realpathSync(result.stdout)).toBe(realpathSync(validated.path))
		} finally {
			validated.destroy()
			later.destroy()
		}
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

	// The host claims the guide makes about a detached child, driven through one supervisor that
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
					'the supervisor pid file and the grouped and detached heartbeat markers appearing on disk',
					() =>
						existsSync(supervisorPid) &&
						existsSync(`${grouped}.beat`) &&
						existsSync(`${detached}.beat`),
					{ budget: 10_000 },
				)
				const supervisor = Number.parseInt(readFileSync(supervisorPid, 'utf8'), 10)
				const survivor = Number.parseInt(readFileSync(`${detached}.pid`, 'utf8'), 10)
				const member = Number.parseInt(readFileSync(`${grouped}.pid`, 'utf8'), 10)

				try {
					process.kill(-supervisor, 'SIGINT')

					// The control fires first: the child still in the group receives the interrupt.
					await waitForCondition(
						'the grouped child recording the interrupt it received',
						() => existsSync(`${grouped}.sigint`),
						{ budget: 10_000 },
					)
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

	it('spawns the detached child in the workspace it validated', async () => {
		const validated = createScratch()
		const later = createScratch()
		let reads = 0

		try {
			detach(childCommand('write', 'detached.txt'), {
				get workspace(): string {
					reads += 1
					return reads === 1 ? validated.path : later.path
				},
			})
			await waitForDelay(200)

			expect(existsSync(join(validated.path, 'detached.txt'))).toBe(true)
			expect(existsSync(join(later.path, 'detached.txt'))).toBe(false)
		} finally {
			validated.destroy()
			later.destroy()
		}
	})
})
