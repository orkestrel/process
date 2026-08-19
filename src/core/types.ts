import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'

/**
 * The public contracts for `@orkestrel/process`: a typed child-process toolkit.
 *
 * @remarks
 * Three tiers, smallest to largest:
 *
 * - **{@link ProcessInterface}** — one supervised child with eagerly framed stdout lines, a
 *   byte-bounded stderr tail, a live stderr event, a writable stdin channel, a typed lifecycle
 *   {@link ProcessEventMap} emitter, and bounded `SIGTERM` → grace → `SIGKILL` termination. The
 *   low-level streaming primitive.
 * - **{@link RunResult} / run** — a one-shot runner that buffers a child to completion and settles
 *   with its output and exit, the ergonomic layer for fire-and-collect commands.
 * - **{@link ProcessManagerInterface}** — a keyed registry of live {@link ProcessInterface}
 *   children, launched and stopped by id, observed through its own {@link ProcessManagerEventMap}.
 *
 * Every contract here is host-independent (`AbortSignal`, `AsyncIterable`, `Promise`, and plain
 * `string` signal names). The Node implementations live in `@orkestrel/process/server`.
 */

/**
 * One spawnable command: the executable, its argument vector, and optional environment overrides
 * and initial standard input.
 *
 * @remarks
 * `environment` merges over the parent process environment; an `undefined` value unsets a key.
 * `input` is written to the child's stdin immediately after spawn.
 */
export interface ProcessCommand {
	readonly file: string
	readonly arguments: readonly string[]
	readonly environment?: Readonly<Record<string, string | undefined>>
	readonly input?: string
}

/** The observed terminal state of a child process: its exit code, or the signal that ended it. */
export interface ProcessExit {
	/** The exit code, or `null` when a signal ended the process. */
	readonly code: number | null
	/** The terminating signal name, or `null` when the process exited on its own. */
	readonly signal: string | null
}

/**
 * The push observation surface of a {@link ProcessInterface} — the moments a fire-and-forget
 * observer subscribes to, alongside the `lines` stream and the `exit` promise.
 *
 * @remarks
 * Declared as a `type` alias so it satisfies the emitter's `EventMap` constraint structurally. A
 * listener throw is isolated by the emitter and routed to its `error` handler, never onto this map.
 */
export type ProcessEventMap = {
	/** A decoded standard-error chunk arrived. */
	readonly stderr: readonly [chunk: string]
	/** The child settled — its terminal state, delivered once. */
	readonly exit: readonly [exit: ProcessExit]
}

/**
 * Construction options for one supervised child process.
 *
 * @remarks
 * `grace` is the sole timing knob: after `stop`, the child is sent `SIGTERM`, then `SIGKILL` if it
 * has not exited within `grace` milliseconds. There is no completion deadline — a caller that wants
 * one arms its own timer and calls `stop`. `on` installs initial {@link ProcessEventMap} listeners
 * and `error` receives isolated listener failures.
 */
export interface ProcessOptions {
	readonly on?: EmitterHooks<ProcessEventMap>
	readonly error?: EmitterErrorHandler
	readonly command: ProcessCommand
	/** The working directory the child runs in. */
	readonly workspace: string
	/** Cooperative termination window in milliseconds between `SIGTERM` and `SIGKILL`. */
	readonly grace: number
	/** Maximum retained stderr tail in bytes. Default: {@link PROCESS_EVIDENCE}. */
	readonly evidence?: number
	/** If `true`, stdin stays open for {@link ProcessInterface.send}; if `false` or omitted, stdin closes after any initial `input`. */
	readonly writable?: boolean
	/** Aborting this signal terminates the child through the same bounded `stop`. */
	readonly signal?: AbortSignal
}

/**
 * One supervised child process with eagerly framed output and bounded termination.
 *
 * @remarks
 * `lines` is pumped eagerly: stdout is drained whether or not a consumer iterates, so `exit`
 * resolves and a late consumer still receives every line. `evidence` is the decoded, byte-bounded
 * stderr tail — the diagnostic to attach to a failed exit. The typed `emitter` carries the live
 * `stderr` chunks and the terminal `exit`, alongside the `exit` promise. `send` never throws; it
 * returns whether the line reached an open channel. `stop` is idempotent.
 */
export interface ProcessInterface {
	/** The typed lifecycle observation surface. */
	readonly emitter: EmitterInterface<ProcessEventMap>
	/** The eagerly captured stdout lines, in arrival order, ending when the child's stdout closes. */
	readonly lines: AsyncIterable<string>
	/** The decoded byte-bounded stderr tail. */
	readonly evidence: string
	/** The terminal child state, observed once from the close event. */
	readonly exit: Promise<ProcessExit>
	/**
	 * Write one line to the open standard-input channel.
	 *
	 * @param text - The line text without its trailing newline
	 * @returns True when the channel accepted the line without backpressure; false otherwise
	 */
	send(text: string): boolean
	/**
	 * Terminate the child process tree and await its observed exit.
	 *
	 * @returns A promise that resolves after bounded termination
	 */
	stop(): Promise<void>
	/**
	 * Stop the child and destroy the observation emitter.
	 *
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void>
}

/**
 * The settled outcome of a one-shot run: the buffered output and the terminal state.
 *
 * @remarks
 * `failed` is `true` when the child exited non-zero, was killed by a signal, timed out, or failed to
 * spawn. `timedOut` is `true` only when the run's own `timeout` elapsed.
 */
export interface RunResult {
	/** The command line that was run, for diagnostics. */
	readonly command: string
	/** The complete captured standard output, byte-bounded by `limit`. */
	readonly stdout: string
	/** The complete captured standard error, byte-bounded by `limit`. */
	readonly stderr: string
	readonly code: number | null
	readonly signal: string | null
	/** True if the run did not complete successfully. */
	readonly failed: boolean
	/** True if the run's `timeout` elapsed before completion. */
	readonly timedOut: boolean
}

/**
 * Options for a one-shot run.
 *
 * @remarks
 * A run is a fire-and-collect function, not a lifecycle entity, so it carries no emitter. `reject`
 * follows the command-runner convention: by default a non-zero exit rejects with a
 * {@link ProcessError} carrying the {@link RunResult}; `reject: false` resolves with the result
 * instead, so the caller inspects `failed`.
 */
export interface RunOptions {
	/** The working directory. Default: the current working directory. */
	readonly workspace?: string
	/** Environment overrides merged over the parent environment; an `undefined` value unsets a key. */
	readonly environment?: Readonly<Record<string, string | undefined>>
	/** Standard input written to the child. */
	readonly input?: string
	/** Milliseconds before the child is terminated. `0` or omitted disables the timeout. */
	readonly timeout?: number
	/** Cooperative window between `SIGTERM` and `SIGKILL` when terminating. Default: {@link PROCESS_GRACE}. */
	readonly grace?: number
	/** Aborting this signal terminates the run. */
	readonly signal?: AbortSignal
	/** If `false`, resolve with the result on failure instead of rejecting. Default: `true`. */
	readonly reject?: boolean
	/** Maximum captured bytes for stdout and for stderr, each. Default: {@link PROCESS_OUTPUT}. */
	readonly limit?: number
}

/**
 * The push observation surface of a {@link ProcessManagerInterface} — the fleet-level moments a
 * fire-and-forget observer subscribes to.
 *
 * @remarks
 * Declared as a `type` alias so it satisfies the emitter's `EventMap` constraint structurally.
 */
export type ProcessManagerEventMap = {
	/** A child was launched under its id. */
	readonly launch: readonly [id: string]
	/** A child settled and left the registry — its id and terminal state. */
	readonly exit: readonly [id: string, exit: ProcessExit]
}

/**
 * Construction options for a {@link ProcessManagerInterface}.
 *
 * @remarks
 * `on` installs initial {@link ProcessManagerEventMap} listeners and `error` receives isolated
 * listener failures.
 */
export interface ProcessManagerOptions {
	readonly on?: EmitterHooks<ProcessManagerEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * A keyed registry of live supervised child processes.
 *
 * @remarks
 * A child that settles removes itself from the registry, so `count` and `processes` reflect only
 * live children, and its departure emits `exit`. `launch` throws a {@link ProcessError} coded
 * `duplicate` when the id is already live — spawn faults surface through the returned child's
 * `exit`, not from `launch`. The typed `emitter` carries the `launch` and `exit` moments across
 * every child.
 */
export interface ProcessManagerInterface {
	/** The typed fleet-level observation surface. */
	readonly emitter: EmitterInterface<ProcessManagerEventMap>
	/** The number of live children. */
	readonly count: number
	/**
	 * The live child under `id`, or `undefined` when none is.
	 *
	 * @param id - The registry key
	 * @returns The child, or `undefined`
	 */
	process(id: string): ProcessInterface | undefined
	/**
	 * A snapshot of every live child.
	 *
	 * @returns The live children in launch order
	 */
	processes(): readonly ProcessInterface[]
	/**
	 * Spawn and register one child under `id`.
	 *
	 * @param id - The registry key, unique among live children
	 * @param options - The child construction options
	 * @returns The launched child
	 * @throws A {@link ProcessError} coded `duplicate` when `id` is already live
	 */
	launch(id: string, options: ProcessOptions): ProcessInterface
	/**
	 * Terminate the named children and await their exit.
	 *
	 * @param ids - The registry keys to stop
	 * @returns True when every named child stopped, false when any id was not live
	 */
	stop(ids: readonly string[]): Promise<boolean>
	/**
	 * Terminate one child and await its exit.
	 *
	 * @param id - The registry key to stop
	 * @returns True when the child was live and stopped, false when the id was not live
	 */
	stop(id: string): Promise<boolean>
	/**
	 * Terminate every live child and await their exit.
	 *
	 * @returns A promise that resolves after all children stop
	 */
	stop(): Promise<void>
	/**
	 * Stop every child, then destroy the registry emitter last.
	 *
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void>
}

/** The machine-readable {@link ProcessError} categories. */
export type ProcessErrorCode = 'spawn' | 'timeout' | 'duplicate' | 'protocol'

/** Structured context carried by a {@link ProcessError}. */
export interface ProcessErrorContext {
	/** The registry id involved, for a manager failure. */
	readonly id?: string
	/** The command line involved, for a run or spawn failure. */
	readonly command?: string
	/** The child's exit code, when one was observed. */
	readonly code?: number | null
	/** The terminating signal, when one ended the child. */
	readonly signal?: string | null
	/** The rejected public input, for an input-validation failure. */
	readonly value?: unknown
}

/** Construction options for a {@link ProcessError}. */
export interface ProcessErrorOptions {
	/** The stable machine-readable category. */
	readonly code: ProcessErrorCode
	/** Structured detail about the failure. */
	readonly context?: ProcessErrorContext
	/** The underlying cause, when one exists. */
	readonly cause?: unknown
	/** The buffered run outcome, present when a {@link RunResult} produced the failure. */
	readonly result?: RunResult
}
