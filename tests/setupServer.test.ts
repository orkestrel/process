import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { childCommand, resolveChildFixture } from './setupServer.js'

// This proof drives the command `childCommand` builds through a real child process, so the
// asserted values come from the fixture's own independent parsing of `process.argv` rather than
// from re-deriving what `childCommand` already computed. `tests/setup.test.ts` covers the
// structural shape of the returned command; this file covers that the shape actually spawns and
// behaves as the workspace's server suites rely on.

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
