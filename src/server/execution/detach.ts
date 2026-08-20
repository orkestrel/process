import type { DetachOptions, ProcessCommand } from '@src/core'
import { spawn } from 'node:child_process'
import {
	buildSpawn,
	mergeEnvironment,
	snapshotCommand,
	validateCommand,
	validateWorkspace,
} from '../helpers.js'

/**
 * Spawns one command as a detached process and returns without waiting for it.
 *
 * @remarks
 * The child owns no stdio and is unreferenced, so it outlives this process and nothing here observes
 * its outcome. The error listener is attached before the child is unreferenced, so a post-spawn host
 * fault is swallowed rather than crashing the caller; an invalid command is refused before anything
 * is spawned.
 *
 * @param command - The executable, arguments, and optional environment
 * @param options - The working directory the detached child starts in
 * @returns Nothing
 * @throws A {@link ProcessError} coded `invalid` when the working directory or a command string is malformed
 *
 * @example
 * ```ts
 * detach({ file: 'node', arguments: ['daemon.js'] }, { workspace: process.cwd() })
 * ```
 */
export function detach(command: ProcessCommand, options?: DetachOptions): void {
	const snapshot = snapshotCommand(command)
	const optionWorkspace = options?.workspace
	validateCommand(snapshot)
	validateWorkspace(optionWorkspace)
	const workspace = optionWorkspace ?? process.cwd()
	const environment = mergeEnvironment(snapshot.isolated === true, snapshot.environment)
	const plan = buildSpawn(snapshot, { workspace, environment })
	const child = spawn(plan.file, [...plan.arguments], {
		cwd: workspace,
		detached: true,
		env: environment,
		stdio: 'ignore',
		windowsHide: true,
		windowsVerbatimArguments: plan.verbatim,
	})
	child.once('error', () => undefined)
	child.unref()
}
