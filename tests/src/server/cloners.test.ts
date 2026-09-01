import { describe, expect, it } from 'vitest'
import { snapshotCommand } from '@src/server'

describe('snapshotCommand', () => {
	it('reads each property once and keeps a later mutation out of the snapshot', () => {
		const files: string[] = []
		const argumentsList = ['status']
		const environment: Record<string, string> = { TOKEN: 'a' }
		const snapshot = snapshotCommand({
			get file() {
				files.push('read')
				return files.length === 1 ? 'git' : 'curl'
			},
			arguments: argumentsList,
			environment,
			isolated: true,
		})
		argumentsList.push('--short')
		environment.TOKEN = 'b'

		expect(files.length).toBe(1)
		expect(snapshot.file).toBe('git')
		expect(snapshot.arguments).toEqual(['status'])
		expect(snapshot.environment).toEqual({ TOKEN: 'a' })
		expect(Object.isFrozen(snapshot)).toBe(true)
		expect(Object.isFrozen(snapshot.arguments)).toBe(true)
		expect(Object.isFrozen(snapshot.environment)).toBe(true)
	})

	it('omits an absent optional rather than carrying it as undefined', () => {
		const snapshot = snapshotCommand({ file: 'git', arguments: ['status'] })

		expect(Object.keys(snapshot)).toEqual(['file', 'arguments'])
	})
})
