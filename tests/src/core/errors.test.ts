import { PROCESS_ERROR_CODES, ProcessError, createDuplicateError, isProcessError } from '@src/core'
import { describe, expect, it } from 'vitest'
import { isConstructor, isFunction, isRecord } from '@orkestrel/contract'

describe('process error', () => {
	it('narrows its own error and refuses a plain Error', () => {
		const error = createDuplicateError('unit')
		expect(isProcessError(error)).toBe(true)
		expect(error.code).toBe('duplicate')
		expect(error.context).toStrictEqual({ id: 'unit' })
		expect(isProcessError(new Error('spawn failed'))).toBe(false)
	})

	// The guard's admitted set is compared against the declared tuple, and the refusal control is
	// drawn from outside it, so the pair pins the exact set rather than re-deriving it.
	it('admits every declared code and refuses one the tuple does not declare', () => {
		for (const code of PROCESS_ERROR_CODES) {
			expect(isProcessError(new ProcessError('declared', { code }))).toBe(true)
		}
		const undeclared = Object.defineProperty(
			Object.assign(new Error('undeclared'), { code: 'stalled', name: 'ProcessError' }),
			Symbol.for('@orkestrel/process.error'),
			{ value: true },
		)
		expect(isProcessError(undeclared)).toBe(false)
	})

	// The same recognition across the two built module formats is proved in
	// `tests/distribution.test.ts`, against the artifact a consumer installs. This project reads
	// source alone, so it runs on a tree that was never built.
	it('recognizes genuine errors across package copies', () => {
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
	})
})
