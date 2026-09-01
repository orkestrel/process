// The guides-parity gate: @orkestrel/guide's checks run against this repository's own
// `guides/README.md` manifest, and every flagship fence in `guides/process.md` is transcribed
// here and asserted against what its comments claim. Name resolution is not a behavioural
// proof, so a fence documenting a value the code contradicts is exactly what the transcriptions
// catch. Change a fence, change its transcription.

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { getEventListeners } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { describe, expect, it } from 'vitest'
import { holds } from '@orkestrel/contract'
import {
	computeSymbolKey,
	createGuide,
	createSource,
	createSourceManager,
	extractFenceImports,
	extractSourceLines,
	findMissing,
	findMissingSymbols,
	findUnexampled,
	findUnlisted,
	isExternalLink,
	parseManifest,
	resolveLink,
} from '@orkestrel/guide'
import { requireValue, waitForCondition, waitForDelay } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'
import {
	createDuplicateError,
	createInvalidError,
	createProtocolError,
	createExecuteError,
	isProcessError,
	PROCESS_BACKLOG,
	PROCESS_CONFIRMATION,
	PROCESS_DRAIN,
	PROCESS_ERROR_CODES,
	PROCESS_EVIDENCE,
	PROCESS_GRACE,
	PROCESS_OUTPUT,
	PROCESS_PATHEXT,
	PROCESS_TIMER,
} from '@src/core'
import {
	buildExecutableCandidates,
	buildPlatformSpawn,
	buildExecuteResult,
	buildSpawn,
	captureChunk,
	createProcess,
	createProcessManager,
	createSession,
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
	execute,
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

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['text', 'ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** The true self-package root specifier. */
const ROOT = '@orkestrel/process'
/** Each import specifier this package's own guides may resolve against. */
const MODULES = Object.freeze({
	'@orkestrel/process': 'src/core',
	'@orkestrel/process/server': 'src/server',
})
/**
 * The names each face must refuse from its neighbouring face.
 *
 * Each row is compared with the neighbouring face's published surface, so the list fails when that
 * surface changes and cannot rot.
 */
const REFUSALS: Readonly<
	Record<string, { readonly foreign: readonly string[]; readonly shared: readonly string[] }>
> = Object.freeze({
	'@orkestrel/process': Object.freeze({
		foreign: Object.freeze([
			'Process',
			'ProcessChild',
			'ProcessManager',
			'Session',
			'SupervisorFace',
			'buildExecutableCandidates',
			'buildExecuteResult',
			'buildPlatformSpawn',
			'buildSpawn',
			'captureChunk',
			'createProcess',
			'createProcessManager',
			'createSession',
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
			'waitForClose',
			'waitForExit',
		]),
		shared: Object.freeze([]),
	}),
	'@orkestrel/process/server': Object.freeze({
		foreign: Object.freeze([
			'DetachOptions',
			'ExecutableOptions',
			'ExecuteInput',
			'ExecuteOptions',
			'ExecuteResult',
			'ExecuteSyncOptions',
			'PROCESS_BACKLOG',
			'PROCESS_CONFIRMATION',
			'PROCESS_DRAIN',
			'PROCESS_ERROR_CODES',
			'PROCESS_EVIDENCE',
			'PROCESS_GRACE',
			'PROCESS_OUTPUT',
			'PROCESS_PATHEXT',
			'PROCESS_TIMER',
			'ProcessCommand',
			'ProcessError',
			'ProcessErrorCode',
			'ProcessErrorContext',
			'ProcessErrorOptions',
			'ProcessEventMap',
			'ProcessExit',
			'ProcessInterface',
			'ProcessManagerEventMap',
			'ProcessManagerInterface',
			'ProcessManagerOptions',
			'ProcessOptions',
			'SessionEventMap',
			'SessionInterface',
			'SessionOptions',
			'SpawnInput',
			'createDuplicateError',
			'createExecuteError',
			'createInvalidError',
			'createProtocolError',
			'isProcessError',
		]),
		shared: Object.freeze([]),
	}),
})
/**
 * Declarations deliberately kept out of a barrel, as `computeSymbolKey` strings, keyed by the face whose
 * module declares each one.
 *
 * Naming one here is what makes it intentional rather than forgotten, and the assertions over this
 * table fail when a name here stops being stranded, so the table cannot rot. `Supervisor` is the
 * supervision engine each published face composes: its constructor takes the composing face's own
 * callbacks, which no consumer holds, so a consumer cannot construct one.
 */
const INTERNALS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	'@orkestrel/process': Object.freeze([]),
	'@orkestrel/process/server': Object.freeze(['class Supervisor']),
})
/** Every deliberately stranded declaration, read as one scope the way a guide's source is. */
const INTERNAL: readonly string[] = Object.freeze(Object.values(INTERNALS).flat())
/**
 * Test files no guide's Tests section lists, as repository-relative paths.
 *
 * Each is a vendored fleet-wide proof whose subject is the workspace rather than this package's
 * public surface. Naming one here is what makes the omission deliberate, and the assertion over
 * this list fails when a name here stops being omitted, so the list cannot rot.
 */
const UNLISTED_TESTS: readonly string[] = Object.freeze([
	'tests/config.test.ts',
	'tests/policy.test.ts',
])
/** Root-level files this package's guides link to. `readInventory` walks directories only. */
const ROOT_FILES = Object.freeze(['AGENTS.md', 'README.md'])

const root = new URL('../', import.meta.url)
const files: Record<string, string> = {
	...readInventory(root, ['src', 'guides', 'tests'], { extensions: ['.ts', '.md'] }),
}
for (const name of ROOT_FILES) files[name] = readFileSync(new URL(name, root), 'utf8')
const manifest = parseManifest(
	requireValue(files['guides/README.md'], 'Missing file: guides/README.md'),
	'guides',
)
const sourceManager = createSourceManager({ files, modules: MODULES })

// The published faces in one table. `SOURCES`, the refusal rows, and the live population rows
// all read it, so a face's scope and its export key have one place to be stated.
const FACES = Object.freeze(
	Object.entries(MODULES).map(([specifier, module]) => ({ specifier, module })),
)
const SOURCES = new Map(
	FACES.map((face): [string, ReturnType<typeof createSource>] => [
		face.specifier,
		requireValue(sourceManager.source(face.specifier), `Unmapped specifier: ${face.specifier}`),
	]),
)

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

describe('public package faces', () => {
	// Each literal refusal list is independent of the live Source that the assertion reads. A
	// widened `module` can therefore leak a neighbouring face without changing its expectation.
	for (const face of FACES) {
		const refusal = requireValue(
			REFUSALS[face.specifier],
			`Missing refusal list: ${face.specifier}`,
		)
		const { foreign, shared } = refusal
		const neighbour = requireValue(
			FACES.find((candidate) => candidate.specifier !== face.specifier),
			`Missing neighbouring face: ${face.specifier}`,
		)
		const neighbouring = requireValue(
			SOURCES.get(neighbour.specifier),
			`Unmapped neighbouring specifier: ${neighbour.specifier}`,
		)
		const neighbouringNames = neighbouring.surface().map((symbol) => symbol.name)

		it(`keeps the refusal list aligned with the neighbouring face for ${face.specifier}`, () => {
			expect([...foreign].sort()).toEqual(
				neighbouringNames.filter((name) => !shared.includes(name)).sort(),
			)
		})

		it(`publishes none of a neighbouring face's names on ${face.specifier}`, () => {
			const source = requireValue(SOURCES.get(face.specifier), 'Unmapped specifier')
			const published = source.surface().map((symbol) => symbol.name)
			expect(foreign.length).toBeGreaterThan(0)
			expect(foreign.filter((name) => published.includes(name))).toEqual([])
			expect(
				shared.filter((name) => !published.includes(name) || !neighbouringNames.includes(name)),
			).toEqual([])
		})
	}

	it('derives the exact package export keys from the same face map', () => {
		const parsed: unknown = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
		if (typeof parsed !== 'object' || parsed === null) {
			throw new Error('The package manifest is not a record')
		}
		const exports: unknown = Object.getOwnPropertyDescriptor(parsed, 'exports')?.value
		if (typeof exports !== 'object' || exports === null) {
			throw new Error('The package manifest declares no object exports')
		}
		const expected = FACES.map((face) =>
			face.specifier === ROOT ? '.' : `.${face.specifier.slice(ROOT.length)}`,
		)
		expect(Object.keys(exports).sort()).toEqual(expected.concat('./package.json').sort())
	})
})

// Faces declaring the same class, where only the core barrel re-exports it: the server face
// strands `Process`, and reading them as one scope hides that. The fixture rows are the
// instrument's negative control; the live rows cannot play that part, because a union of
// internally complete barrels is itself internally complete.
const FIXTURE_FILES: Readonly<Record<string, string>> = Object.freeze({
	'core/index.ts': "export * from './Process.js'\n",
	'core/Process.ts': 'export class Process {}\n',
	'server/index.ts': "export * from './ProcessManager.js'\n",
	'server/ProcessManager.ts': 'export class ProcessManager {}\n',
	'server/Process.ts': 'export class Process {}\n',
})

const POPULATIONS = Object.freeze([
	...FACES.map((face) => ({
		name: `${face.specifier} barrel`,
		files,
		module: face.module,
		stranded: requireValue(INTERNALS[face.specifier], `Missing internal list: ${face.specifier}`),
		phantom: [],
	})),
	{
		name: 'stranded server face',
		files: FIXTURE_FILES,
		module: 'server',
		stranded: ['class Process'],
		phantom: [],
	},
	{
		name: 'core and server faces read as one scope',
		files: FIXTURE_FILES,
		module: ['core', 'server'],
		stranded: [],
		phantom: [],
	},
])

for (const entry of POPULATIONS) {
	const source = createSource({ files: entry.files, module: entry.module })

	describe(`${entry.name}`, () => {
		it('has non-empty direct and barrel populations', () => {
			expect(source.exports().length).toBeGreaterThan(0)
			expect(source.surface().length).toBeGreaterThan(0)
		})
		it('strands exactly its expected declarations', () => {
			expect(findMissingSymbols(source.exports(), source.surface())).toEqual(entry.stranded)
		})
		it('re-exports exactly its expected phantom symbols', () => {
			expect(findMissingSymbols(source.surface(), source.exports())).toEqual(entry.phantom)
		})
	})
}

for (const entry of manifest) {
	const guide = createGuide(requireValue(files[entry.spec], `Missing file: ${entry.spec}`))
	const source = createSource({ files, module: entry.source })

	describe(`${entry.concept}`, () => {
		it('uses only listed fence languages', () => {
			expect(findUnlisted(guide.fences(), FENCE_LANGUAGES)).toEqual([])
		})

		it('extracts non-empty aggregate barrel and documented surfaces', () => {
			expect(source.surface().length).toBeGreaterThan(0)
			expect(guide.surface().length).toBeGreaterThan(0)
		})
		it('re-exports every direct declaration that is not named internal', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
		})
		it('names no symbol internal that the barrel already exports', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
		})
		it('re-exports only direct declarations', () => {
			expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
		})
		it('documents every barrel export', () => {
			expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
		})
		it('documents only barrel exports', () => {
			expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
		})

		it('exposes no hidden module-scope declarations', () => {
			expect(source.hidden().map(computeSymbolKey)).toEqual([])
		})

		for (const group of guide.methods()) {
			const members = source.methods(group.interface)
			const entity = group.interface.replace(/Interface$/u, '')
			describe(`${group.interface}`, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, group.methods)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(group.methods, members)).toEqual([])
				})
				it(`${entity} exposes no undocumented method`, () => {
					const extra =
						entity === group.interface ? [] : findMissing(source.methods(entity), group.methods)
					expect(extra).toEqual([])
				})
			})
		}

		it('documents at least one method group', () => {
			expect(guide.methods().length).toBeGreaterThan(0)
		})

		it('documents an example for every Surface function', () => {
			const fences = guide
				.fences()
				.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				.map((fence) => fence.code)
			const names = guide
				.surface()
				.filter((symbol) => symbol.kind === 'function')
				.map((symbol) => symbol.name)
			expect(names.length).toBeGreaterThan(0)
			expect(findUnexampled(names, fences, source.examples())).toEqual([])
		})

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/u, '')
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide
						.fences()
						.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
						.map((fence) => fence.code)
					const examples =
						entity === group.interface
							? source.examples(group.interface)
							: source.examples(group.interface).concat(source.examples(entity))
					expect(findUnexampled(group.methods, fences, examples)).toEqual([])
				})
			})
		}

		// The membership rule is `extractFenceImports`'s own grammar read off Guide's comment-aware source
		// projection, not "named-brace imports": every statement it surfaces is checked and nothing
		// else is. A mapped specifier's bindings compare against that face's barrel surface; a
		// repository alias and an unmapped true subpath of the root are refused, the alias because a
		// public guide example must import through a published specifier; a foreign package stays
		// external and is compared against no face.
		it('imports only real exports through published specifiers in every ts fence', () => {
			const refused: string[] = []
			const missing: string[] = []
			for (const fence of guide.fences().filter((row) => row.language === EXAMPLE_LANGUAGE)) {
				const projected = extractSourceLines(fence.code)
					.map((line) => line.code)
					.join('\n')
				for (const statement of extractFenceImports(projected)) {
					const specifier = statement.specifier
					if (specifier.startsWith('@src/') || specifier.startsWith('@app/')) {
						refused.push(specifier)
						continue
					}
					const face = SOURCES.get(specifier)
					if (face === undefined) {
						if (specifier === ROOT || specifier.startsWith(`${ROOT}/`)) refused.push(specifier)
						continue
					}
					missing.push(
						...findMissing(
							statement.names,
							face.surface().map((symbol) => symbol.name),
						),
					)
				}
			}
			expect(refused).toEqual([])
			expect(missing).toEqual([])
		})

		it('resolves every relative link', () => {
			const broken = guide
				.links()
				.filter((href) => !isExternalLink(href))
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(broken).toEqual([])
		})
		it('links only to test files that exist', () => {
			const missing = guide
				.tests()
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(missing.length).toBe(0)
			expect(guide.tests().length).toBeGreaterThan(0)
		})
		// The Tests section is an inventory of what this package proves, so a proof that exists and is
		// not listed is the defect. Listing is asserted as membership against the real test tree,
		// because a count passes while the tree grows a file the section never gained.
		it('lists every test file but the ones named unlisted', () => {
			const listed = guide.tests().map((href) => resolveLink(entry.spec, href))
			const present = Object.keys(files).filter((path) => path.endsWith('.test.ts'))

			expect(present.length).toBeGreaterThan(UNLISTED_TESTS.length)
			expect(
				present.filter((path) => !listed.includes(path) && !UNLISTED_TESTS.includes(path)),
			).toEqual([])
			expect(UNLISTED_TESTS.filter((path) => listed.includes(path))).toEqual([])
		})
	})
}

// ── Flagship fence transcriptions ────────────────────────────────────────────
//
// Each row that follows is one `guides/process.md` fence, run against the real barrels, asserting the
// value its comment claims. A child is spawned through `process.execPath`'s own runtime name so
// the transcription exercises the same no-shell resolver a reader's `node` reaches.

/**
 * Every constant the guide's Constants table documents, keyed by the name its `API` cell prints.
 *
 * The row set is compared against these keys, so a constant the barrel gained with no row, and a
 * row naming a constant that does not exist, each fail.
 */
const CONSTANTS: Readonly<Record<string, number | string | readonly string[]>> = Object.freeze({
	PROCESS_GRACE,
	PROCESS_CONFIRMATION,
	PROCESS_DRAIN,
	PROCESS_EVIDENCE,
	PROCESS_BACKLOG,
	PROCESS_OUTPUT,
	PROCESS_TIMER,
	PROCESS_PATHEXT,
	PROCESS_ERROR_CODES,
})
/**
 * Constants whose `Value` cell is prose rather than a literal, as `API` cell names.
 *
 * `PROCESS_ERROR_CODES` prints as `the code tuple`, so no cell text compares against the tuple; the
 * codes themselves are gated by `tables exactly the error codes the tuple declares`. Naming one
 * here is what makes the omission deliberate, and the assertion over this list fails when such a
 * cell becomes a literal, so the list cannot rot.
 */
const PROSE_CONSTANTS: readonly string[] = Object.freeze(['PROCESS_ERROR_CODES'])

describe('flagship fences', () => {
	it('bounds one delivered chunk and refuses one that is not a buffer', () => {
		expect(captureChunk(Buffer.from('hello'), 3)?.toString('utf8')).toBe('hel')
		expect(captureChunk('hello', 3)).toBeUndefined()
	})

	it('states the numeric teardown backlog cap on every public contract', () => {
		const guide = requireValue(files['guides/process.md'], 'Missing file: guides/process.md')
		const types = requireValue(files['src/core/types.ts'], 'Missing file: src/core/types.ts')

		expect(guide).toContain('twice `backlog`')
		expect(types).toContain('twice `backlog`')
		expect(guide).toContain('loses nothing before termination')
		expect(types).toContain('loses nothing before termination')
	})

	// The qualification the sentence above carries, executed. A consumer that requested its iterator
	// before the child spoke is the case pausing is supposed to make lossless, and it still loses
	// lines once termination begins, which is the whole of what `before termination` qualifies. The
	// child traps `SIGTERM` and keeps writing, so lines certainly arrive while the stop is in flight;
	// a child that dies on the first signal produces no push during termination and drops nothing.
	it('drops lines for a requesting consumer once termination begins', async () => {
		const writer =
			"process.on('SIGTERM', () => undefined); console.log('ready'); let n = 0;" +
			" setInterval(() => { for (let c = 0; c < 256; c += 1) console.log((n += 1) + ':' + 'x'.repeat(128)) }, 1)"
		const child = createProcess({
			command: { file: process.execPath, arguments: ['-e', writer] },
			workspace: process.cwd(),
			backlog: 1_024,
			grace: 100,
		})
		const iterator = child.lines[Symbol.asyncIterator]()

		expect((await iterator.next()).value).toBe('ready')
		expect(await child.stop()).toBe(true)
		await child.destroy()

		expect(child.truncated).toBe(true)
	})

	// The Vocabulary ruling that one name carries one fact on both surfaces. The sentence is only
	// worth asserting if both surfaces report that fact, so both are driven here: a supervised child
	// against its retention bound, and a one-shot run against its capture `limit`.
	it('reports omitted output under one name on both public surfaces', async () => {
		const guide = requireValue(
			files['guides/process.md'],
			'Missing file: guides/process.md',
		).replace(/\s+/gu, ' ')
		expect(guide).toContain('One name on both surfaces, because it reports one fact')

		const chatty = createProcess({
			command: {
				file: process.execPath,
				arguments: [
					'-e',
					'for (let n = 0; n < 4096; n += 1) console.log(n + ":" + "x".repeat(128))',
				],
			},
			workspace: process.cwd(),
			backlog: 1_024,
		})
		await chatty.exit
		await chatty.destroy()

		const bounded = await execute(
			{ file: process.execPath, arguments: ['-e', 'process.stdout.write("x".repeat(4096))'] },
			{ limit: 16, strict: false },
		)

		expect(chatty.truncated).toBe(true)
		expect(bounded.truncated).toBe(true)
	})

	// The guide states that nothing in the result recovers which stream overflowed. That sentence
	// replaced advice to compare each captured length against `limit`, which cannot work: both
	// streams are trimmed to the cap. This drives the exact case that refuted it — one stream
	// stopping at the cap, the other running past it — so the false advice cannot return unnoticed.
	// The result's exact member set is pinned beside it, because the sentence is a claim about the
	// whole result rather than about a subset of its fields: any added `ExecuteResult` member fails
	// this row, and that failure is a prompt to rule on the sentence, not a list to extend.
	//
	// The guide's remedy is driven too. Re-running at a `limit` neither stream reaches is what
	// recovers the per-stream lengths, so the closing assertions read the lengths the bounded call
	// could not tell apart.
	it('reports no way to tell which stream overflowed, and recovers the lengths above the bound', () => {
		const guide = requireValue(
			files['guides/process.md'],
			'Missing file: guides/process.md',
		).replace(/\s+/gu, ' ')
		expect(guide).toContain('both captured strings are trimmed to `limit`')
		expect(guide).toContain(
			're-run with a `limit` high enough that `truncated` is `false`, then compare each captured length against the original bound',
		)

		const limit = 16
		const command = {
			file: process.execPath,
			arguments: [
				'-e',
				`process.stdout.write('x'.repeat(${limit})); process.stderr.write('y'.repeat(${limit + 1}))`,
			],
		}
		const written = executeSync(command, { limit, strict: false })

		expect(written.truncated).toBe(true)
		expect(Buffer.byteLength(written.stdout)).toBe(limit)
		expect(Buffer.byteLength(written.stderr)).toBe(limit)
		expect(Object.keys(written).sort()).toEqual([
			'aborted',
			'code',
			'command',
			'expired',
			'failed',
			'signal',
			'stderr',
			'stdout',
			'truncated',
		])

		const recovered = executeSync(command, { limit: limit * 4 })

		expect(recovered.truncated).toBe(false)
		expect(Buffer.byteLength(recovered.stdout)).toBe(limit)
		expect(Buffer.byteLength(recovered.stderr)).toBe(limit + 1)
	})

	it('states the root-only synchronous timeout boundary in the guide and types', () => {
		const guide = requireValue(files['guides/process.md'], 'Missing file: guides/process.md')
		const types = requireValue(files['src/core/types.ts'], 'Missing file: src/core/types.ts')

		expect(guide).toContain('`executeSync` ends only the root process')
		expect(types).toContain('`timeout` ends only the root process')
	})

	it('states that standard-input payload accepts NUL in the guide and types', () => {
		const guide = requireValue(files['guides/process.md'], 'Missing file: guides/process.md')
		const types = requireValue(files['src/core/types.ts'], 'Missing file: src/core/types.ts')

		expect(guide).toContain('standard-input payload and carries no NUL restriction')
		expect(types).toContain('standard-input payload and carries no NUL restriction')
	})

	// The Value column read off the guide itself, so editing a cell fails this row. Comparing the
	// imported constants against literals written here would leave that column guarded by nothing,
	// under a name that claims to guard exactly it. A cell drops its digit separators and its
	// quotes before the comparison, which is the whole difference between the guide's notation and
	// the source literal.
	it('documents the constant values its Surface table prints', () => {
		const guide = requireValue(files['guides/process.md'], 'Missing file: guides/process.md')
		const section = guide.slice(guide.indexOf('### Constants'))
		const table = section.slice(0, section.indexOf('\n\n', section.indexOf('| API')))
		const rows = Array.from(
			table.matchAll(/^\| `(\w+)` +\| const +\| ([^|]+?) +\|/gmu),
			(match) => ({ name: match[1] ?? '', cell: match[2] ?? '' }),
		)

		const prose = rows.filter((row) => PROSE_CONSTANTS.includes(row.name))
		const printed = rows.filter((row) => !PROSE_CONSTANTS.includes(row.name))

		expect(rows.map((row) => row.name).sort()).toEqual(Object.keys(CONSTANTS).sort())
		expect(prose.map((row) => row.name)).toEqual([...PROSE_CONSTANTS])
		expect(prose.filter((row) => row.cell.startsWith('`')).map((row) => row.name)).toEqual([])
		expect(printed.map((row) => `${row.name} ${row.cell.replace(/[`_']/gu, '')}`)).toEqual(
			printed.map(
				(row) =>
					`${row.name} ${String(requireValue(CONSTANTS[row.name], `Undeclared constant row: ${row.name}`))}`,
			),
		)
	})

	// The guide's error table lists one row per declared code, so the table and the tuple are one
	// statement. A code added to the tuple with no row leaves the table incomplete.
	it('tables exactly the error codes the tuple declares', () => {
		const guide = requireValue(files['guides/process.md'], 'Missing file: guides/process.md')
		const heading = guide.indexOf('| Code ')
		expect(heading).toBeGreaterThan(-1)
		const table = guide.slice(heading)
		const tabled = Array.from(
			table.slice(0, table.indexOf('\n\n')).matchAll(/^\| `([a-z]+)` +\|/gmu),
			(match) => match[1] ?? '',
		)

		expect(tabled.sort()).toEqual([...PROCESS_ERROR_CODES].sort())
	})

	it('frames the Surface fence lines and resolves its exit', async () => {
		const child = createProcess({
			command: { file: 'node', arguments: ['-e', 'console.log("ready"); console.log("done")'] },
			workspace: process.cwd(),
		})

		const lines: string[] = []
		for await (const line of child.lines) lines.push(line)
		expect(lines).toEqual(['ready', 'done'])

		const exit = await child.exit
		expect(exit.code).toBe(0)
		await child.destroy()
	})

	it('spawns the detached fence without waiting', () => {
		expect(
			detach({ file: process.execPath, arguments: ['-e', ''] }, { workspace: process.cwd() }),
		).toBeUndefined()
	})

	it('confirms the bounded-stop fence', async () => {
		const worker = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 50)'], {
			detached: process.platform !== 'win32',
			stdio: 'ignore',
		})

		const confirmed = await stopChild(worker, 5_000, 5_000)
		expect(confirmed).toBe(true)
	})

	it('closes the paired stop fence inside its bound', async () => {
		const collector = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 50)'], {
			detached: process.platform !== 'win32',
		})

		const closing = waitForClose(collector, 1_000)
		await stopChild(collector, 5_000, 5_000)
		const closed = await closing
		expect(closed).toBe(true)
	})

	// The terminal-moment fence, whose point is that every surface reports one moment, so each is
	// read back. The child ends itself, which is the path a reader meets first and the one where
	// `stopping` stays false.
	it('reports one terminal moment across every surface of the terminal-moment fence', async () => {
		const child = createProcess({
			command: { file: 'node', arguments: ['-e', 'console.error("done")'] },
			workspace: process.cwd(),
			drain: 1_000,
		})

		const exit = await child.exit
		expect(exit.drained).toBe(true)
		expect(child.settled).toBe(true)
		expect(child.stopping).toBe(false)
		expect(child.evidence).toBe('done\n')
		await child.destroy()
	})

	// The byte-session fence, whose point is that the exact bytes come back and that `end` is not a
	// termination. Each is read back: the echo against the payload with no terminator added, and
	// `stopping` against the child ending itself because its input ended.
	it('echoes the byte-session fence back unaltered and ends its child without terminating it', async () => {
		const session = createSession({
			command: { file: 'node', arguments: ['-e', 'process.stdin.pipe(process.stdout)'] },
			workspace: process.cwd(),
		})

		const received: Uint8Array[] = []
		session.emitter.on('stdout', (chunk) => received.push(chunk))

		expect(await session.write(new TextEncoder().encode('ping'))).toBe(true)
		await session.end()
		await session.ending

		expect(Buffer.concat(received).toString('utf8')).toBe('ping')
		const exit = await session.exit
		expect(exit.code).toBe(0)
		expect(session.stopping).toBe(false)
		await session.destroy()
	})

	// The Vocabulary ruling that the two endings are named apart because a transport acts on each
	// differently, and the Practices bullet telling a caller to race `ending` rather than `exit`. The
	// sentence is only worth asserting if the two really separate, so the case that separates them is
	// driven here: a child that ends itself while a descendant it spawned keeps the inherited read
	// ends open.
	it('settles the ending a shutdown window should race before the exit that waits out drain', async () => {
		const guide = requireValue(
			files['guides/process.md'],
			'Missing file: guides/process.md',
		).replace(/\s+/gu, ' ')
		expect(guide).toContain('Race a cooperative shutdown window against `ending`')

		const received: Uint8Array[] = []
		const session = createSession({
			command: {
				file: process.execPath,
				arguments: [
					'-e',
					"const c = require('node:child_process').spawn(process.argv[0], ['-e', 'setInterval(() => undefined, 1000)'], { stdio: ['ignore', 1, 2], detached: process.platform === 'win32' }); c.unref(); process.stdout.write('held:' + String(c.pid) + '\\n'); setTimeout(() => process.exit(0), 50)",
				],
			},
			workspace: process.cwd(),
			drain: 400,
			grace: 20,
			on: {
				stdout: (chunk) => received.push(chunk),
			},
		})
		await waitForCondition(
			'the root announces the descendant holding its read ends',
			() => Buffer.concat(received).toString('utf8').includes('\n'),
			{ budget: 5_000 },
		)
		const held = Number.parseInt(
			(Buffer.concat(received).toString('utf8').split('\n')[0] ?? '').replace('held:', ''),
			10,
		)

		try {
			await session.ending
			const pending = await Promise.race([
				session.exit.then(() => 'settled'),
				waitForDelay(150).then(() => 'pending'),
			])

			expect(session.code).toBe(0)
			expect(pending).toBe('pending')
			expect((await session.exit).drained).toBe(false)
		} finally {
			holds(() => process.kill(held, 'SIGKILL'))
			await session.destroy()
		}
	})

	it('drives the termination-helper fence through the host sequence', async () => {
		const reporter = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 50)'], {
			detached: process.platform !== 'win32',
			stdio: 'ignore',
		})

		if (!isExited(reporter)) {
			killProcess(reporter, 'SIGTERM')
			await waitForExit(reporter, 1_000)
		}
		if (!isExited(reporter) && process.platform === 'win32') {
			await killTree(reporter.pid ?? 0, 5_000)
		}
		if (!isExited(reporter)) {
			killProcess(reporter, 'SIGKILL')
			await waitForExit(reporter, 5_000)
		}
		expect(isExited(reporter)).toBe(true)
	})

	it('sends one line to an open channel and confirms the stop', async () => {
		const echo = createProcess({
			command: {
				file: 'node',
				arguments: ['-e', 'process.stdin.on("data", (chunk) => process.stdout.write(chunk))'],
			},
			workspace: process.cwd(),
			writable: true,
		})

		expect(await echo.send('ping')).toBe(true)
		expect(await echo.stop()).toBe(true)
		await echo.destroy()
	})

	it('resolves the command-resolution fence', () => {
		expect(snapshotCommand({ file: 'git', arguments: ['status'] })).toEqual({
			file: 'git',
			arguments: ['status'],
		})
		expect(formatCommand({ file: 'git', arguments: ['status'] })).toBe('git status')
		expect(quoteArgument('status')).toBe('status')
		expect(quoteArgument('a&b')).toBe('"a&b"')
		expect(quoteArgument('%1')).toBe('"%1"')
		expect(buildSpawn({ file: 'node', arguments: ['--version'] }).verbatim).toBe(false)
	})

	it('binds the command and supervision host qualifications', () => {
		const guide = requireValue(
			files['guides/process.md'],
			'Missing file: guides/process.md',
		).replace(/\s+/gu, ' ')
		const types = requireValue(files['src/core/types.ts'], 'Missing file: src/core/types.ts')
			.replaceAll('*', '')
			.replace(/\s+/gu, ' ')

		expect(guide).toContain(
			'`quoteArgument` includes `%` in the quoted set, so `quoteArgument(\'%1\')` returns `"%1"`.',
		)
		expect(types).toContain(
			'On a POSIX host, `isolated: true` leaves no `PATH`, so pass an absolute `file` or include `PATH` in `environment`.',
		)
		expect(types).toContain(
			'On Windows, libuv injects a host environment set even when `isolated` is `true`.',
		)
		expect(guide).toContain(
			'POSIX detachment creates the process group that tree termination signals.',
		)
		expect(guide).toContain(
			"The child therefore survives the supervisor's `SIGKILL` and does not receive the terminal's `SIGINT`.",
		)
		expect(guide).toContain('Call `stop` or `destroy` during an orderly shutdown.')
		expect(types).toContain('A consumer must call `stop` or `destroy` during an orderly shutdown.')
	})

	// The contracts the guide states about what a consumer meets. Each row binds the sentence
	// and then drives the behaviour it claims, because a sentence about behaviour passes every
	// parity assertion whether or not it is true.
	it('reads each command property once, so the object validated is the object spawned', () => {
		const guide = requireValue(
			files['guides/process.md'],
			'Missing file: guides/process.md',
		).replace(/\s+/gu, ' ')
		expect(guide).toContain('The object validated is the object spawned')

		const reads: string[] = []
		const snapshot = snapshotCommand({
			get file() {
				reads.push('file')
				return reads.length === 1 ? process.execPath : 'orkestrel-never-spawned'
			},
			arguments: ['--version'],
		})

		expect(reads.length).toBe(1)
		expect(snapshot.file).toBe(process.execPath)
		expect(executeSync(snapshot, { strict: false }).failed).toBe(false)
	})

	// The recorded order settles each claim the sentence carries: the refusal reaches the caller
	// before the barrier resolves, and the barrier waits for the refused child's terminal moment.
	// The refused child is returned to nobody, so its own `exit` listener is the only thing that can
	// report that moment, and a barrier that skipped the teardown resolves ahead of it.
	it('states and proves the protocol refusal precedes the destroy barrier', async () => {
		const guide = requireValue(
			files['guides/process.md'],
			'Missing file: guides/process.md',
		).replace(/\s+/gu, ' ')
		expect(guide).toContain(
			'The `protocol` refusal throws synchronously, and the `destroy` barrier covers that child',
		)

		const manager = createProcessManager()
		const order: string[] = []
		let ending: Promise<void> | undefined
		let thrown: unknown
		try {
			manager.launch('racer', {
				command: { file: process.execPath, arguments: ['-e', ''] },
				workspace: process.cwd(),
				on: { exit: () => order.push('terminal') },
				get grace() {
					ending = manager.destroy()
					void ending.then(() => order.push('barrier'))
					return 20
				},
			})
		} catch (error) {
			thrown = error
			order.push('refusal')
		}
		if (ending === undefined) throw new Error('The getter did not start destruction')
		await ending

		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('protocol')
		expect(order).toEqual(['refusal', 'terminal', 'barrier'])
	})

	it('releases the abort listener destroy registered and the exit listener waitForExit registered', async () => {
		const guide = requireValue(
			files['guides/process.md'],
			'Missing file: guides/process.md',
		).replace(/\s+/gu, ' ')
		expect(guide).toContain('`destroy` removes the abort listener it registered')
		expect(guide).toContain('`waitForExit` releases its own `exit` listener')

		const controller = new AbortController()
		const child = createProcess({
			command: { file: process.execPath, arguments: ['-e', 'setInterval(() => undefined, 50)'] },
			workspace: process.cwd(),
			grace: 20,
			signal: controller.signal,
		})
		try {
			expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
			await child.destroy()

			const listeners: Array<() => void> = []
			await waitForExit(
				{
					exitCode: null,
					signalCode: null,
					once: (_event, listener) => listeners.push(listener),
					off: (_event, listener) => listeners.splice(listeners.indexOf(listener), 1),
				},
				20,
			)

			expect(listeners).toEqual([])
			expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
		} finally {
			await child.destroy()
		}
	})

	it('recognizes a branded error by brand and refuses an unbranded one', () => {
		const guide = requireValue(
			files['guides/process.md'],
			'Missing file: guides/process.md',
		).replace(/\s+/gu, ' ')
		expect(guide).toContain('Recognition holds across copies at 0.0.4 or later')

		const branded = createInvalidError("option 'grace'", -1)
		// What a copy earlier than 0.0.4 throws: the same shape, the same name, the same declared
		// code, and no brand. The guide's boundary is exactly this value returning false.
		const unbranded = Object.assign(new Error('Invalid option'), {
			name: 'ProcessError',
			code: 'invalid',
		})

		expect(Object.getPrototypeOf(branded)).not.toBe(Error.prototype)
		expect(isProcessError(branded)).toBe(true)
		expect(isProcessError(unbranded)).toBe(false)
	})

	it('records the spawn-fault code difference', () => {
		const guide = requireValue(
			files['guides/process.md'],
			'Missing file: guides/process.md',
		).replace(/\s+/gu, ' ')
		const types = requireValue(files['src/core/types.ts'], 'Missing file: src/core/types.ts')
			.replaceAll('*', '')
			.replace(/\s+/gu, ' ')
		expect(guide).toContain(
			"A spawn fault reports the host's negative errno in `ProcessExit.code` and an asynchronous `ExecuteResult.code`.",
		)
		expect(guide).toContain('The synchronous `executeSync` result reports `null` instead.')
		expect(types).toContain(
			"A spawn fault reports the host's negative errno for `Process` and `execute`.",
		)
		expect(types).toContain('A spawn fault reports `null` for `executeSync`.')
	})

	it('states the supported TypeScript module-resolution floor', () => {
		const readme = requireValue(files['README.md'], 'Missing file: README.md')
		expect(readme).toContain(
			'TypeScript `moduleResolution` set to `node16`, `nodenext`, or `bundler`',
		)
	})

	it('merges the environment fence in its isolated and merged forms', () => {
		expect(mergeEnvironment(true, { TOKEN: 'a' })).toEqual({ TOKEN: 'a' })
		expect(mergeEnvironment(false, { TOKEN: 'a' }, { TOKEN: undefined }).TOKEN).toBeUndefined()
	})

	// The host-varying half of the `isolated` claim is read from the host running the suite. An
	// absolute executable keeps command lookup out of the claim, while libuv can still inject its
	// own set into an explicit Windows environment.
	it('reads the isolated environment fence back from the child', () => {
		const printer = 'process.stdout.write(Object.keys(process.env).sort().join(","))'
		const keys = executeSync({
			file: process.execPath,
			arguments: ['-e', printer],
			environment: { TOKEN: 'a' },
			isolated: true,
		}).stdout.split(',')

		expect(keys.includes('TOKEN')).toBe(true)
		expect(keys.includes('SYSTEMROOT')).toBe(process.platform === 'win32')
	})

	// The absence of `PATH` is the half a consumer acts on: it is why an isolated command needs an
	// absolute `file`. Windows is excluded because libuv injects its own set into an explicit
	// environment there, so what that host leaves behind is a separate claim this one cannot settle.
	it.skipIf(process.platform === 'win32')('leaves an isolated POSIX child no PATH', () => {
		const printer = 'process.stdout.write(Object.keys(process.env).sort().join(","))'
		const keys = executeSync({
			file: process.execPath,
			arguments: ['-e', printer],
			environment: { TOKEN: 'a' },
			isolated: true,
		}).stdout.split(',')

		expect(keys.includes('TOKEN')).toBe(true)
		expect(keys.includes('PATH')).toBe(false)
	})

	it('settles the execution fence in both its rejecting and inspecting forms', async () => {
		const version = await execute({ file: 'node', arguments: ['--version'] })
		expect(version.failed).toBe(false)
		expect(version.stdout.startsWith('v')).toBe(true)

		const outcome = await execute(
			{ file: 'node', arguments: ['-e', 'process.exit(3)'] },
			{ strict: false },
		)
		expect(outcome.failed).toBe(true)
		expect(outcome.code).toBe(3)
	})

	it('passes the standard-input payload fence with NUL intact', () => {
		const input = `left${String.fromCodePoint(0)}right`
		const result = executeSync(
			{ file: process.execPath, arguments: ['-e', 'process.stdin.pipe(process.stdout)'] },
			{ input },
		)

		expect(result.stdout).toBe(input)
	})

	it('splits the output-bound fence exactly where the guide says `execute` and `executeSync` differ', async () => {
		const script = 'process.stdout.write("x".repeat(4096))'

		const streamed = await execute(
			{ file: 'node', arguments: ['-e', script] },
			{ limit: 16, strict: false },
		)
		expect(streamed.truncated).toBe(true)
		expect(streamed.failed).toBe(false)

		const blocking = executeSync(
			{ file: 'node', arguments: ['-e', script] },
			{ limit: 16, strict: false },
		)
		expect(blocking.truncated).toBe(true)
		expect(blocking.failed).toBe(true)
		expect(blocking.signal).toBe('SIGKILL')
	})

	it('evicts the registry fence child one microtask after its own exit event', async () => {
		const manager = createProcessManager()
		const child = manager.launch('probe', {
			command: { file: 'node', arguments: ['--version'] },
			workspace: process.cwd(),
		})
		expect(manager.count).toBe(1)
		expect(manager.process('probe')).toBe(child)
		expect(manager.processes().length).toBe(1)

		// The guide's ordering claim: the child's own listener still sees it registered, and the
		// manager's listener sees it gone.
		const seen: number[] = []
		child.emitter.on('exit', () => seen.push(manager.count))
		manager.emitter.on('exit', () => seen.push(manager.count))

		await child.exit
		expect(manager.count).toBe(0)
		expect(seen).toEqual([1, 0])

		await manager.destroy()
		expect(manager.count).toBe(0)
	})

	it('codes each error factory the fence names', () => {
		expect(createDuplicateError('build').code).toBe('duplicate')
		expect(createProtocolError('build').code).toBe('protocol')
		expect(createInvalidError("option 'grace'", -1).code).toBe('invalid')
		expect(createInvalidError("option 'grace'", -1).context?.value).toBe(-1)
	})

	it('refuses the validation fence input before it spawns anything', () => {
		let thrown: unknown
		try {
			executeSync({ file: 'node', arguments: ['--version'] }, { timeout: -1 })
		} catch (error) {
			thrown = error
		}
		if (!isProcessError(thrown)) throw new Error('executeSync accepted a negative timeout')
		expect(thrown.code).toBe('invalid')
		expect(thrown.context?.value).toBe(-1)
	})

	it('builds and wraps the run result the errors fence assembles', () => {
		const result = buildExecuteResult({
			command: 'node -e process.exit(1)',
			stdout: new TextEncoder().encode('ok'),
			stderr: new Uint8Array(0),
			code: 1,
			signal: null,
			expired: false,
			aborted: false,
			truncated: false,
			limit: 1_024,
		})

		expect(result.failed).toBe(true)
		expect(createExecuteError(result).code).toBe('spawn')
		expect(createExecuteError(result).result).toBe(result)
	})
})

// ── Unfenced TSDoc example transcriptions ────────────────────────────────────
//
// Exports that appear in no `guides/process.md` fence use their TSDoc
// `@example` block in place of one. A block satisfies that gate by existing, which leaves the value
// its comment claims unasserted. Each row below runs one such block against the real barrel and
// asserts that value, so a changed return value fails this gate. Change an `@example`, change its row.
const EXAMPLES = Object.freeze([
	{
		name: 'buildPlatformSpawn',
		value: buildPlatformSpawn({ file: 'node', arguments: ['--version'] }, 'node', {}, 'linux')
			.verbatim,
		claim: false,
	},
	{
		name: 'buildExecutableCandidates',
		value: buildExecutableCandidates('git', 'C:\\work', { PATH: 'C:\\bin' }, 'win32'),
		claim: [
			'C:\\work\\git',
			'C:\\work\\git.COM',
			'C:\\work\\git.EXE',
			'C:\\work\\git.BAT',
			'C:\\work\\git.CMD',
			'C:\\bin\\git',
			'C:\\bin\\git.COM',
			'C:\\bin\\git.EXE',
			'C:\\bin\\git.BAT',
			'C:\\bin\\git.CMD',
		],
	},
	{ name: 'captureChunk', value: captureChunk(Buffer.from('hello'), 3), claim: Buffer.from('hel') },
	{ name: 'isFile', value: isFile(process.execPath), claim: true },
	{
		name: 'mergePlatformEnvironment',
		value: mergePlatformEnvironment('linux', {}, false, { TOKEN: 'a' }, { TOKEN: undefined }),
		claim: {},
	},
	{
		name: 'readPlatformVariable',
		value: readPlatformVariable({ Path: 'C:\\Windows' }, 'PATH', 'win32'),
		claim: 'C:\\Windows',
	},
	{ name: 'readVariable', value: readVariable({ PATH: '/usr/bin' }, 'PATH'), claim: '/usr/bin' },
	{ name: 'trimHead', value: trimHead(Buffer.from('hello'), 3), claim: Buffer.from('hel') },
	{ name: 'trimTail', value: trimTail(Buffer.from('hello'), 3), claim: Buffer.from('llo') },
	{ name: 'validateBytes', value: validateBytes(1_024, "option 'limit'", 0), claim: undefined },
	{
		name: 'validateCommand',
		value: validateCommand({ file: 'git', arguments: ['status'] }),
		claim: undefined,
	},
	{ name: 'validateEnvironment', value: validateEnvironment({ TOKEN: 'a' }), claim: undefined },
	{
		name: 'validateText',
		value: validateText('status', 'command argument', false),
		claim: undefined,
	},
	{ name: 'validateTimer', value: validateTimer(5_000, "option 'grace'"), claim: undefined },
	{ name: 'validateWorkspace', value: validateWorkspace(process.cwd()), claim: undefined },
])

describe('unfenced TSDoc examples', () => {
	for (const row of EXAMPLES) {
		it(`returns what ${row.name}'s example claims`, () => {
			expect(row.value).toStrictEqual(row.claim)
		})
	}

	// The example claims one value per host, so each host's claim is its own case. Off Windows
	// `buildExecutableCandidates` returns an empty list, because command lookup belongs to the host's
	// own spawn there, so the helper reports nothing and the caller keeps the bare name.
	it.skipIf(process.platform === 'win32')(
		'keeps the bare name its example claims off Windows',
		() => {
			expect(resolveExecutable('git', {}) ?? 'git').toBe('git')
		},
	)

	it.skipIf(process.platform !== 'win32')(
		'resolves the absolute path its example claims on Windows',
		() => {
			expect(isAbsolute(resolveExecutable('git', {}) ?? 'git')).toBe(true)
		},
	)
})

// ── README parity ────────────────────────────────────────────────────────────
//
// `README.md` ships inside the published package, so it carries the assertions the guide
// carries: every backticked name resolves, and every relative link exists.

/**
 * Backticked `README.md` tokens that name a TypeScript setting, the package line, or a file rather
 * than a package export.
 *
 * Naming one here is what makes it deliberate, and the assertion over this list fails when a name
 * here becomes an export, so the list cannot rot.
 */
const README_FOREIGN: readonly string[] = Object.freeze([
	'@orkestrel',
	'bundler',
	'exports',
	'guides/process.md',
	'moduleResolution',
	'node16',
	'nodenext',
	'package.json',
])

describe('README', () => {
	const readme = requireValue(files['README.md'], 'Missing file: README.md')
	const guide = requireValue(files['guides/process.md'], 'Missing file: guides/process.md')
	const published = FACES.flatMap((face) =>
		requireValue(SOURCES.get(face.specifier), `Unmapped specifier: ${face.specifier}`)
			.surface()
			.map((symbol) => symbol.name),
	)
	const documented = new Set(
		Array.from(
			guide.replace(/```[\s\S]*?```/gu, '').matchAll(/`([^`\n]+)`/gu),
			(match) => match[1] ?? '',
		),
	)
	const tokens = Array.from(
		new Set(
			Array.from(
				readme.replace(/```[\s\S]*?```/gu, '').matchAll(/`([^`\n]+)`/gu),
				(match) => match[1] ?? '',
			),
		),
	)

	it('backticks only published exports, documented guide names, and listed foreign tokens', () => {
		expect(tokens.length).toBeGreaterThan(0)
		expect(tokens.filter((token) => published.includes(token)).length).toBeGreaterThan(0)
		expect(
			tokens.filter(
				(token) =>
					!published.includes(token) && !documented.has(token) && !README_FOREIGN.includes(token),
			),
		).toEqual([])
	})

	it('names no foreign token that the package publishes', () => {
		expect(README_FOREIGN.filter((token) => published.includes(token))).toEqual([])
	})

	it('resolves every relative link', () => {
		const links = createGuide(readme)
			.links()
			.filter((href) => !isExternalLink(href))
		expect(links.length).toBeGreaterThan(0)
		expect(
			links
				.map((href) => resolveLink('README.md', href))
				.filter((path) => !existsSync(new URL(path, root))),
		).toEqual([])
	})
})
