/**
 * Declares the Node-side contracts of `@orkestrel/process/server`.
 *
 * @remarks
 * The host-independent contracts live in `@orkestrel/process`. This module declares the contracts
 * the Node-side face needs, each for its own reason rather than for one shared one:
 * `ProcessChildInterface` types the child boundary the termination helpers drive and names
 * `NodeJS.Signals`, which a host-independent contract cannot; `SupervisorFace` names no Node
 * type, but its one consumer is the Node-only `Supervisor` engine, so it sits with the face that
 * constructs one.
 */

import type { ProcessExit } from '@src/core'

/**
 * Represents the child boundary the termination helpers drive.
 *
 * @remarks
 * A `ChildProcess` satisfies this structurally, and so does any object carrying the same
 * members, which is what lets a caller drive `stopChild` over a child it spawned itself. Each helper
 * takes the slice of this contract it reads: `exitCode` and `signalCode` are the host's
 * authoritative liveness answer, `pid` addresses a POSIX process group, `kill` delivers one signal,
 * `once` reports the native exit to `waitForExit` or the stream close to `waitForClose`, and `off`
 * releases the corresponding listener when either wait ends.
 *
 * A non-detached child stays in its caller's process group, so no group carries its pid. `kill` is
 * the route that reaches it: `killProcess` signals the negated `pid` first and falls back to `kill`
 * when the host reports that no group owns that pid.
 */
export interface ProcessChildInterface {
	/** Holds the process id the host assigned, or `undefined` when the spawn never produced one. */
	readonly pid?: number | undefined
	/** Holds the exit code, or `null` while the process is live or a signal ended it. */
	readonly exitCode: number | null
	/** Holds the terminating signal name, or `null` while the process is live or it exited on its own. */
	readonly signalCode: string | null
	/**
	 * Delivers one signal to the process.
	 *
	 * @param signal - The signal to deliver
	 * @returns True if the host accepted the signal; false otherwise
	 *
	 * @example
	 * ```ts
	 * const accepted = child.kill('SIGTERM')
	 * accepted // true
	 * ```
	 */
	kill(signal: NodeJS.Signals): boolean
	/**
	 * Registers a one-shot listener for the native exit or stream close.
	 *
	 * @param event - The `exit` or `close` event name
	 * @param listener - The listener invoked after the selected event
	 * @returns Whatever the emitter returns, which the helpers ignore
	 *
	 * @example
	 * ```ts
	 * const settle = (): void => undefined
	 * child.once('exit', settle)
	 * ```
	 */
	once(event: 'exit' | 'close', listener: () => void): unknown
	/**
	 * Releases one previously registered exit or close listener.
	 *
	 * @remarks
	 * `waitForExit` releases its `exit` listener, and `waitForClose` releases its `close` listener, so
	 * a child that outlives several bounded waits accumulates neither.
	 *
	 * @param event - The `exit` or `close` event name
	 * @param listener - The listener registered through `once`
	 * @returns Whatever the emitter returns, which the helpers ignore
	 *
	 * @example
	 * ```ts
	 * const settle = (): void => undefined
	 * child.once('exit', settle)
	 * child.off('exit', settle)
	 * ```
	 */
	off(event: 'exit' | 'close', listener: () => void): unknown
}

/**
 * Represents the composing face's callbacks for each lifecycle moment of one supervised child.
 *
 * @remarks
 * `Process` and `Session` each construct one and hand it to the supervision engine, which captures
 * every callback before anything is read or spawned, so the first moment the child can produce
 * already has somewhere to go. `chunk` receives each decoded standard-error fragment, `fault` the
 * host error that ended the run, `close` the moment the read channels closed, `terminal` the frozen
 * exit state, and `teardown` the release of whatever the face still holds. `relieve` is optional
 * because a face that never pauses the child's output holds no backpressure to release.
 */
export interface SupervisorFace {
	/** Receives one decoded standard-error fragment. */
	readonly chunk: (text: string) => void
	/** Receives the host error that ended the run. */
	readonly fault: (cause: unknown) => void
	/** Reports that a termination began, so a face holding output backpressure releases it. */
	readonly relieve?: () => void
	/** Reports that the child's read channels closed. */
	readonly close: () => void
	/** Receives the frozen terminal state. */
	readonly terminal: (exit: ProcessExit) => void
	/** Releases whatever the face still holds after the terminal moment. */
	readonly teardown: () => void
}
