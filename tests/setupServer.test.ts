import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRecorder } from '@orkestrel/test'
import {
	buildProcessMount,
	buildProcessStat,
	childCommand,
	ExitBoundary,
	resolveChildFixture,
} from './setupServer.js'

// This proof drives the command `childCommand` builds through a real child process, so the
// asserted values come from the fixture's own independent parsing of `process.argv` rather than
// from re-deriving what `childCommand` already computed. `tests/setup.test.ts` covers the
// structural shape of the returned command; this file covers that the shape actually spawns and
// behaves as the workspace's server suites rely on.

describe('ExitBoundary', () => {
	it('retains registered listener identities and removes the requested listener', () => {
		const boundary = new ExitBoundary()
		const first = createRecorder<[]>()
		const second = createRecorder<[]>()
		expect([boundary.exitCode, boundary.signalCode]).toEqual([null, null])
		expect(boundary.listeners).toEqual([])
		boundary.once('exit', first.handler)
		boundary.once('exit', second.handler)
		expect(boundary.listeners).toEqual([first.handler, second.handler])
		boundary.off('exit', first.handler)
		expect(boundary.listeners).toEqual([second.handler])
		boundary.off('exit', second.handler)
		expect(boundary.listeners).toEqual([])
	})
})

describe('childCommand spawned for real', () => {
	it('spawns a real child that exits with the requested code and reports it through stdout and stderr', () => {
		const command = childCommand('exit', '5')
		const result = spawnSync(command.file, [...command.arguments])
		expect(result.status).toBe(5)
		expect(result.stdout.toString()).toBe('ran:5\n')
		expect(result.stderr.toString()).toBe('diagnostic:5\n')
	})

	it('omits the detail argument by default, so the fixture falls back to its own default exit code', () => {
		const command = childCommand('exit')
		const result = spawnSync(command.file, [...command.arguments])
		// The fixture parses a missing third argument as `detail = '0'` on its own, independently of
		// whatever `childCommand` chose to omit.
		expect(result.status).toBe(0)
		expect(result.stdout.toString()).toBe('ran:0\n')
	})

	it('carries the detail argument through to the fixture unmodified, in order', () => {
		const command = childCommand('args', 'left|right')
		const result = spawnSync(command.file, [...command.arguments])
		expect(result.status).toBe(0)
		// The fixture echoes every argument after the mode, so a value with a shell-meaningful
		// character proves the argument vector reached it as one element rather than through a shell
		// that could have split or interpreted it.
		expect(result.stdout.toString()).toBe('args:left|right\n')
	})
})

// proc(5) fixes the layouts: `stat` carries the state, the parent, and the group as the first three
// fields after the last `)` and the start time as field 22; a `mountinfo` line carries its mount point
// fifth and three fields after its `-` separator. The host's own lines are the second mechanism.
describe.skipIf(!existsSync('/proc/self/mountinfo'))('process-table fixture builders', () => {
	it('builds a stat line whose fields sit where the host puts its own', () => {
		const built = buildProcessStat(40, 'a b) c', 'Z', 41, 900)
		const host = readFileSync('/proc/self/stat', 'utf8')
		const fields = built.slice(built.lastIndexOf(')') + 2).split(' ')
		const hostFields = host.slice(host.lastIndexOf(')') + 2).split(' ')

		expect([fields[0], fields[2], fields[19]]).toEqual(['Z', '41', '900'])
		expect(hostFields[2]).toMatch(/^\d+$/u)
		expect(hostFields[19]).toMatch(/^\d+$/u)
		expect(fields.length).toBeLessThanOrEqual(hostFields.length)
	})

	it('builds a mountinfo line in the shape of the host proc line', () => {
		const built = buildProcessMount('/scratch/table', 'rw,hidepid=2').trimEnd().split(' ')
		const host = readFileSync('/proc/self/mountinfo', 'utf8')
			.split(/\r\n|\n/u)
			.map((line) => line.split(' '))
			.find((fields) => fields[4] === '/proc')

		expect(built[4]).toBe('/scratch/table')
		expect(built[built.indexOf('-') + 1]).toBe('proc')
		expect(built[built.indexOf('-') + 3]).toBe('rw,hidepid=2')
		expect(host?.[(host?.indexOf('-') ?? 0) + 1]).toBe('proc')
		expect(built.length - built.indexOf('-')).toBe((host?.length ?? 0) - (host?.indexOf('-') ?? 0))
	})

	// proc(5): an optional field such as `shared:12` sits between the per-mount options and the `-`,
	// and a space in the mount point is written as the octal escape `\040`.
	it('builds a mountinfo line carrying an optional field and an escaped mount point', () => {
		const built = buildProcessMount('/scratch/a table', 'rw,hidepid=2', 'shared:12')
			.trimEnd()
			.split(' ')

		expect(built[4]).toBe('/scratch/a\\040table')
		expect(built[6]).toBe('shared:12')
		expect(built.indexOf('-')).toBe(7)
		expect(built[built.indexOf('-') + 3]).toBe('rw,hidepid=2')
	})
})

describe('resolveChildFixture spawned for real', () => {
	it('resolves a path that node itself accepts and runs as a script, not merely a path that exists', () => {
		const result = spawnSync(process.execPath, [resolveChildFixture(), 'exit', '3'])
		expect(result.error).toBeUndefined()
		expect(result.status).toBe(3)
	})
})

// Mutation control (report the failing line, then restore): change `expect(result.status).toBe(5)`
// in the first case to `expect(result.status).toBe(6)`. The real child still exits `5`, so the
// assertion fails with "expected 5 to be 6", proving the case is not vacuously true.
