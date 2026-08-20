import { spawnSync } from 'node:child_process'
import {
	cpSync,
	existsSync,
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
import * as ts from 'typescript'

it('refuses a deliberately absent public export path', () => {
	const require = createRequire(import.meta.url)
	expect(() => require.resolve('@orkestrel/process/absent')).toThrow(/Package subpath/u)
})

it('loads the packed artifact through every public runtime entry', () => {
	const root = fileURLToPath(new URL('../', import.meta.url))
	const scratch = mkdtempSync(join(tmpdir(), 'orkestrel-process-distribution-'))

	try {
		const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', scratch], {
			cwd: root,
			encoding: 'utf8',
		})
		if (pack.error !== undefined || pack.status !== 0) {
			throw new Error(`npm pack failed: ${pack.error?.message ?? pack.stderr}`)
		}
		const packed: unknown = JSON.parse(pack.stdout)
		if (!Array.isArray(packed)) throw new Error('npm pack returned no artifact list')
		const [packedArtifact] = packed
		if (typeof packedArtifact !== 'object' || packedArtifact === null) {
			throw new Error('npm pack returned no artifact record')
		}
		const filename = Object.getOwnPropertyDescriptor(packedArtifact, 'filename')?.value
		if (typeof filename !== 'string') throw new Error('npm pack returned no artifact filename')
		const tarball = join(scratch, filename)

		const consumer = join(scratch, 'consumer')
		mkdirSync(consumer)
		writeFileSync(
			join(consumer, 'package.json'),
			JSON.stringify({ name: 'process-distribution-consumer', private: true, type: 'module' }),
		)
		const install = spawnSync(
			'npm',
			['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
			{ cwd: consumer, encoding: 'utf8' },
		)
		const packageRoot = join(consumer, 'node_modules', '@orkestrel', 'process')
		if (install.status !== 0 || install.error !== undefined) {
			const code =
				install.error === undefined
					? undefined
					: Object.getOwnPropertyDescriptor(install.error, 'code')?.value
			if (code !== 'EPERM' && !install.stderr.includes('EPERM')) {
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
			{ entry: 'core', path: 'dist/src/core/index.d.ts', count: 13 },
			{ entry: 'server', path: 'dist/src/server/index.d.ts', count: 33 },
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
			expect(core).toHaveLength(13)
			expect(server).toHaveLength(33)
			expect(coreCall).toBe(false)
			expect(serverCall).toBe('node --version')
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true })
	}
})
