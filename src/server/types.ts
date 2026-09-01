/**
 * The Node-side contracts of `@orkestrel/process/server`.
 *
 * @remarks
 * The host-independent contracts live in `@orkestrel/process`. This module declares only what a
 * Node child process boundary requires, which the published contracts cannot express without
 * naming `node:child_process` types.
 */

import type { ProcessExit } from '@src/core'

/**
 * The child boundary the termination helpers drive.
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
export interface ProcessChild {
	/** The process id the host assigned, or `undefined` when the spawn never produced one. */
	readonly pid?: number | undefined
	/** The exit code, or `null` while the process is live or a signal ended it. */
	readonly exitCode: number | null
	/** The terminating signal name, or `null` while the process is live or it exited on its own. */
	readonly signalCode: string | null
	/**
	 * Deliver one signal to the process.
	 *
	 * @param signal - The signal to deliver
	 * @returns True when the host accepted the signal; false otherwise
	 */
	kill(signal: NodeJS.Signals): boolean
	/**
	 * Register a one-shot listener for the native exit or stream close.
	 *
	 * @param event - The `exit` or `close` event name
	 * @param listener - The listener invoked after the selected event
	 * @returns Whatever the emitter returns, which the helpers ignore
	 */
	once(event: 'exit' | 'close', listener: () => void): unknown
	/**
	 * Release one previously registered exit or close listener.
	 *
	 * @remarks
	 * `waitForExit` releases its `exit` listener, and `waitForClose` releases its `close` listener, so
	 * a child that outlives several bounded waits accumulates neither.
	 *
	 * @param event - The `exit` or `close` event name
	 * @param listener - The listener registered through `once`
	 * @returns Whatever the emitter returns, which the helpers ignore
	 */
	off(event: 'exit' | 'close', listener: () => void): unknown
}

/**
 * The composing face's callbacks for each lifecycle moment of one supervised child.
 *
 * @remarks
 * `Process` and `Session` each construct one and hand it to the supervision engine, which captures
 * every callback before anything is read or spawned, so the first moment the child can produce
 * already has somewhere to go. `chunk` receives each decoded standard-error fragment, `fault` the
 * host error that ended the run, `close` the moment the read channels closed, `terminal` the frozen
 * exit state, and `teardown` the release of whatever the face still holds. `relieve` is optional
 * because only a face carrying a standard-input channel reports backpressure relief.
 */
export interface SupervisorFace {
	/** Receives one decoded standard-error fragment. */
	readonly chunk: (text: string) => void
	/** Receives the host error that ended the run. */
	readonly fault: (cause: unknown) => void
	/** Reports that a pending standard-input write can proceed, for a face carrying a channel. */
	readonly relieve?: () => void
	/** Reports that the child's read channels closed. */
	readonly close: () => void
	/** Receives the frozen terminal state. */
	readonly terminal: (exit: ProcessExit) => void
	/** Releases whatever the face still holds after the terminal moment. */
	readonly teardown: () => void
}
