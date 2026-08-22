import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
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
	executeSync,
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
	waitForClose,
	waitForExit,
} from '@src/server'
import { resolveChildFixture } from '../../setupServer.js'

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
