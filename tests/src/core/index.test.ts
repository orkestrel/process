import { createRequire } from 'node:module'
import * as entry from '@src/core'
import { describe, expect, it } from 'vitest'
import { isConstructor, isFunction, isRecord } from '@orkestrel/contract'

describe('src core entry', () => {
	it('exposes the process contract surface', () => {
		expect(Object.keys(entry).sort()).toStrictEqual([
			'PROCESS_BACKLOG',
			'PROCESS_CONFIRMATION',
			'PROCESS_EVIDENCE',
			'PROCESS_GRACE',
			'PROCESS_OUTPUT',
			'PROCESS_PATHEXT',
			'PROCESS_TIMER',
			'ProcessError',
			'createDuplicateError',
			'createInvalidError',
			'createProtocolError',
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

	it('recognizes genuine errors across package copies and module formats', () => {
		const firstModules = import.meta.glob('../../../src/core/errors.ts', {
			eager: true,
			query: '?copy=first',
		})
		const secondModules = import.meta.glob('../../../src/core/errors.ts', {
			eager: true,
			query: '?copy=second',
		})
		const first: unknown = Object.values(firstModules)[0]
		const second: unknown = Object.values(secondModules)[0]
		if (!isRecord(first) || !isRecord(second)) throw new Error('source error copies did not load')
		const firstGuard = first.isProcessError
		const FirstConstructor = first.ProcessError
		const SecondConstructor = second.ProcessError
		if (
			!isFunction(firstGuard) ||
			!isConstructor(FirstConstructor) ||
			!isConstructor(SecondConstructor)
		) {
			throw new Error('source error exports did not load')
		}
		const other: unknown = Reflect.construct(SecondConstructor, [
			'invalid command',
			{ code: 'invalid' },
		])
		const lookalike = Object.defineProperty(
			new Error('invalid command'),
			Symbol.for('@orkestrel/process.error'),
			{ value: true },
		)

		expect(FirstConstructor).not.toBe(SecondConstructor)
		expect(firstGuard(other)).toBe(true)
		expect(firstGuard(new Error('invalid command'))).toBe(false)
		expect(firstGuard(lookalike)).toBe(false)

		const builtModules = import.meta.glob('../../../dist/src/core/index.js', { eager: true })
		const esm: unknown = Object.values(builtModules)[0]
		const commonJS: unknown = createRequire(import.meta.url)('../../../dist/src/core/index.cjs')
		if (!isRecord(esm) || !isRecord(commonJS)) throw new Error('built core entries did not load')
		const guard = esm.isProcessError
		const Constructor = commonJS.ProcessError
		if (!isFunction(guard) || !isConstructor(Constructor)) {
			throw new Error('built core error exports did not load')
		}
		const commonJSError: unknown = Reflect.construct(Constructor, [
			'invalid command',
			{ code: 'invalid' },
		])

		expect(guard(commonJSError)).toBe(true)
	})
})
