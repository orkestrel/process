import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { waitForDelay } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { detach, execute, executeSync } from '@src/server'
import { childCommand } from '../../setupServer.js'

describe('execute', () => {
	it('rejects a throwing signal getter before spawning a child', async () => {
		const scratch = createScratch()
		const marker = join(scratch.path, 'hostile-signal.txt')
		const failure = new Error('hostile signal getter')
		let thrown: unknown

		try {
			try {
				await execute(childCommand('write', marker), {
					workspace: process.cwd(),
					get signal(): AbortSignal {
						throw failure
					},
				})
			} catch (error) {
				thrown = error
			}
			await waitForDelay(200)

			expect(thrown).toBe(failure)
			expect(existsSync(marker)).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
})

describe('executeSync', () => {
	it('runs the child in the workspace it validated', () => {
		const validated = createScratch()
		const later = createScratch()
		let reads = 0

		try {
			const result = executeSync(
				{ file: process.execPath, arguments: ['-e', 'process.stdout.write(process.cwd())'] },
				{
					get workspace(): string {
						reads += 1
						return reads === 1 ? validated.path : later.path
					},
				},
			)

			expect(realpathSync(result.stdout)).toBe(realpathSync(validated.path))
		} finally {
			validated.destroy()
			later.destroy()
		}
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
