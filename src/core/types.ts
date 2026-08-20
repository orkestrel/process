import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'

/**
 * The public contracts for `@orkestrel/process`: a typed child-process toolkit.
 *
 * @remarks
 * Three tiers, smallest to largest:
 *
 * - **{@link ProcessInterface}** — one supervised child with framed stdout lines under a bounded
 *   backlog, a byte-bounded stderr tail, a live stderr event, a writable stdin channel, a typed
 *   lifecycle {@link ProcessEventMap} emitter, and bounded termination. The low-level streaming
 *   primitive.
 * - **{@link RunResult} / run** — a one-shot runner that buffers a child to completion and settles
 *   with its output and exit, the ergonomic layer for fire-and-collect commands.
 * - **{@link ProcessManagerInterface}** — a keyed registry of live {@link ProcessInterface}
 *   children, launched and stopped by id, observed through its own {@link ProcessManagerEventMap}.
 *
 * Every contract here is host-independent (`AbortSignal`, `AsyncIterable`, `Promise`, `Uint8Array`,
 * and plain `string` signal names). The Node implementations live in `@orkestrel/process/server`.
 */

/**
 * One spawnable command: the executable, its argument vector, and optional environment overrides
 * and initial standard input.
 *
 * @remarks
 * `environment` merges over the parent process environment unless `isolated` is `true`, and an
 * `undefined` value unsets a key. On Windows the merge is case-insensitive and the last writer
 * wins, matching how the host resolves an environment variable. `input` is standard-input payload
 * written immediately after spawn, so it carries no NUL restriction. Every spawn-bound string here
 * is validated: an empty `file`, or a NUL character in `file`, `arguments`, or `environment`, is
 * refused with a {@link ProcessError} coded `invalid`. On a POSIX host, `isolated: true` leaves no
 * `PATH`, so pass an absolute `file` or include `PATH` in `environment`. On Windows, libuv injects a
 * host environment set even when `isolated` is `true`.
 */
export interface ProcessCommand {
	readonly file: string
	readonly arguments: readonly string[]
	readonly environment?: Readonly<Record<string, string | undefined>>
	readonly input?: string
	/** If `true`, exclude the parent environment; on POSIX this leaves no `PATH`, while Windows libuv still injects a host set. */
	readonly isolated?: boolean
}

/** The observed terminal state of a child process: its exit code, or the signal that ended it. */
export interface ProcessExit {
	/** The exit code, or `null` when a signal ended the process. A spawn fault reports the host's negative errno for `Process` and `run`. */
	readonly code: number | null
	/** The terminating signal name, or `null` when the process exited on its own. */
	readonly signal: string | null
}

/**
 * The resolved spawn form of one command: the executable to launch, the argument vector to pass,
 * and whether the host receives that vector verbatim.
 *
 * @remarks
 * No spawn in this package uses an implicit shell. `verbatim` is `true` only for a Windows `.cmd` or
 * `.bat` script, which runs through an explicitly quoted `cmd.exe /d /s /c` command line, and an
 * argument that batch target could corrupt — one carrying `%`, which `cmd.exe` expands before it
 * parses quotes — is refused rather than passed. A shell metacharacter in an argument is therefore
 * data rather than syntax on every path.
 */
export interface SpawnInput {
	readonly file: string
	readonly arguments: readonly string[]
	/** If `true`, pass the argument vector to the host verbatim; if `false`, let the host quote it. */
	readonly verbatim: boolean
}

/**
 * Lookup inputs for resolving a command file to an executable path.
 *
 * @remarks
 * `workspace` is searched before `PATH`, matching Windows command semantics. `environment` is the
 * child's effective environment, so the lookup reads the same `PATH` and `PATHEXT` the child will.
 */
export interface ExecutableOptions {
	/** The directory searched first. Default: the current working directory. */
	readonly workspace?: string
	/** The child's effective environment. Default: the parent process environment. */
	readonly environment?: Readonly<Record<string, string | undefined>>
}

/**
 * The push observation surface of a {@link ProcessInterface} — the moments a fire-and-forget
 * observer subscribes to, alongside the `lines` stream and the `exit` promise.
 *
 * @remarks
 * Declared as a `type` alias so it satisfies the emitter's `EventMap` constraint structurally. The
 * `error` event carries a child fault — a failure to spawn or a process-level error. It is distinct
 * from the `error` handler in {@link ProcessOptions}: a listener throw is isolated by the emitter and
 * routed to that handler, never emitted as this `error` event.
 */
export type ProcessEventMap = {
	/** A decoded standard-error chunk arrived. */
	readonly stderr: readonly [chunk: string]
	/** The child emitted an error — a spawn fault or process-level failure — carrying its cause. */
	readonly error: readonly [error: unknown]
	/** The child settled — its terminal state, delivered once. */
	readonly exit: readonly [exit: ProcessExit]
}

/**
 * Construction options for one supervised child process.
 *
 * @remarks
 * `grace` is the cooperative window between `SIGTERM` and `SIGKILL` on a POSIX host; Windows has no
 * cooperative phase, so the value is unused there. There is no completion deadline — a caller that
 * wants one arms its own timer and calls `stop`. `backlog` bounds the unconsumed `lines` backlog.
 * During termination, retained lines are capped at twice `backlog`; later lines are dropped without
 * pausing stdout, and {@link ProcessInterface.truncated} reports the omission. `on` installs initial
 * {@link ProcessEventMap} listeners and `error` receives isolated listener failures. Every numeric
 * option is validated at construction: a timer value outside
 * `[0, PROCESS_TIMER]`, a negative or fractional byte value, or a `backlog` below `1` throws a
 * {@link ProcessError} coded `invalid`. POSIX detachment creates the process group used for tree
 * termination, so the child survives the supervisor's `SIGKILL` and does not receive the terminal's
 * `SIGINT`. A consumer must call `stop` or `destroy` during an orderly shutdown.
 */
export interface ProcessOptions {
	readonly on?: EmitterHooks<ProcessEventMap>
	readonly error?: EmitterErrorHandler
	readonly command: ProcessCommand
	/** The working directory the child runs in. */
	readonly workspace: string
	/** Cooperative POSIX window in milliseconds between `SIGTERM` and `SIGKILL`. Default: {@link PROCESS_GRACE}. */
	readonly grace?: number
	/** Maximum retained stderr tail in bytes. Default: {@link PROCESS_EVIDENCE}. */
	readonly evidence?: number
	/** Soft high-water mark in bytes for the unconsumed `lines` backlog; termination retains at most twice this value. Default: {@link PROCESS_BACKLOG}. */
	readonly backlog?: number
	/** If `true`, stdin stays open for {@link ProcessInterface.send}; if `false` or omitted, stdin closes after any initial `input`. */
	readonly writable?: boolean
	/** Aborting this signal terminates the child through the same bounded `stop`. */
	readonly signal?: AbortSignal
}

/**
 * One supervised child process with framed output, a bounded backlog, and bounded termination.
 *
 * @remarks
 * `lines` is pumped as soon as the child writes, and it is a single-consumer stream: each line goes
 * to exactly one waiting iterator, so two iterators split the output between them rather than each
 * receiving all of it. The policy for an unconsumed backlog follows
 * consumer intent. Once an iterator has been requested, stdout pauses at the `backlog` mark and
 * resumes at half of it, so the consumer loses nothing and the child feels real backpressure. While
 * no iterator has ever been requested, stdout keeps draining so `exit` still resolves, and retention
 * stops at the mark: a consumer attaching after that point receives the retained head, a gap, then
 * the live stream. `evidence` is the decoded, byte-bounded stderr tail — the diagnostic to attach to
 * a failed exit. `truncated` reports that the stream omitted lines after either retention bound was
 * reached. The typed `emitter` carries the live `stderr` chunks, the child `error` cause, and the
 * terminal `exit`, alongside the `exit` promise. `stop` and `destroy` are idempotent and never reject.
 */
export interface ProcessInterface {
	/** The typed lifecycle observation surface. */
	readonly emitter: EmitterInterface<ProcessEventMap>
	/** The captured stdout lines, in arrival order, for one consumer, ending when the child's stdout closes. */
	readonly lines: AsyncIterable<string>
	/** The decoded byte-bounded stderr tail. */
	readonly evidence: string
	/** True when the `lines` stream omitted output after a retention bound was reached. */
	readonly truncated: boolean
	/** The terminal child state, observed once from the close event. */
	readonly exit: Promise<ProcessExit>
	/**
	 * Write one line to the open standard-input channel.
	 *
	 * @remarks
	 * Never rejects. The promise settles when the host reports the line handled, so a line written
	 * to a child that is not reading stays pending until the child drains it or the channel closes.
	 * Every terminal teardown path destroys stdin, so a pending write always settles by teardown. A
	 * caller that needs its own deadline arms a timer and calls `stop`.
	 *
	 * @param text - The line text without its trailing newline
	 * @returns True when the line reached the host without error; false when the channel was closed, destroyed, ended, or the write failed
	 */
	send(text: string): Promise<boolean>
	/**
	 * Terminate the child process tree and await its observed exit.
	 *
	 * @remarks
	 * Never rejects. On Windows the whole tree is killed immediately through `taskkill`, with a
	 * direct kill as the fallback; on a POSIX host the process group receives `SIGTERM`, then
	 * `SIGKILL` after `grace`. No signal is initiated after the child's native exit is observed; the
	 * window between initiating a signal and the host delivering it belongs to the operating system.
	 *
	 * @returns True when the child's native exit was observed; false when the confirmation deadline elapsed without it
	 */
	stop(): Promise<boolean>
	/**
	 * Stop the child, close its standard-input channel, and destroy the observation emitter.
	 *
	 * @remarks
	 * Always resolves, including when termination was never confirmed. Resolving does not imply the
	 * child's stdio has closed: a descendant holding an inherited pipe keeps the close event pending,
	 * so `exit` and `lines` can still be outstanding after this barrier settles.
	 *
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void>
}

/**
 * The settled outcome of a one-shot run: the buffered output and the terminal state.
 *
 * @remarks
 * `failed` is `true` when the child exited non-zero, was killed by a signal, expired, was aborted, or
 * failed to spawn. `expired` and `aborted` are the two ways the run ended the child rather than the
 * child ending itself, and only the first of them observed is recorded. `truncated` is independent of
 * both: it reports that a stream exceeded `limit`, which fails a synchronous run and does not fail an
 * asynchronous one. A spawn fault reports the host's negative errno for `run`. A spawn fault reports
 * `null` for `runSync`.
 */
export interface RunResult {
	/** The command line that was run, for diagnostics. */
	readonly command: string
	/** The captured standard output, byte-bounded by `limit`. */
	readonly stdout: string
	/** The captured standard error, byte-bounded by `limit`. */
	readonly stderr: string
	/** The exit code. A spawn fault reports the host's negative errno for `run` and `null` for `runSync`. */
	readonly code: number | null
	readonly signal: string | null
	/** True if the run did not complete successfully. */
	readonly failed: boolean
	/** True if the run's `timeout` elapsed before completion. */
	readonly expired: boolean
	/** True if the caller's `signal` aborted the run before completion. */
	readonly aborted: boolean
	/** True if either stream exceeded `limit`, so the captured text is the retained head. */
	readonly truncated: boolean
}

/**
 * The captured bytes and terminal facts one settled {@link RunResult} is built from.
 *
 * @remarks
 * Both byte fields are trimmed to `limit` on a code-point boundary when the result is built, so a
 * caller passes the raw retained head and never a decoded string. `cause` carries the host fault
 * that ended the run, when one did; its presence alone marks the run failed.
 */
export interface RunInput {
	/** The diagnostic command line. */
	readonly command: string
	/** The retained standard-output bytes. */
	readonly stdout: Uint8Array
	/** The retained standard-error bytes. */
	readonly stderr: Uint8Array
	readonly code: number | null
	readonly signal: string | null
	/** If `true`, the run's own timeout elapsed; if `false`, it did not. */
	readonly expired: boolean
	/** If `true`, the caller's signal aborted the run; if `false`, it did not. */
	readonly aborted: boolean
	/** If `true`, a stream exceeded `limit`; if `false`, both fit. */
	readonly truncated: boolean
	/** The maximum retained bytes for each stream. */
	readonly limit: number
	/** The host fault that ended the run, when one did. */
	readonly cause?: unknown
}

/**
 * Options for a one-shot run.
 *
 * @remarks
 * A run is a fire-and-collect function, not a lifecycle entity, so it carries no emitter. `strict`
 * decides how a failure is delivered: by default a non-zero exit rejects with a
 * {@link ProcessError} carrying the {@link RunResult}; `strict: false` resolves with the result
 * instead, so the caller inspects `failed`. An invalid option or command rejects before the child is
 * spawned, with a {@link ProcessError} coded `invalid`. `input` is standard-input payload and carries
 * no NUL restriction. An unbounded run awaits stdio completion rather than process exit, so give
 * `timeout` a value wherever a descendant may inherit the child's stdio and hold the pipe open past
 * the child's own exit.
 */
export interface RunOptions {
	/** The working directory. Default: the current working directory. */
	readonly workspace?: string
	/** Environment overrides merged over the parent environment; an `undefined` value unsets a key. */
	readonly environment?: Readonly<Record<string, string | undefined>>
	/** Standard-input payload written to the child, including any NUL characters. */
	readonly input?: string
	/** Milliseconds before the child is terminated. `0` or omitted disables the timeout. */
	readonly timeout?: number
	/** Cooperative POSIX window between `SIGTERM` and `SIGKILL` when terminating. Default: {@link PROCESS_GRACE}. */
	readonly grace?: number
	/** Aborting this signal terminates the run and reports `aborted`. */
	readonly signal?: AbortSignal
	/** If `false`, resolve with the result on failure instead of rejecting. Default: `true`. */
	readonly strict?: boolean
	/** Maximum captured bytes for stdout and for stderr, each. Default: {@link PROCESS_OUTPUT}. */
	readonly limit?: number
}

/**
 * Options for a synchronous one-shot run.
 *
 * @remarks
 * The synchronous host offers neither a cooperative termination window nor in-flight cancellation,
 * so this contract carries no `grace` and no `signal`. A `timeout` ends only the root process and can
 * leave descendants running; use `run` or {@link ProcessInterface} when timeout must terminate the
 * tree. A `timeout` and an output overflow both end the root with `SIGKILL`; an overflow reports
 * `truncated` and `failed` together, which is where the synchronous and asynchronous runners
 * genuinely differ. `input` is standard-input payload and carries no NUL restriction.
 */
export interface RunSyncOptions {
	/** The working directory. Default: the current working directory. */
	readonly workspace?: string
	/** Environment overrides merged over the parent environment; an `undefined` value unsets a key. */
	readonly environment?: Readonly<Record<string, string | undefined>>
	/** Standard-input payload written to the child, including any NUL characters. */
	readonly input?: string
	/** Milliseconds before the host kills the root process alone. `0` or omitted disables the timeout. */
	readonly timeout?: number
	/** If `false`, return the result on failure instead of throwing. Default: `true`. */
	readonly strict?: boolean
	/** Maximum captured bytes for stdout and for stderr, each. Default: {@link PROCESS_OUTPUT}. */
	readonly limit?: number
}

/**
 * Options for a detached fire-and-forget spawn.
 *
 * @remarks
 * A detached child owns no stdio and is never awaited, so the contract carries only the directory it
 * starts in. Its environment comes from the command's own `environment` and `isolated`.
 */
export interface DetachOptions {
	/** The working directory. Default: the current working directory. */
	readonly workspace?: string
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
 * live children, and its departure emits `exit`. Eviction follows the child's own `exit` promise,
 * which no listener can forge, so it lands one microtask after the child's public `exit` event: a
 * listener on that event still sees the child registered. `launch` throws a {@link ProcessError}
 * coded `duplicate` when the id is already live and `protocol` after `destroy` has begun — spawn
 * faults surface through the returned child's `exit`, not from `launch`. The typed `emitter` carries
 * the `launch` and `exit` moments across every child.
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
	 * @remarks
	 * Every option is read before the child is spawned, so a caller's own option getter runs while
	 * nothing has started and a throw from one strands no process. A getter that begins `destroy`
	 * without throwing is the one remaining race, and it leaves a bounded residual: the child is
	 * already spawned, so the launch is refused with `protocol` and that child is torn down
	 * asynchronously, bounded by `grace` plus the confirmation window. The `destroy` barrier settled
	 * before the refusal, so awaiting it does not cover that teardown.
	 *
	 * @param id - The registry key, unique among live children
	 * @param options - The child construction options
	 * @returns The launched child
	 * @throws A {@link ProcessError} coded `duplicate` when `id` is already live, `protocol` when the registry is being destroyed, or `invalid` when an option or command string is malformed
	 */
	launch(id: string, options: ProcessOptions): ProcessInterface
	/**
	 * Terminate the named children and await their exit.
	 *
	 * @param ids - The registry keys to stop
	 * @returns True when every named child was live and its exit was confirmed; false otherwise
	 */
	stop(ids: readonly string[]): Promise<boolean>
	/**
	 * Terminate one child and await its exit.
	 *
	 * @param id - The registry key to stop
	 * @returns True when the child was live and its exit was confirmed; false when the id was not live or the confirmation deadline elapsed
	 */
	stop(id: string): Promise<boolean>
	/**
	 * Terminate every live child and await their exit.
	 *
	 * @returns A promise that resolves after every child stops
	 */
	stop(): Promise<void>
	/**
	 * Stop every child, then destroy the registry emitter last.
	 *
	 * @remarks
	 * Always resolves, and refuses a later `launch` with a {@link ProcessError} coded `protocol`.
	 * Every child is destroyed, not merely stopped, so each child's own observation emitter is
	 * destroyed too and every subscription on it goes silently inert. The registry emitter is
	 * destroyed last.
	 *
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void>
}

/** The machine-readable {@link ProcessError} categories. */
export type ProcessErrorCode = 'spawn' | 'timeout' | 'duplicate' | 'protocol' | 'invalid'

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
