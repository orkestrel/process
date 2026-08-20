import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { waitForDelay } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { execute } from '@src/server'
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
