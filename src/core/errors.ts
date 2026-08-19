import { holds } from '@orkestrel/contract'
import type {
	ProcessErrorCode,
	ProcessErrorContext,
	ProcessErrorOptions,
	RunResult,
} from './types.js'

/** A child-process failure with a stable machine-readable category. */
export class ProcessError extends Error {
	override readonly name = 'ProcessError'
	readonly code: ProcessErrorCode
	readonly context?: ProcessErrorContext
	/** The buffered run outcome, present when a one-shot run produced the failure. */
	readonly result?: RunResult

	/**
	 * Create a process error.
	 *
	 * @param message - Human-readable failure description
	 * @param options - Machine-readable category, optional context, optional cause, and optional run result
	 */
	constructor(message: string, options: ProcessErrorOptions) {
		const cause = options.cause
		super(message, cause === undefined ? undefined : { cause })
		this.code = options.code
		if (options.context !== undefined) this.context = options.context
		if (options.result !== undefined) this.result = options.result
	}
}

/**
 * Checks whether an unknown value is a {@link ProcessError}.
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
	return holds(() => value instanceof ProcessError)
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
 * The category is `timeout` only when the run's own timeout elapsed; every other failure, including
 * an abort and an output overflow, is a `spawn` failure carrying its {@link RunResult}.
 *
 * @param result - The buffered run outcome that failed
 * @param cause - The underlying host fault, when one ended the run
 * @returns A typed run failure carrying its {@link RunResult}
 */
export function createRunError(result: RunResult, cause?: unknown): ProcessError {
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
