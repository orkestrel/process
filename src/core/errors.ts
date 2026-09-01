import type {
	ProcessErrorCode,
	ProcessErrorContext,
	ProcessErrorOptions,
	ExecuteResult,
} from './types.js'
import { holds, isError } from '@orkestrel/contract'
import { PROCESS_ERROR_CODES } from './constants.js'

/**
 * A child-process failure with a stable machine-readable category.
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
	/** The buffered run outcome, present when a one-shot run produced the failure. */
	readonly result?: ExecuteResult

	/**
	 * Create a process error.
	 *
	 * @param message - Human-readable failure description
	 * @param options - Machine-readable category, optional context, optional cause, and optional run result
	 */
	constructor(message: string, options: ProcessErrorOptions) {
		const cause = options.cause
		super(message, cause === undefined ? undefined : { cause })
		Object.defineProperty(this, Symbol.for('@orkestrel/process.error'), { value: true })
		this.code = options.code
		if (options.context !== undefined) this.context = options.context
		if (options.result !== undefined) this.result = options.result
	}
}

/**
 * Checks whether an unknown value is a {@link ProcessError}.
 *
 * @remarks
 * Recognition combines a global own-property brand with the native `Error` base, the subclass
 * prototype, the fixed name, and a code {@link PROCESS_ERROR_CODES} declares. The brand is
 * recognized across duplicate installations and ESM/CommonJS module copies at 0.0.4 or later. A copy
 * earlier than 0.0.4 stamps no brand, so an error it throws stays outside the type, and so does a
 * plain or property-only lookalike.
 *
 * @param value - The value to inspect
 * @returns True only for a `ProcessError` instance; false otherwise
 *
 * @example
 * ```ts
 * isProcessError(new ProcessError('spawn failed', { code: 'spawn' })) // true
 * isProcessError(new Error('spawn failed')) // false
 * ```
 */
export function isProcessError(value: unknown): value is ProcessError {
	if (!isError(value)) return false
	return holds(() => {
		if (Object.getPrototypeOf(value) === Error.prototype) return false
		if (value.name !== 'ProcessError' || !('code' in value)) return false
		const descriptor = Object.getOwnPropertyDescriptor(
			value,
			Symbol.for('@orkestrel/process.error'),
		)
		if (descriptor?.value !== true) return false
		const code: unknown = value.code
		return PROCESS_ERROR_CODES.some((declared) => declared === code)
	})
}

/**
 * Creates the failure raised when a manager launch reuses a live id.
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
 * Creates the failure raised when a launch is attempted on a registry that is being destroyed.
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
 * Creates the failure raised when a public input is refused before anything is spawned.
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
	let reason = `exited with code ${String(result.code)}`
	if (result.signal !== null) reason = `was killed by ${result.signal}`
	if (result.truncated) reason = 'exceeded its output limit'
	if (result.aborted) reason = 'was aborted'
	if (result.expired) reason = 'timed out'
	return new ProcessError(`Command '${result.command}' ${reason}`, {
		code: result.expired ? 'timeout' : 'spawn',
		context: { command: result.command, code: result.code, signal: result.signal },
		...(cause === undefined ? {} : { cause }),
		result,
	})
}
