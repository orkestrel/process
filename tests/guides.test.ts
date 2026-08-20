// The guides-parity gate: @orkestrel/guide's checks run against this repository's own
// `guides/README.md` manifest, and every flagship fence in `guides/process.md` is transcribed
// here and asserted against what its comments claim. Name resolution is not a behavioural
// proof, so a fence documenting a value the code contradicts is exactly what the transcriptions
// catch. Change a fence, change its transcription.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
	createGuide,
	createSource,
	createSourceManager,
	extractSourceLines,
	fenceImports,
	findMissing,
	findUnexampled,
	findUnlisted,
	isExternalLink,
	missingSymbols,
	parseManifest,
	resolveLink,
	symbolKey,
} from '@orkestrel/guide'
import { requireValue } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'
import {
	createDuplicateError,
	createInvalidError,
	createProtocolError,
	createRunError,
	isProcessError,
	PROCESS_BACKLOG,
	PROCESS_CONFIRMATION,
	PROCESS_EVIDENCE,
	PROCESS_GRACE,
	PROCESS_OUTPUT,
	PROCESS_PATHEXT,
	PROCESS_TIMER,
} from '@src/core'
import {
	buildRunResult,
	buildSpawn,
	createProcess,
	createProcessManager,
	formatCommand,
	mergeEnvironment,
	quoteArgument,
	run,
	runSync,
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
 * Declarations deliberately kept out of a barrel, as `symbolKey` strings.
 *
 * Naming one here is what makes it intentional rather than forgotten, and the second assertion
 * over this list fails when a name here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([])
/** Root-level files this package's guides link to. `readInventory` walks directories only. */
const ROOT_FILES = Object.freeze(['AGENTS.md'])

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

// The two published faces in one table. `SOURCES`, the refusal rows, and the live population rows
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
	// One refusal row per face, bound against its neighbour. The control is every name the
	// neighbour publishes and this face does not, read off the neighbour's live Source: a literal
	// covers one ordered pair and goes stale silently, while the derived difference cannot.
	// Asserting that difference non-empty is the precondition the refusal needs to mean anything,
	// and it is what a widened `module` breaks — a face that swallows its neighbour's module leaves
	// that neighbour nothing of its own to refuse.
	for (const face of FACES) {
		const own = createSource({ files, module: face.module })
			.surface()
			.map((symbol) => symbol.name)
		const neighbours = FACES.filter((other) => other !== face).map((other) =>
			Array.from(
				new Set(
					createSource({ files, module: other.module })
						.surface()
						.map((symbol) => symbol.name),
				),
			).filter((name) => !own.includes(name)),
		)

		it(`publishes none of a neighbouring face's names on ${face.specifier}`, () => {
			const source = requireValue(SOURCES.get(face.specifier), 'Unmapped specifier')
			const published = source.surface().map((symbol) => symbol.name)
			for (const foreign of neighbours) {
				expect(foreign.length).toBeGreaterThan(0)
				expect(foreign.filter((name) => published.includes(name))).toEqual([])
			}
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

// Two faces declaring the same class, where only the core barrel re-exports it: the server face
// strands `Process`, and reading both faces as one scope hides that. The fixture rows are the
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
		stranded: [],
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
			expect(missingSymbols(source.exports(), source.surface())).toEqual(entry.stranded)
		})
		it('re-exports exactly its expected phantom symbols', () => {
			expect(missingSymbols(source.surface(), source.exports())).toEqual(entry.phantom)
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
			const stranded = missingSymbols(source.exports(), source.surface())
			expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
		})
		it('names no symbol internal that the barrel already exports', () => {
			const stranded = missingSymbols(source.exports(), source.surface())
			expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
		})
		it('re-exports only direct declarations', () => {
			expect(missingSymbols(source.surface(), source.exports())).toEqual([])
		})
		it('documents every barrel export', () => {
			expect(missingSymbols(source.surface(), guide.surface())).toEqual([])
		})
		it('documents only barrel exports', () => {
			expect(missingSymbols(guide.surface(), source.surface())).toEqual([])
		})

		it('exposes no hidden module-scope declarations', () => {
			expect(source.hidden().map(symbolKey)).toEqual([])
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

		// The membership rule is `fenceImports`'s own grammar read off Guide's comment-aware source
		// projection, not "named-brace imports": every statement it surfaces is checked and nothing
		// else is. A mapped specifier's bindings compare against that face's barrel surface; a
		// repository alias and an unmapped true subpath of the root are refused, the first because a
		// public guide example must import through a published specifier; a foreign package stays
		// external and is compared against no face.
		it('imports only real exports through published specifiers in every ts fence', () => {
			const refused: string[] = []
			const missing: string[] = []
			for (const fence of guide.fences().filter((row) => row.language === EXAMPLE_LANGUAGE)) {
				const projected = extractSourceLines(fence.code)
					.map((line) => line.code)
					.join('\n')
				for (const statement of fenceImports(projected)) {
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
	})
}

// ── Flagship fence transcriptions ────────────────────────────────────────────
//
// Each row that follows is one `guides/process.md` fence, run against the real barrels, asserting the
// value its comment claims. A child is spawned through `process.execPath`'s own runtime name so
// the transcription exercises the same no-shell resolver a reader's `node` reaches.

describe('flagship fences', () => {
	it('states the numeric teardown backlog cap on both public contracts', () => {
		const guide = requireValue(files['guides/process.md'], 'Missing file: guides/process.md')
		const types = requireValue(files['src/core/types.ts'], 'Missing file: src/core/types.ts')

		expect(guide).toContain('twice `backlog`')
		expect(types).toContain('twice `backlog`')
	})

	it('states the root-only synchronous timeout boundary in the guide and types', () => {
		const guide = requireValue(files['guides/process.md'], 'Missing file: guides/process.md')
		const types = requireValue(files['src/core/types.ts'], 'Missing file: src/core/types.ts')

		expect(guide).toContain('`runSync` ends only the root process')
		expect(types).toContain('`timeout` ends only the root process')
	})

	it('states that standard-input payload accepts NUL in the guide and types', () => {
		const guide = requireValue(files['guides/process.md'], 'Missing file: guides/process.md')
		const types = requireValue(files['src/core/types.ts'], 'Missing file: src/core/types.ts')

		expect(guide).toContain('standard-input payload and carries no NUL restriction')
		expect(types).toContain('standard-input payload and carries no NUL restriction')
	})

	it('documents the constant values its Surface table prints', () => {
		expect(PROCESS_GRACE).toBe(5_000)
		expect(PROCESS_CONFIRMATION).toBe(5_000)
		expect(PROCESS_EVIDENCE).toBe(2_048)
		expect(PROCESS_BACKLOG).toBe(10_485_760)
		expect(PROCESS_OUTPUT).toBe(10_485_760)
		expect(PROCESS_TIMER).toBe(2_147_483_647)
		expect(PROCESS_PATHEXT).toBe('.COM;.EXE;.BAT;.CMD')
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
		expect(formatCommand({ file: 'git', arguments: ['status'] })).toBe('git status')
		expect(quoteArgument('status')).toBe('status')
		expect(quoteArgument('a&b')).toBe('"a&b"')
		expect(buildSpawn({ file: 'node', arguments: ['--version'] }).verbatim).toBe(false)
	})

	it('merges the environment fence both ways', () => {
		expect(mergeEnvironment(true, { TOKEN: 'a' })).toEqual({ TOKEN: 'a' })
		expect(mergeEnvironment(false, { TOKEN: 'a' }, { TOKEN: undefined }).TOKEN).toBeUndefined()
	})

	// The host-varying half of the `isolated` claim is read from the host running the suite. An
	// absolute executable keeps command lookup out of the claim, while libuv can still inject its
	// own set into an explicit Windows environment.
	it('reads the isolated environment fence back from the child', () => {
		const printer = 'process.stdout.write(Object.keys(process.env).sort().join(","))'
		const keys = runSync({
			file: process.execPath,
			arguments: ['-e', printer],
			environment: { TOKEN: 'a' },
			isolated: true,
		}).stdout.split(',')

		expect(keys.includes('TOKEN')).toBe(true)
		expect(keys.includes('SYSTEMROOT')).toBe(process.platform === 'win32')
	})

	it('settles the run fence in both its rejecting and inspecting forms', async () => {
		const version = await run({ file: 'node', arguments: ['--version'] })
		expect(version.failed).toBe(false)
		expect(version.stdout.startsWith('v')).toBe(true)

		const outcome = await run(
			{ file: 'node', arguments: ['-e', 'process.exit(3)'] },
			{ strict: false },
		)
		expect(outcome.failed).toBe(true)
		expect(outcome.code).toBe(3)
	})

	it('passes the standard-input payload fence with NUL intact', () => {
		const input = `left${String.fromCodePoint(0)}right`
		const result = runSync(
			{ file: process.execPath, arguments: ['-e', 'process.stdin.pipe(process.stdout)'] },
			{ input },
		)

		expect(result.stdout).toBe(input)
	})

	it('splits the output-bound fence exactly where the guide says the runners differ', async () => {
		const script = 'process.stdout.write("x".repeat(4096))'

		const streamed = await run(
			{ file: 'node', arguments: ['-e', script] },
			{ limit: 16, strict: false },
		)
		expect(streamed.truncated).toBe(true)
		expect(streamed.failed).toBe(false)

		const blocking = runSync(
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
			runSync({ file: 'node', arguments: ['--version'] }, { timeout: -1 })
		} catch (error) {
			thrown = error
		}
		if (!isProcessError(thrown)) throw new Error('runSync accepted a negative timeout')
		expect(thrown.code).toBe('invalid')
		expect(thrown.context?.value).toBe(-1)
	})

	it('builds and wraps the run result the errors fence assembles', () => {
		const result = buildRunResult({
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
		expect(createRunError(result).code).toBe('spawn')
		expect(createRunError(result).result).toBe(result)
	})
})
