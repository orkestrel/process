import type {
	ProcessErrorCode,
	ProcessErrorContext,
	ProcessErrorOptions,
	ExecuteResult,
} from './types.js'
import { holds, INTRINSICS, isFunction, isObject } from '@orkestrel/contract'
import { PROCESS_ERROR_CODES } from './constants.js'

/**
 * Represents a child-process failure with a stable machine-readable category.
 *
 * @example
 * ```ts
 * const error = new ProcessError('git status refused', {
 * 	code: 'invalid',
 * 	context: { command: 'git status' },
 * })
 * error.code // 'invalid'
 * ```
 */
export class ProcessError extends Error {
	override readonly name = 'ProcessError'
	readonly code: ProcessErrorCode
	readonly context?: ProcessErrorContext
	/** Carries the buffered run outcome, present when a one-shot run produced the failure. */
	readonly result?: ExecuteResult

	/**
	 * Creates a process error.
	 *
	 * @param message - Human-readable failure description
	 * @param options - Machine-readable category, optional context, optional cause, and optional run result
	 */
	constructor(message: string, options: ProcessErrorOptions) {
		const cause = options.cause
		super(message, cause === undefined ? undefined : { cause })
		INTRINSICS.define(this, Symbol.for('@orkestrel/process.error'), { value: this })
		this.code = options.code
		if (options.context !== undefined) this.context = options.context
		if (options.result !== undefined) this.result = options.result
	}
}

/**
 * Checks whether an unknown value is a {@link ProcessError}.
 *
 * @remarks
 * Recognition requires a global own-property identity brand, the native `Error` base, a subclass
 * prototype, a declared code, and correctly shaped optional context and result members. Subclass
 * instances pass without reading `name`. Duplicate installations and ESM/CommonJS copies that stamp
 * their own identity recognize each other. Older boolean brands, transparent proxies, and plain
 * objects fail recognition.
 *
 * @param value - The value to inspect
 * @returns True if the value is a `ProcessError` instance; false otherwise
 *
 * @example
 * ```ts
 * isProcessError(new ProcessError('spawn failed', { code: 'spawn' })) // true
 * isProcessError(new Error('spawn failed')) // false
 * ```
 */
export function isProcessError(value: unknown): value is ProcessError {
	if (!isObject(value)) return false
	return holds(() => {
		if (!(value instanceof INTRINSICS.error)) return false
		if (INTRINSICS.prototype(value) === INTRINSICS.error.prototype) return false
		const descriptor = INTRINSICS.describe(value, Symbol.for('@orkestrel/process.error'))
		if (descriptor?.value !== value) return false
		const code: unknown = INTRINSICS.reflect.read(value, 'code')
		if (!PROCESS_ERROR_CODES.some((declared) => declared === code)) return false
		const context: unknown = INTRINSICS.reflect.read(value, 'context')
		if (context !== undefined) {
			if (!isObject(context) && !isFunction(context)) return false
			if (
				!['id', 'command'].every((key) => {
					const member: unknown = INTRINSICS.reflect.read(context, key)
					return member === undefined || typeof member === 'string'
				})
			)
				return false
			const exit: unknown = INTRINSICS.reflect.read(context, 'code')
			const signal: unknown = INTRINSICS.reflect.read(context, 'signal')
			if (exit !== undefined && exit !== null && typeof exit !== 'number') return false
			if (signal !== undefined && signal !== null && typeof signal !== 'string') return false
		}
		const result: unknown = INTRINSICS.reflect.read(value, 'result')
		if (result === undefined) return true
		if (!isObject(result)) return false
		const exit: unknown = INTRINSICS.reflect.read(result, 'code')
		const signal: unknown = INTRINSICS.reflect.read(result, 'signal')
		return (
			(exit === null || typeof exit === 'number') &&
			(signal === null || typeof signal === 'string') &&
			['command', 'stdout', 'stderr'].every(
				(key) => typeof INTRINSICS.reflect.read(result, key) === 'string',
			) &&
			['failed', 'expired', 'aborted', 'truncated'].every(
				(key) => typeof INTRINSICS.reflect.read(result, key) === 'boolean',
			)
		)
	})
}

/**
 * Creates the `duplicate`-coded failure raised when a manager launch reuses a live id.
 *
 * @param id - The id already occupied by a live child
 * @returns A typed duplicate-id failure
 */
export function createDuplicateError(id: string): ProcessError {
	return new ProcessError(`Process '${id}' is already live`, {
		code: 'duplicate',
		context: { id },
	})
}

/**
 * Creates the `protocol`-coded failure raised when a launch is attempted on a registry that is
 * being destroyed.
 *
 * @param id - The id the refused launch asked for
 * @returns A typed protocol failure
 */
export function createProtocolError(id: string): ProcessError {
	return new ProcessError(`Process '${id}' cannot launch: the registry is destroyed`, {
		code: 'protocol',
		context: { id },
	})
}

/**
 * Creates the `invalid`-coded failure raised when a public input is refused before anything is
 * spawned.
 *
 * @param subject - The rejected input named as the caller wrote it, such as `option 'grace'`
 * @param value - The rejected value, carried as `context.value`
 * @returns A typed validation failure
 *
 * @example
 * ```ts
 * createInvalidError("option 'grace'", -1).code // 'invalid'
 * ```
 */
export function createInvalidError(subject: string, value: unknown): ProcessError {
	return new ProcessError(`Invalid ${subject}`, { code: 'invalid', context: { value } })
}

/**
 * Creates the failure raised when a run does not complete successfully and rejection is requested.
 *
 * @remarks
 * The category is `timeout` only when the run's own timeout elapsed; every other failure,
 * including an abort and an output overflow, is a `spawn` failure carrying its
 * {@link ExecuteResult}.
 *
 * @param result - The buffered run outcome that failed
 * @param cause - The underlying host fault, when one ended the run
 * @returns A typed run failure carrying its {@link ExecuteResult}
 */
export function createExecuteError(result: ExecuteResult, cause?: unknown): ProcessError {
	const exit = `exited with code ${String(result.code)}`
	const signal = result.signal !== null ? `was killed by ${result.signal}` : exit
	const output = result.truncated ? 'exceeded its output limit' : signal
	const abort = result.aborted ? 'was aborted' : output
	const reason = result.expired ? 'timed out' : abort
	return new ProcessError(`Command '${result.command}' ${reason}`, {
		code: result.expired ? 'timeout' : 'spawn',
		context: { command: result.command, code: result.code, signal: result.signal },
		...(cause === undefined ? {} : { cause }),
		result,
	})
}
