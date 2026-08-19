import * as entry from '@src/core'
import { describe, expect, it } from 'vitest'

describe('src core entry', () => {
	it('exposes the process contract surface', () => {
		expect(Object.keys(entry).sort()).toStrictEqual([
			'PROCESS_EVIDENCE',
			'PROCESS_GRACE',
			'PROCESS_OUTPUT',
			'ProcessError',
			'createDuplicateError',
			'createRunError',
			'isProcessError',
		])
	})

	it('narrows its own error and refuses a plain Error', () => {
		const error = entry.createDuplicateError('unit')
		expect(entry.isProcessError(error)).toBe(true)
		expect(error.code).toBe('duplicate')
		expect(error.context).toStrictEqual({ id: 'unit' })
		expect(entry.isProcessError(new Error('spawn failed'))).toBe(false)
	})
})
