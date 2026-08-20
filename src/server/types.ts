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
 * A `ChildProcess` satisfies this structurally, and so does any object carrying the same
 * members, which is what lets a caller drive `stopChild` over a child it spawned itself. Each helper
 * takes the slice of this contract it reads: `exitCode` and `signalCode` are the host's
 * authoritative liveness answer, `pid` addresses a POSIX process group, `kill` delivers one signal,
 * `once` reports the native exit, and `off` releases that listener when the wait ends at its
 * deadline instead.
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
	 * Register a one-shot listener for the native exit.
	 *
	 * @param event - The `exit` event name
	 * @param listener - The listener invoked after the process exits
	 * @returns Whatever the emitter returns, which the helpers ignore
	 */
	once(event: 'exit', listener: () => void): unknown
	/**
	 * Release one previously registered exit listener.
	 *
	 * @remarks
	 * `waitForExit` calls this when its deadline elapses before the exit, so a child that outlives
	 * several bounded waits accumulates no listeners.
	 *
	 * @param event - The `exit` event name
	 * @param listener - The listener registered through `once`
	 * @returns Whatever the emitter returns, which the helpers ignore
	 */
	off(event: 'exit', listener: () => void): unknown
}

/**
 * The byte totals accumulated while a stream head is retained.
 *
 * @remarks
 * The properties are mutable because {@link retainChunk} updates the caller-owned accumulator in
 * place without allocating for each delivered chunk.
 */
export interface CaptureCounts {
	delivered: number
	retained: number
}
