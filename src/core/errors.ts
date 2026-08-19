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
 * Creates the failure raised when a run does not complete successfully and rejection is requested.
 *
 * @param result - The buffered run outcome that failed
 * @returns A typed run failure carrying its {@link RunResult}
 */
export function createRunError(result: RunResult): ProcessError {
	const reason = result.timedOut
		? 'timed out'
		: result.signal !== null
			? `was killed by ${result.signal}`
			: `exited with code ${String(result.code)}`
	return new ProcessError(`Command '${result.command}' ${reason}`, {
		code: result.timedOut ? 'timeout' : 'spawn',
		context: { command: result.command, code: result.code, signal: result.signal },
		result,
	})
}
