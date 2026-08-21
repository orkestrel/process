import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { holds } from '@orkestrel/contract'
import { waitForCondition, waitForDelay } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { isProcessError } from '@src/core'
import { detach } from '@src/server'
import { childCommand, resolveChildFixture } from '../../../setupServer.js'

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
})

describe('detach', () => {
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
