import type { ProcessCommand } from '@src/core'
import { join } from 'node:path'

/**
 * Resolves the self-contained child-process fixture entrypoint.
 *
 * @returns The absolute path to the spawnable fixture
 */
export function resolveChildFixture(): string {
	return join(process.cwd(), 'tests', 'src', 'server', 'fixtures', 'child.mjs')
}

/**
 * Builds a command that drives the child fixture in one of its behavior modes.
 *
 * @param mode - The fixture behavior mode
 * @param detail - An optional per-mode argument, such as an exit code
 * @returns The spawnable command for the current Node runtime
 */
export function childCommand(mode: string, detail?: string): ProcessCommand {
	const argumentsList =
		detail === undefined ? [resolveChildFixture(), mode] : [resolveChildFixture(), mode, detail]
	return { file: process.execPath, arguments: argumentsList }
}
