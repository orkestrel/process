import { spawnSync } from 'node:child_process'
import {
	cpSync,
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// Windows resolves the npm launcher only as `npm.cmd`: a bare `npm` reaches `spawnSync`
// without shell resolution and fails `ENOENT`, so the binary is named per platform.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// Windows needs a shell to launch that `.cmd`: Node refuses one directly since the
// batch-argument hardening and returns `EINVAL` with a null status rather than an exit
// code. Every npm call here takes it. Each argument is a literal or a path this file
// built, so the shell has nothing to escape.
const shell = process.platform === 'win32'
import * as ts from 'typescript'

// The `prepublishOnly` gate runs `build` before `test:distribution`, so suppressing `prepack` here
// packs that built artifact; a standalone run reads the artifact already on disk.
// The consumer this proof builds is the only subject that answers for the published artifact. A
// specifier resolved from this repository reaches the repository's own manifest, or the copy of an
// earlier release installed under `node_modules`, so every assertion below is rooted in the
// temporary consumer instead.
it('installs the packed artifact and drives its entries, declarations, and resolution modes', () => {
	expect(import.meta.env.MODE).toBe('release')
	const root = fileURLToPath(new URL('../', import.meta.url))
	const scratch = mkdtempSync(join(tmpdir(), 'orkestrel-process-distribution-'))

	try {
		const pack = spawnSync(
			npm,
			['pack', '--json', '--ignore-scripts', '--pack-destination', scratch],
			{
				cwd: root,
				encoding: 'utf8',
				windowsHide: true,
				shell,
			},
		)
		if (pack.error !== undefined || pack.status !== 0) {
			throw new Error(`npm pack failed: ${pack.error?.message ?? pack.stderr}`)
		}
		// The artifact is read from the directory rather than from `--json`, whose shape npm has
		// moved: a record keyed by package name today, an array before it. This scratch directory
		// is the file's own and holds exactly what this pack wrote.
		const archives = globSync('*.tgz', { cwd: scratch })
		if (archives.length !== 1) throw new Error('npm pack wrote no single artifact')
		const [filename] = archives
		if (filename === undefined) throw new Error('npm pack wrote no artifact filename')
		const tarball = join(scratch, filename)

		const consumer = join(scratch, 'consumer')
		mkdirSync(consumer)
		writeFileSync(
			join(consumer, 'package.json'),
			JSON.stringify({ name: 'process-distribution-consumer', private: true, type: 'module' }),
		)
		const install = spawnSync(
			npm,
			['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
			{ cwd: consumer, encoding: 'utf8', windowsHide: true, shell },
		)
		const packageRoot = join(consumer, 'node_modules', '@orkestrel', 'process')
		if (install.status !== 0 || install.error !== undefined) {
			const code =
				install.error === undefined
					? undefined
					: Object.getOwnPropertyDescriptor(install.error, 'code')?.value
			const denied = code === 'EPERM' || install.stderr.includes('EPERM')
			// `--mode release` is how the publish gate runs this file. An install that never happened
			// is a failure there rather than a fallback: extracting the tarball proves that it unpacks
			// and says nothing about whether a consumer can install it. An ordinary local run inside a
			// sandbox that denies a nested install still falls back.
			if (!denied || import.meta.env.MODE === 'release') {
				throw new Error(`npm install failed: ${install.error?.message ?? install.stderr}`)
			}
			const extraction = join(scratch, 'extraction')
			mkdirSync(extraction)
			const unpack = spawnSync('tar', ['-xzf', tarball, '-C', extraction], {
				encoding: 'utf8',
			})
			if (unpack.error !== undefined || unpack.status !== 0) {
				throw new Error(`tar extraction failed: ${unpack.error?.message ?? unpack.stderr}`)
			}
			mkdirSync(dirname(packageRoot), { recursive: true })
			cpSync(join(extraction, 'package'), packageRoot, { recursive: true })
		}

		const require = createRequire(import.meta.url)
		for (const dependency of ['@orkestrel/contract', '@orkestrel/emitter']) {
			const source = dirname(require.resolve(`${dependency}/package.json`))
			const target = join(consumer, 'node_modules', ...dependency.split('/'))
			if (!existsSync(target)) {
				mkdirSync(dirname(target), { recursive: true })
				cpSync(source, target, { recursive: true })
			}
		}
		const consumerRequire = createRequire(join(consumer, 'control.cjs'))
		expect(() => consumerRequire.resolve('@orkestrel/process/absent')).toThrow(/Package subpath/u)

		const manifest: unknown = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
		if (typeof manifest !== 'object' || manifest === null) {
			throw new Error('The packed manifest is not a record')
		}
		const exportsValue = Object.getOwnPropertyDescriptor(manifest, 'exports')?.value
		if (typeof exportsValue !== 'object' || exportsValue === null) {
			throw new Error('The packed manifest carries no exports')
		}
		const targets: unknown[] = [exportsValue]
		const missingTargets: string[] = []
		let targetCount = 0
		while (targets.length > 0) {
			const target = targets.pop()
			if (typeof target === 'string') {
				if (target.startsWith('./')) {
					if (!existsSync(join(packageRoot, target.slice(2)))) missingTargets.push(target)
					targetCount += 1
				}
				continue
			}
			if (typeof target === 'object' && target !== null) {
				targets.push(...Object.values(target))
			}
		}
		expect(missingTargets).toEqual([])
		expect(targetCount).toBeGreaterThan(0)

		const declarations = [
			{ entry: 'core', path: 'dist/src/core/index.d.ts', count: 15 },
			{ entry: 'server', path: 'dist/src/server/index.d.ts', count: 35 },
		]
		const declared = new Map<string, readonly string[]>()
		for (const declaration of declarations) {
			const path = join(packageRoot, declaration.path)
			const source = ts.createSourceFile(
				path,
				readFileSync(path, 'utf8'),
				ts.ScriptTarget.Latest,
				true,
			)
			const names: string[] = []
			for (const statement of source.statements) {
				if (
					(ts.isFunctionDeclaration(statement) ||
						ts.isClassDeclaration(statement) ||
						ts.isEnumDeclaration(statement)) &&
					statement.name !== undefined
				) {
					names.push(statement.name.text)
				}
				if (ts.isVariableStatement(statement)) {
					for (const value of statement.declarationList.declarations) {
						if (ts.isIdentifier(value.name)) names.push(value.name.text)
					}
				}
			}
			names.sort()
			expect(names).toHaveLength(declaration.count)
			declared.set(declaration.entry, names)
		}

		writeFileSync(
			join(consumer, 'import.mjs'),
			[
				"import * as core from '@orkestrel/process'",
				"import * as server from '@orkestrel/process/server'",
				"console.log(JSON.stringify({core:Object.keys(core).sort(),server:Object.keys(server).sort(),coreCall:core.isProcessError(new Error('plain')),serverCall:server.formatCommand({file:'node',arguments:['--version']})}))",
			].join('\n'),
		)
		writeFileSync(
			join(consumer, 'require.cjs'),
			[
				"const core = require('@orkestrel/process')",
				"const server = require('@orkestrel/process/server')",
				"console.log(JSON.stringify({core:Object.keys(core).sort(),server:Object.keys(server).sort(),coreCall:core.isProcessError(new Error('plain')),serverCall:server.formatCommand({file:'node',arguments:['--version']})}))",
			].join('\n'),
		)

		for (const entry of ['import.mjs', 'require.cjs']) {
			const loaded = spawnSync(process.execPath, [join(consumer, entry)], {
				cwd: consumer,
				encoding: 'utf8',
			})
			if (loaded.error !== undefined || loaded.status !== 0) {
				throw new Error(`${entry} failed: ${loaded.error?.message ?? loaded.stderr}`)
			}
			const result: unknown = JSON.parse(loaded.stdout)
			if (typeof result !== 'object' || result === null) {
				throw new Error(`${entry} returned no result record`)
			}
			const core = Object.getOwnPropertyDescriptor(result, 'core')?.value
			const server = Object.getOwnPropertyDescriptor(result, 'server')?.value
			const coreCall = Object.getOwnPropertyDescriptor(result, 'coreCall')?.value
			const serverCall = Object.getOwnPropertyDescriptor(result, 'serverCall')?.value
			if (!Array.isArray(core) || !core.every((name) => typeof name === 'string')) {
				throw new Error(`${entry} returned an invalid core export set`)
			}
			if (!Array.isArray(server) || !server.every((name) => typeof name === 'string')) {
				throw new Error(`${entry} returned an invalid server export set`)
			}
			expect(core).toEqual(declared.get('core'))
			expect(server).toEqual(declared.get('server'))
			expect(core).toHaveLength(15)
			expect(server).toHaveLength(35)
			expect(coreCall).toBe(false)
			expect(serverCall).toBe('node --version')
		}

		// The guard recognizes an error the other module format constructed. Each copy is the
		// installed package's own, so this reads the shipped brand rather than the source's.
		writeFileSync(
			join(consumer, 'brand.mjs'),
			[
				"import { createRequire } from 'node:module'",
				"import { isProcessError } from '@orkestrel/process'",
				'const require = createRequire(import.meta.url)',
				"const commonJS = require('@orkestrel/process')",
				"const branded = new commonJS.ProcessError('invalid command', { code: 'invalid' })",
				'console.log(JSON.stringify({recognized:isProcessError(branded),plain:isProcessError(new Error("invalid command"))}))',
			].join('\n'),
		)
		const branded = spawnSync(process.execPath, [join(consumer, 'brand.mjs')], {
			cwd: consumer,
			encoding: 'utf8',
		})
		if (branded.error !== undefined || branded.status !== 0) {
			throw new Error(`brand.mjs failed: ${branded.error?.message ?? branded.stderr}`)
		}
		const brand: unknown = JSON.parse(branded.stdout)
		if (typeof brand !== 'object' || brand === null) {
			throw new Error('brand.mjs returned no result record')
		}
		expect(Object.getOwnPropertyDescriptor(brand, 'recognized')?.value).toBe(true)
		expect(Object.getOwnPropertyDescriptor(brand, 'plain')?.value).toBe(false)

		// The `moduleResolution` floor `README.md` states, compiled rather than asserted as a sentence.
		// Each mode builds a program over one consumer file importing each face, with library checking
		// on so the package's own declarations are read instead of skipped.
		const consumerSource = join(consumer, 'consumer.ts')
		writeFileSync(
			consumerSource,
			[
				"import { isProcessError, type ProcessExit } from '@orkestrel/process'",
				"import { formatCommand } from '@orkestrel/process/server'",
				"export const recognized: boolean = isProcessError(new Error('plain'))",
				"export const line: string = formatCommand({ file: 'node', arguments: ['--version'] })",
				'export const settled: ProcessExit = { code: 0, signal: null, drained: true }',
			].join('\n'),
		)
		const modes = [
			{
				name: 'node16',
				module: ts.ModuleKind.Node16,
				resolution: ts.ModuleResolutionKind.Node16,
				supported: true,
			},
			{
				name: 'nodenext',
				module: ts.ModuleKind.NodeNext,
				resolution: ts.ModuleResolutionKind.NodeNext,
				supported: true,
			},
			{
				name: 'bundler',
				module: ts.ModuleKind.Preserve,
				resolution: ts.ModuleResolutionKind.Bundler,
				supported: true,
			},
			// The firing control is the one named mode the requirement excludes: the published manifest
			// carries no `typesVersions`, so `/server` resolves no declarations under classic Node
			// resolution and the same consumer source stops compiling.
			{
				name: 'node10',
				module: ts.ModuleKind.CommonJS,
				resolution: ts.ModuleResolutionKind.Node10,
				supported: false,
			},
		]
		const diagnosed: string[] = []
		const compiled: string[] = []
		for (const mode of modes) {
			const program = ts.createProgram([consumerSource], {
				module: mode.module,
				moduleResolution: mode.resolution,
				target: ts.ScriptTarget.ESNext,
				strict: true,
				skipLibCheck: false,
				noEmit: true,
				types: ['node'],
				typeRoots: [join(root, 'node_modules', '@types')],
			})
			const diagnostics = program
				.getSemanticDiagnostics()
				.concat(program.getSyntacticDiagnostics(), program.getOptionsDiagnostics())
			if (diagnostics.length > 0) {
				diagnosed.push(
					`${mode.name}: ${diagnostics
						.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
						.join(' | ')}`,
				)
				continue
			}
			compiled.push(mode.name)
		}
		expect(compiled).toEqual(modes.filter((mode) => mode.supported).map((mode) => mode.name))
		expect(diagnosed).toHaveLength(modes.filter((mode) => !mode.supported).length)
	} finally {
		rmSync(scratch, { recursive: true, force: true })
	}
})
