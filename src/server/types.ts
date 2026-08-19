/**
 * The Node-side contracts of `@orkestrel/process/server`.
 *
 * @remarks
 * The host-independent contracts live in `@orkestrel/process`. This module declares only what a
 * Node child process boundary requires, which the published contracts cannot express without
 * naming `node:child_process` types.
 */

/**
 * The child boundary the termination helpers drive.
 *
 * @remarks
 * A `ChildProcess` satisfies this structurally, and so does any object carrying the same four
 * members, which is what lets a caller drive `stopChild` over a child it spawned itself. Each helper
 * takes the slice of this contract it reads: `exitCode` and `signalCode` are the host's
 * authoritative liveness answer, `pid` addresses a POSIX process group, `kill` delivers one signal,
 * and `once` reports the native exit.
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
	 * Register a one-shot listener for the native exit.
	 *
	 * @param event - The `exit` event name
	 * @param listener - The listener invoked once the process exits
	 * @returns Whatever the emitter returns, which the helpers ignore
	 */
	once(event: 'exit', listener: () => void): unknown
}
