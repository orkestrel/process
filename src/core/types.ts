import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'
import type { PROCESS_ERROR_CODES } from './constants.js'

/**
 * Declares the public contracts for `@orkestrel/process`: a typed child-process toolkit.
 *
 * @remarks
 * The tiers divide by lifetime:
 *
 * - **{@link ProcessInterface}** — one supervised child with framed stdout lines under a bounded
 *   backlog, a byte-bounded stderr tail, a live stderr event, a writable stdin channel, a typed
 *   lifecycle {@link ProcessEventMap} emitter, and bounded termination. The low-level streaming
 *   primitive.
 * - **{@link SessionInterface}** — the same supervised child observed as raw bytes: an owned
 *   `Uint8Array` per stdout chunk, an open stdin channel closed by `end` rather than by a switch,
 *   the child's own `ending` beside the terminal `exit`, and a typed {@link SessionEventMap}
 *   emitter. The transport primitive, for a child speaking a framed protocol.
 * - **{@link ExecuteResult} / execute** — a one-shot spawn that buffers a child to completion and settles
 *   with its output and exit, the ergonomic layer for fire-and-collect commands.
 * - **{@link ProcessManagerInterface}** — a keyed registry of live {@link ProcessInterface}
 *   children, launched and stopped by id, observed through its own {@link ProcessManagerEventMap}.
 *
 * Every contract here is host-independent (`AbortSignal`, `AsyncIterable`, `Promise`, `Uint8Array`,
 * and plain `string` signal names). The Node implementations live in `@orkestrel/process/server`.
 */

/**
 * Represents one spawnable command: the executable, its argument vector, and optional environment overrides
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
	/** If `true`, exclude the parent environment; if `false` or omitted, the overrides layer over it. On POSIX `true` leaves no `PATH`, while Windows libuv still injects a host set. */
	readonly isolated?: boolean
}

/**
 * Represents the observed terminal state of a child process: its exit code or the signal that ended it, and
 * how its observation ended.
 *
 * @remarks
 * This value exists only at the terminal moment, so every field on it is already final and no
 * consumer can read one too early. `drained` reports whether the diagnostics are complete;
 * {@link ProcessInterface.truncated} reports that the `lines` stream omitted stdout lines. They are
 * independent facts about different streams, and one child reports both when a retention bound
 * dropped lines and the drain bound cut stderr off.
 */
export interface ProcessExit {
	/** Holds the exit code, or `null` when a signal ended the process. A spawn fault reports the host's negative errno for `Process` and `execute`. */
	readonly code: number | null
	/** Holds the terminating signal name, or `null` when the process exited on its own. */
	readonly signal: string | null
	/** Reports how the terminal moment arrived: true when the child's streams closed; false when the `drain` bound elapsed first and later diagnostics may have existed. */
	readonly drained: boolean
}

/**
 * Represents the resolved spawn form of one command: the executable to launch, the argument vector to pass,
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
 * Supplies the lookup inputs for resolving a command file to an executable path.
 *
 * @remarks
 * `workspace` is searched before `PATH`, matching Windows command semantics. `environment` is the
 * child's effective environment, so the lookup reads the same `PATH` and `PATHEXT` the child will.
 */
export interface ExecutableOptions {
	/** Names the directory searched first. Default: the current working directory. */
	readonly workspace?: string
	/** Holds the child's effective environment. Default: the parent process environment. */
	readonly environment?: Readonly<Record<string, string | undefined>>
}

/**
 * Represents the push observation surface of a {@link ProcessInterface} — the moments a fire-and-forget
 * observer subscribes to, alongside the `lines` stream and the `exit` promise.
 *
 * @remarks
 * Declared as a `type` alias so it satisfies the emitter's `EventMap` constraint structurally. The
 * `error` event carries a child fault — a failure to spawn, a process-level error, or a
 * host-reported standard-input channel fault after the constructor input phase. A fault arising
 * from the constructor-supplied `input` write or its closing `end` stays quiet because the package
 * initiated that sequence. A surfaced standard-input fault is wrapped in a
 * {@link ProcessError} coded `protocol` with the host fault as its cause. The event is distinct from
 * the `error` handler in {@link ProcessOptions}: a listener throw is isolated by the emitter and
 * routed to that handler, never emitted as this `error` event.
 */
export type ProcessEventMap = {
	/** Reports a decoded standard-error chunk arrived. */
	readonly stderr: readonly [chunk: string]
	/** Reports a fault from the child or its open standard-input channel, carrying the host cause directly or through a `protocol` {@link ProcessError}. */
	readonly error: readonly [error: unknown]
	/** Reports the child settled — its terminal state, delivered once. */
	readonly exit: readonly [exit: ProcessExit]
}

/**
 * Configures one supervised child process.
 *
 * @remarks
 * `grace` is the cooperative window between `SIGTERM` and `SIGKILL` on a POSIX host; Windows has no
 * cooperative phase, so the value is unused there. There is no completion deadline for a running
 * child: nothing here ends a child that is still working, the `exit` promise carries no deadline of
 * its own, and a caller that wants one arms its own timer and calls `stop`. `drain` does not weaken
 * that. It bounds a single window — between the child's ending and the release of that child's read
 * ends — so it cannot end a running child. The child's native exit arms it, and so does the return
 * of a termination this package initiated through `stop`, `destroy`, or an abort of `signal`; a
 * termination whose confirmation window elapsed can therefore reach the cutoff while the child still
 * runs. The bound exists because a descendant holding an inherited pipe defers the host's stream
 * close for that descendant's whole life, which the package cannot reach and cannot outwait: without
 * the bound, a child that ended would hand the caller an unbounded wait.
 * `backlog` bounds the unconsumed `lines` backlog.
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
	/** Names the working directory the child runs in. */
	readonly workspace: string
	/** Sets the cooperative POSIX window in milliseconds between `SIGTERM` and `SIGKILL`. Default: {@link PROCESS_GRACE}. */
	readonly grace?: number
	/** Sets the milliseconds the package waits for the child's read ends to close after the native exit or an initiated termination, before cutting them off; `0` cuts them off as soon as the bound is armed. Default: {@link PROCESS_DRAIN}. */
	readonly drain?: number
	/** Sets the maximum retained stderr tail in bytes. Default: {@link PROCESS_EVIDENCE}. */
	readonly evidence?: number
	/** Sets the soft high-water mark in bytes for the unconsumed `lines` backlog; termination retains at most twice this value. Default: {@link PROCESS_BACKLOG}. */
	readonly backlog?: number
	/** Sets the milliseconds an unconfirmed {@link ProcessInterface.send} waits before resolving `false`. `0` or omitted disables the bound. */
	readonly delivery?: number
	/** If `true`, stdin stays open for {@link ProcessInterface.send}; if `false` or omitted, stdin closes after any initial `input`. */
	readonly writable?: boolean
	/** Terminates the child through the same bounded `stop` when this signal aborts. */
	readonly signal?: AbortSignal
}

/**
 * Represents one supervised child process with framed output, a bounded backlog, and bounded termination.
 *
 * @remarks
 * `lines` is pumped as soon as the child writes, and it is a single-consumer stream: each line goes
 * to exactly one waiting iterator, so concurrent iterators split the output between them rather
 * than each receiving all of it. The policy for an unconsumed backlog follows consumer intent. After an iterator has been requested, stdout pauses at the `backlog` mark and
 * resumes at half of it, so the consumer loses nothing before termination and the child feels real
 * backpressure. Termination never reapplies the pause, so from the moment a stop begins retention is
 * capped at twice `backlog` and later lines are dropped. While
 * no iterator has ever been requested, stdout keeps draining so `exit` still resolves, and retention
 * stops at the mark: a consumer attaching after that point receives the retained head, a gap, then
 * the live stream. `evidence` is the decoded, byte-bounded stderr tail — the diagnostic to attach to
 * a failed exit. `truncated` reports that the `lines` stream omitted output, because a retention
 * bound was reached; the one-shot `ExecuteResult` carries the same name for the same fact against
 * its own capture `limit`. The typed `emitter` carries the live `stderr` chunks, the child `error` cause, and the
 * terminal `exit`, alongside the `exit` promise. `stop` and `destroy` are idempotent and never reject.
 *
 * The same terminal moment governs every observation surface. It arrives when the child's streams close,
 * or when the `drain` bound armed by the native exit or by a termination this package initiated
 * elapses first, and
 * {@link ProcessExit.drained} reports which. At that moment `evidence` freezes, `lines` ends, `exit`
 * settles, and `settled` turns true — together, so a consumer reading `evidence` and a consumer
 * iterating `lines` never see a different child. `stop`, `destroy`, an abort of the `signal` option,
 * a natural exit, and a spawn fault all reach it.
 *
 * The spawn is eager, so `pid` is fixed by the time construction returns; a spawn that produced no
 * child reports `undefined` for that child's whole lifetime. An assigned id survives the exit and
 * reports no liveness on its own, because the host reuses a dead child's id. Derive liveness as
 * `pid !== undefined && code === null && signal === null`, and derive it again before every use of
 * the id. `code` and `signal` mirror the host child's own terminal record, so they carry the native
 * exit as soon as the host has it, while the `exit` promise settles at the terminal moment — a
 * descendant holding inherited stdio keeps the stream close pending past the native exit, and a
 * supervisor inside that window reads the terminal state here.
 */
export interface ProcessInterface {
	/** Holds the host process id, fixed when construction returns, or `undefined` when the spawn produced none. */
	readonly pid: number | undefined
	/** Holds the exit code the host recorded, or `null` while the child has not exited and when a signal ended it. A spawn fault reports the host's negative errno. */
	readonly code: number | null
	/** Holds the terminating signal name the host recorded, or `null` while the child has not exited and when it exited on its own. */
	readonly signal: string | null
	/** Holds the typed lifecycle observation surface. */
	readonly emitter: EmitterInterface<ProcessEventMap>
	/**
	 * Yields the captured stdout lines, in arrival order, for one consumer, ending at the terminal moment.
	 *
	 * @remarks
	 * A line feed, a CRLF pair, and a bare carriage return each terminate a line, and a CRLF split
	 * across delivered chunks joins as one break. A child that redraws a progress bar with a carriage
	 * return therefore yields one line per redraw, and consecutive carriage returns yield an empty
	 * line between them. A final line written with no trailing terminator is delivered when stdout
	 * closes.
	 *
	 * The stream ends at the terminal moment rather than throwing there, so teardown is not an error
	 * path: a pending `next()` resolves `done: true` and a `for await` loop exits normally. Lines
	 * already framed and queued are delivered before that end, so a consumer that stops a chatty
	 * child still reads what the child had produced, and only bytes that would have arrived after the
	 * terminal moment are lost — whether that moment came from the read ends closing, from the
	 * `drain` bound after a native exit, or from a requested termination. An unframed trailing partial
	 * written before an undrained cutoff is not promised, because only the stream's own end flushes
	 * one. A read started after the end yields nothing further.
	 */
	readonly lines: AsyncIterable<string>
	/**
	 * Holds the decoded byte-bounded stderr tail.
	 *
	 * @remarks
	 * The live tail before the terminal moment and the frozen value after it, on every path — a
	 * natural exit, `stop`, `destroy`, an abort of the `signal` option, and a spawn fault. Every read
	 * after that moment returns the same string, so a consumer needs no private copy and cannot
	 * observe the tail moving under it. When {@link ProcessExit.drained} is false the frozen value is
	 * the tail as of the cutoff, and later diagnostics may have existed.
	 */
	readonly evidence: string
	/** Reports whether the `lines` stream omitted output because a retention bound was reached. */
	readonly truncated: boolean
	/**
	 * Reports whether the `exit` promise settled.
	 *
	 * @remarks
	 * The terminal moment has arrived: `evidence` is frozen, `lines` has ended, and the
	 * {@link ProcessExit} value exists. Reached on every path, including a spawn that produced no
	 * child.
	 */
	readonly settled: boolean
	/**
	 * Reports whether a termination began.
	 *
	 * @remarks
	 * Monotonic. It turns true when `stop`, `destroy`, or an abort of the `signal` option begins a
	 * termination, and it stays true from then on, including after `settled` turns true. It reports
	 * that a termination was initiated, not that one is in flight, because the initiation is the fact
	 * a consumer acts on: a child that was asked to end is not a child to send new work to. A child
	 * that exited on its own reports `false` here with `settled` true.
	 */
	readonly stopping: boolean
	/**
	 * Settles with the terminal child state, delivered once.
	 *
	 * @remarks
	 * Never rejects. It settles at the terminal moment: when the child's streams close, or when the
	 * `drain` bound elapsed first. The native exit arms that bound as well as an initiated
	 * termination, so a child nobody terminates still settles it within `drain` of ending.
	 */
	readonly exit: Promise<ProcessExit>
	/**
	 * Writes one line to the open standard-input channel.
	 *
	 * @remarks
	 * Never rejects. `true` means the host accepted the bytes without reporting a fault; it does not
	 * prove that the child read them. An ordinary write settles when the kernel accepts it. Only a
	 * full pipe can hold the write unconfirmed. The `delivery` option can bound that wait, and every
	 * terminal teardown path settles pending writes. On Windows 11 with Node v24.18.1, measured on
	 * 2026-08-21, a child that closes its own file descriptor 0 can leave the parent pipe writable:
	 * the write can settle `true` without a callback error or a stream error while the child remains
	 * alive. After `stop` or `destroy` begins, a later call settles `false`. Version 0.0.4 could settle
	 * that call `true` before teardown destroyed the pipe; returning `false` avoids claiming delivery
	 * for bytes the package is about to discard.
	 *
	 * @param text - The line text without its trailing newline
	 * @returns True if the host accepted the bytes without reporting a fault; false otherwise (the channel was closed, destroyed, ended, failed, or the write remained unconfirmed through `delivery`)
	 */
	send(text: string): Promise<boolean>
	/**
	 * Terminates the child process tree, awaits its observed exit, and reaches the terminal moment.
	 *
	 * @remarks
	 * Never rejects. On Windows the whole tree is killed immediately through `taskkill`, with a
	 * direct kill as the fallback; on a POSIX host the process group receives `SIGTERM`, then
	 * `SIGKILL` after `grace`. No signal is initiated after the child's native exit is observed; the
	 * window between initiating a signal and the host delivering it belongs to the operating system.
	 *
	 * Observation ends here as well as under `destroy`, bounded by `drain`: `evidence` freezes,
	 * `lines` ends, and `exit` settles. A caller that stops a child and keeps reading it therefore
	 * reaches the end of the stream instead of waiting on a child it already ended, and needs no
	 * second call to release it.
	 *
	 * @returns True if the child's native exit was observed; false otherwise (the confirmation deadline elapsed without it)
	 */
	stop(): Promise<boolean>
	/**
	 * Stops the child, closes its standard-input channel, reaches the terminal moment, and destroys the
	 * observation emitter.
	 *
	 * @remarks
	 * Always resolves, including when termination was never confirmed. The barrier settles after the
	 * terminal moment, so `evidence` is frozen, `lines` has ended, and `exit` has settled by the time
	 * a caller resumes. The wait for the child's streams is bounded by `drain`, so a descendant
	 * holding an inherited pipe cannot hold this barrier open, and {@link ProcessExit.drained} reports
	 * which way the moment arrived. The emitter is destroyed after the frozen state exists, so a
	 * consumer watching the `stderr` event and a consumer reading `evidence` end on the same bytes.
	 *
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void>
}

/**
 * Represents the push observation surface of a {@link SessionInterface} — the moments a byte-oriented observer
 * subscribes to, alongside the `ending` and `exit` promises.
 *
 * @remarks
 * Declared as a `type` alias so it satisfies the emitter's `EventMap` constraint structurally.
 *
 * `stdout` carries one owned `Uint8Array` per chunk the host delivered, in arrival order, framed by
 * nothing and decoded by nothing. The array is the session's own copy and a plain `Uint8Array`
 * rather than the host buffer the read produced, so a consumer keeps it, mutates it, concatenates
 * it, and reads its whole backing buffer without reaching memory the host still manages and without
 * depending on a host type. A chunk boundary is the host's, so one event is not one message and a
 * line feed inside a payload starts no new event; a consumer that needs messages frames the
 * concatenated bytes itself.
 *
 * `stderr` carries decoded text instead, because a diagnostic stream is read rather than parsed, and
 * {@link SessionInterface.evidence} bounds those same bytes. The `error` event carries a child fault
 * — a failure to spawn, a process-level error, or a host-reported standard-input channel fault. A
 * surfaced standard-input fault is wrapped in a {@link ProcessError} coded `protocol` with the host
 * fault as its cause. The event is distinct from the `error` handler in {@link SessionOptions}: a
 * listener throw is isolated by the emitter and routed to that handler, never emitted as this
 * `error` event.
 */
export type SessionEventMap = {
	/** Reports a standard-output chunk arrived, as an owned `Uint8Array` the consumer may keep and mutate. */
	readonly stdout: readonly [chunk: Uint8Array]
	/** Reports a decoded standard-error chunk arrived. */
	readonly stderr: readonly [chunk: string]
	/** Reports a fault from the child or its open standard-input channel, carrying the host cause directly or through a `protocol` {@link ProcessError}. */
	readonly error: readonly [error: unknown]
	/** Reports the child settled — its terminal state, delivered once. */
	readonly exit: readonly [exit: ProcessExit]
}

/**
 * Configures one raw byte session over a supervised child.
 *
 * @remarks
 * This is {@link ProcessOptions} without `backlog` and without `writable`. A session frames nothing
 * and retains no lines, so no backlog bound applies to it; its standard-input channel is open from
 * the spawn until {@link SessionInterface.end}, so no switch selects whether one exists. `grace`,
 * `drain`, `evidence`, `delivery`, and `signal` carry the meanings {@link ProcessOptions} documents
 * for them, and `command.input` is still written immediately after the spawn. `on` installs initial
 * {@link SessionEventMap} listeners and `error` receives isolated listener failures.
 *
 * Every option and command property is read once, before the child is spawned, so a caller's own
 * getter runs while nothing has started and a getter that throws strands no process. Every numeric
 * option is validated in that same window: a timer value outside `[0, PROCESS_TIMER]`, or a negative
 * or fractional byte value, throws a {@link ProcessError} coded `invalid` before anything is
 * spawned.
 */
export interface SessionOptions {
	readonly on?: EmitterHooks<SessionEventMap>
	readonly error?: EmitterErrorHandler
	readonly command: ProcessCommand
	/** Names the working directory the child runs in. */
	readonly workspace: string
	/** Sets the cooperative POSIX window in milliseconds between `SIGTERM` and `SIGKILL`. Default: {@link PROCESS_GRACE}. */
	readonly grace?: number
	/** Sets the milliseconds the package waits for the child's read ends to close after the native exit or an initiated termination, before cutting them off; `0` cuts them off as soon as the bound is armed. Default: {@link PROCESS_DRAIN}. */
	readonly drain?: number
	/** Sets the maximum retained stderr tail in bytes. Default: {@link PROCESS_EVIDENCE}. */
	readonly evidence?: number
	/** Sets the milliseconds an unconfirmed {@link SessionInterface.write} waits before resolving `false`. `0` or omitted disables the bound. */
	readonly delivery?: number
	/** Terminates the child through the same bounded `stop` when this signal aborts. */
	readonly signal?: AbortSignal
}

/**
 * Represents one supervised child process read as raw bytes, with an open standard-input channel and bounded
 * termination.
 *
 * @remarks
 * A session is the transport face of the same supervision {@link ProcessInterface} exposes. It
 * publishes the child's standard output as `stdout` events carrying owned bytes rather than framed
 * lines, so a consumer speaking a length-prefixed or delimiter-framed protocol reads the bytes the
 * child wrote and frames them itself. Nothing here retains output: a session holds no backlog and
 * pauses nothing, so it omits `lines`, `truncated`, `backlog`, and `send` rather than reporting them
 * as facts that do not apply. `evidence` is the decoded, byte-bounded stderr tail — the diagnostic to
 * attach to a failed exit — and the typed `emitter` carries the live `stdout` and `stderr` payloads,
 * the child `error` cause, and the terminal `exit`.
 *
 * **Two endings, named apart.** `ending` settles at the child's own native exit and resolves no
 * value, because `code` and `signal` already carry the terminal facts as soon as the host records
 * them. `exit` settles at the terminal moment, which is the native exit plus at most `drain` when a
 * descendant that inherited the child's stdio still holds the read ends open. A caller racing a
 * cooperative shutdown window therefore awaits `ending`, and a caller collecting the final
 * observation awaits `exit`. `settled`, the `exit` event, and `evidence` freezing all name that same
 * terminal moment, exactly as they do on {@link ProcessInterface}.
 *
 * **`end` is not a termination.** It closes the standard-input channel and leaves the child running,
 * which is how a cooperative protocol asks a child to finish its own work. `stop` and `destroy` are
 * the terminations, they are idempotent, and none of the three rejects.
 *
 * The spawn is eager, so `pid` is fixed by the time construction returns; a spawn that produced no
 * child reports `undefined` for that child's whole lifetime. An assigned id survives the exit and
 * reports no liveness on its own, because the host reuses a dead child's id. Derive liveness as
 * `pid !== undefined && code === null && signal === null`, and derive it again before every use of
 * the id.
 */
export interface SessionInterface {
	/** Holds the host process id, fixed when construction returns, or `undefined` when the spawn produced none. */
	readonly pid: number | undefined
	/** Holds the exit code the host recorded, or `null` while the child has not exited and when a signal ended it. A spawn fault reports the host's negative errno. */
	readonly code: number | null
	/** Holds the terminating signal name the host recorded, or `null` while the child has not exited and when it exited on its own. */
	readonly signal: string | null
	/** Holds the typed lifecycle observation surface. */
	readonly emitter: EmitterInterface<SessionEventMap>
	/**
	 * Holds the decoded byte-bounded stderr tail.
	 *
	 * @remarks
	 * The live tail before the terminal moment and the frozen value after it, on every path — a
	 * natural exit, `stop`, `destroy`, an abort of the `signal` option, and a spawn fault. Every read
	 * after that moment returns the same string. When {@link ProcessExit.drained} is false the frozen
	 * value is the tail as of the cutoff, and later diagnostics may have existed.
	 */
	readonly evidence: string
	/**
	 * Reports whether the `exit` promise settled.
	 *
	 * @remarks
	 * The terminal moment has arrived: `evidence` is frozen, no further `stdout` or `stderr` event
	 * fires, and the {@link ProcessExit} value exists. Reached on every path, including a spawn that
	 * produced no child.
	 */
	readonly settled: boolean
	/**
	 * Reports whether a termination began.
	 *
	 * @remarks
	 * Monotonic. It turns true when `stop`, `destroy`, or an abort of the `signal` option begins a
	 * termination, and it stays true from then on, including after `settled` turns true. `end` never
	 * turns it true, because closing the input channel terminates nothing. A child that exited on its
	 * own reports `false` here with `settled` true.
	 */
	readonly stopping: boolean
	/**
	 * Settles at the child's own ending, awaited without the terminal moment's drain window.
	 *
	 * @remarks
	 * Never rejects, and resolves no value: `code` and `signal` carry the terminal facts as soon as
	 * the host records them, so a second copy of those facts here could only drift from them. It
	 * settles at the native exit, and at the terminal moment for a spawn that produced no native exit
	 * at all, so it can never outlive the supervision. Await this rather than `exit` when a
	 * cooperative shutdown window is racing the child's own exit: `exit` waits out `drain` for a
	 * descendant holding the pipe, and a caller racing that promise escalates against a child that
	 * already ended.
	 */
	readonly ending: Promise<void>
	/**
	 * Settles with the terminal child state, delivered once.
	 *
	 * @remarks
	 * Never rejects. It settles at the terminal moment: when the child's streams close, or when the
	 * `drain` bound elapsed first. The native exit arms that bound as well as an initiated
	 * termination, so a child nobody terminates still settles it within `drain` of ending.
	 */
	readonly exit: Promise<ProcessExit>
	/**
	 * Writes raw bytes to the open standard-input channel.
	 *
	 * @remarks
	 * Never rejects, and adds no framing: the bytes reach the child exactly as given, with no
	 * terminator appended, so a caller speaking a framed protocol composes its own header and
	 * delimiter. `true` means the host accepted the bytes without reporting a fault; it does not
	 * prove that the child read them. An ordinary write settles when the kernel accepts it, and only
	 * a full pipe can hold one unconfirmed, which the `delivery` option bounds.
	 *
	 * It resolves `false` without throwing when the channel was closed by `end`, destroyed by a
	 * termination, failed, or left the write unconfirmed through `delivery`, and when `stop` or
	 * `destroy` has begun, because teardown cannot confirm delivery for bytes it is about to discard.
	 *
	 * The host can queue the payload, so treat the array as owned by the channel until the returned
	 * promise settles: bytes mutated inside that window are the bytes the child receives.
	 *
	 * @param bytes - The payload to write, already framed by the caller
	 * @returns True if the host accepted the bytes without reporting a fault; false otherwise (the channel was closed, destroyed, ended, failed, or the write remained unconfirmed through `delivery`)
	 */
	write(bytes: Uint8Array): Promise<boolean>
	/**
	 * Closes the standard-input channel and leaves the child running.
	 *
	 * @remarks
	 * Never rejects, and terminates nothing: `stopping` stays false, no signal is sent, no drain
	 * window is armed, and the terminal moment does not arrive. The child observes end of input, which
	 * is how a cooperative protocol asks it to finish and exit on its own; await `ending` for that
	 * exit and `stop` when it does not come.
	 *
	 * Every call shares one barrier, and it resolves after the host flushes the writes it had already
	 * accepted. That flush carries no bound of its own: a child that stops reading its input leaves
	 * the accepted bytes in the pipe, and the barrier stays pending for as long as they sit there. A
	 * caller that needs a bound races this promise against a window of its own rather than awaiting it
	 * bare. A `write` after this call resolves `false`, because the channel is no longer writable.
	 * The closed channel then stays quiet for its remaining life: a later host fault on it settles
	 * pending writes and emits no `error` event. After `stop` or `destroy` has begun the call resolves
	 * and changes nothing.
	 *
	 * @returns The stable barrier shared by every call
	 */
	end(): Promise<void>
	/**
	 * Terminates the child process tree, awaits its observed exit, and reaches the terminal moment.
	 *
	 * @remarks
	 * Never rejects. On Windows the whole tree is killed immediately through `taskkill`, with a
	 * direct kill as the fallback; on a POSIX host the process group receives `SIGTERM`, then
	 * `SIGKILL` after `grace`. No signal is initiated after the child's native exit is observed.
	 *
	 * Observation ends here as well as under `destroy`, bounded by `drain`: `evidence` freezes, the
	 * `stdout` and `stderr` events stop, and `exit` settles. A caller that stops a child and keeps
	 * listening therefore reaches the end of the stream and needs no second call to release it.
	 *
	 * @returns True if the child's native exit was observed; false otherwise (the confirmation deadline elapsed without it)
	 */
	stop(): Promise<boolean>
	/**
	 * Stops the child, closes its standard-input channel, reaches the terminal moment, and destroys the
	 * observation emitter.
	 *
	 * @remarks
	 * Always resolves, including when termination was never confirmed. The barrier settles after the
	 * terminal moment, so `evidence` is frozen and `exit` has settled by the time a caller resumes.
	 * The wait for the child's streams is bounded by `drain`, so a descendant holding an inherited
	 * pipe cannot hold this barrier open, and {@link ProcessExit.drained} reports which way the moment
	 * arrived. The emitter is destroyed after the frozen state exists, so a consumer watching the
	 * `stderr` event and a consumer reading `evidence` end on the same bytes.
	 *
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void>
}

/**
 * Represents the settled outcome of a one-shot run: the buffered output and the terminal state.
 *
 * @remarks
 * `failed` is `true` when the run timed out, was aborted, ended on a host fault, was ended by a
 * signal, or exited with a code other than `0`. `expired` and `aborted` name the ways the run ended
 * the child rather than the child ending itself, and only the earliest observed is recorded.
 * `truncated` reports that a captured stream omitted output because it exceeded `limit`, which
 * fails a synchronous run and does not fail an asynchronous one. `ProcessInterface` carries the
 * same name for the same fact against a supervised child's retention bounds. For a `strict: false`
 * caller, `failed: true` with `expired`, `aborted`, and `truncated` false, `code: 0`, and
 * `signal: null` is the residual signature that a host fault ended the run. A spawn fault reports
 * the host's negative errno for `execute`. A spawn fault reports `null` for `executeSync`.
 */
export interface ExecuteResult {
	/** Holds the command line that was run, for diagnostics. */
	readonly command: string
	/** Holds the captured standard output, byte-bounded by `limit`. */
	readonly stdout: string
	/** Holds the captured standard error, byte-bounded by `limit`. */
	readonly stderr: string
	/** Holds the exit code. A spawn fault reports the host's negative errno for `execute` and `null` for `executeSync`. */
	readonly code: number | null
	/** Holds the terminating signal name, or `null` when the process exited on its own. */
	readonly signal: string | null
	/** Reports whether the run failed to complete successfully. */
	readonly failed: boolean
	/** Reports whether the run's `timeout` elapsed before completion. */
	readonly expired: boolean
	/** Reports whether the caller's `signal` aborted the run before completion. */
	readonly aborted: boolean
	/** Reports whether either captured stream omitted output because it exceeded `limit`. */
	readonly truncated: boolean
}

/**
 * Represents the captured bytes and terminal facts one settled {@link ExecuteResult} is built from.
 *
 * @remarks
 * Each byte field is trimmed to `limit` on a code-point boundary when the result is built, so a
 * caller passes the raw retained head and never a decoded string. `cause` carries the host fault
 * that ended the run, when one did; its presence alone marks the run failed.
 */
export interface ExecuteInput {
	/** Holds the diagnostic command line. */
	readonly command: string
	/** Holds the retained standard-output bytes. */
	readonly stdout: Uint8Array
	/** Holds the retained standard-error bytes. */
	readonly stderr: Uint8Array
	/** Holds the exit code. A spawn fault reports the host's negative errno for `execute` and `null` for `executeSync`. */
	readonly code: number | null
	/** Holds the terminating signal name, or `null` when the process exited on its own. */
	readonly signal: string | null
	/** If `true`, the run's own timeout elapsed; if `false`, it did not. */
	readonly expired: boolean
	/** If `true`, the caller's signal aborted the run; if `false`, it did not. */
	readonly aborted: boolean
	/** If `true`, a stream exceeded `limit`; if `false`, neither did. */
	readonly truncated: boolean
	/** Sets the maximum retained bytes for each stream. */
	readonly limit: number
	/** Carries the host fault that ended the run, when one did. */
	readonly cause?: unknown
}

/**
 * Configures a one-shot run.
 *
 * @remarks
 * A run is a fire-and-collect function, not a lifecycle entity, so it carries no emitter. `strict`
 * decides how a failure is delivered: by default a non-zero exit rejects with a
 * {@link ProcessError} carrying the {@link ExecuteResult}; `strict: false` resolves with the result
 * instead, so the caller inspects `failed`. An invalid option or command rejects before the child is
 * spawned, with a {@link ProcessError} coded `invalid`. `input` is standard-input payload and carries
 * no NUL restriction. An unbounded run awaits stdio completion rather than process exit, so give
 * `timeout` a value wherever a descendant may inherit the child's stdio and hold the pipe open past
 * the child's own exit. Every option is read once, before the child is spawned, so the value
 * validated is the value spawned and a caller's own getter runs while nothing has started: a getter
 * that throws strands no process.
 */
export interface ExecuteOptions {
	/** Names the working directory. Default: the current working directory. */
	readonly workspace?: string
	/** Holds environment overrides merged over the parent environment; an `undefined` value unsets a key. */
	readonly environment?: Readonly<Record<string, string | undefined>>
	/** Holds the standard-input payload written to the child, including any NUL characters. */
	readonly input?: string
	/** Sets the milliseconds before the child is terminated. `0` or omitted disables the timeout. */
	readonly timeout?: number
	/** Sets the cooperative POSIX window between `SIGTERM` and `SIGKILL` when terminating. Default: {@link PROCESS_GRACE}. */
	readonly grace?: number
	/** Terminates the run and reports `aborted` when this signal aborts. */
	readonly signal?: AbortSignal
	/** If `true`, reject on failure; if `false`, resolve with the result instead. Default: `true`. */
	readonly strict?: boolean
	/** Sets the maximum captured bytes for stdout and for stderr, each. Default: {@link PROCESS_OUTPUT}. */
	readonly limit?: number
}

/**
 * Configures a synchronous one-shot run.
 *
 * @remarks
 * The synchronous host offers neither a cooperative termination window nor in-flight cancellation,
 * so this contract carries no `grace` and no `signal`. A `timeout` ends only the root process and can
 * leave descendants running; use `execute` or {@link ProcessInterface} when timeout must terminate the
 * tree. A `timeout` and an output overflow both end the root with `SIGKILL`; an overflow reports
 * `truncated` and `failed` together, which is where `execute` and `executeSync` genuinely differ.
 * `input` is standard-input payload and carries no NUL restriction.
 */
export interface ExecuteSyncOptions {
	/** Names the working directory. Default: the current working directory. */
	readonly workspace?: string
	/** Holds environment overrides merged over the parent environment; an `undefined` value unsets a key. */
	readonly environment?: Readonly<Record<string, string | undefined>>
	/** Holds the standard-input payload written to the child, including any NUL characters. */
	readonly input?: string
	/** Sets the milliseconds before the host kills the root process alone. `0` or omitted disables the timeout. */
	readonly timeout?: number
	/** If `true`, throw on failure; if `false`, return the result instead. Default: `true`. */
	readonly strict?: boolean
	/** Sets the maximum captured bytes for stdout and for stderr, each. Default: {@link PROCESS_OUTPUT}. */
	readonly limit?: number
}

/**
 * Configures a detached fire-and-forget spawn.
 *
 * @remarks
 * A detached child owns no stdio and is never awaited, so the contract carries only the directory it
 * starts in. Its environment comes from the command's own `environment` and `isolated`.
 */
export interface DetachOptions {
	/** Names the working directory. Default: the current working directory. */
	readonly workspace?: string
}

/**
 * Represents the push observation surface of a {@link ProcessManagerInterface} — the fleet-level moments a
 * fire-and-forget observer subscribes to.
 *
 * @remarks
 * Declared as a `type` alias so it satisfies the emitter's `EventMap` constraint structurally.
 */
export type ProcessManagerEventMap = {
	/** Reports a child launched under its id. */
	readonly launch: readonly [id: string]
	/** Reports a child settled and left the registry — its id and terminal state. */
	readonly exit: readonly [id: string, exit: ProcessExit]
}

/**
 * Configures a {@link ProcessManagerInterface}.
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
 * Represents a keyed registry of live supervised child processes.
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
	/** Holds the typed fleet-level observation surface. */
	readonly emitter: EmitterInterface<ProcessManagerEventMap>
	/** Counts the live children. */
	readonly count: number
	/**
	 * Returns the live child under `id`, or `undefined` when none is.
	 *
	 * @param id - The registry key
	 * @returns The child, or `undefined`
	 */
	process(id: string): ProcessInterface | undefined
	/**
	 * Returns a snapshot of every live child.
	 *
	 * @returns The live children in launch order
	 */
	processes(): readonly ProcessInterface[]
	/**
	 * Spawns and registers one child under `id`.
	 *
	 * @remarks
	 * Every option is read before the child is spawned, so a caller's own option getter runs while
	 * nothing has started and a throw from one strands no process. A getter that begins `destroy`
	 * without throwing is the one remaining race: the child is already spawned, so the launch is
	 * refused with `protocol` and that child is destroyed rather than adopted, its teardown bounded
	 * by `grace` plus the confirmation window. The `protocol` refusal throws synchronously, and the
	 * `destroy` barrier covers that teardown, so the refused child reaches its terminal moment before
	 * the barrier resolves.
	 *
	 * @param id - The registry key, unique among live children
	 * @param options - The child construction options
	 * @returns The launched child
	 * @throws A {@link ProcessError} coded `duplicate` when `id` is already live, `protocol` when the registry is being destroyed, or `invalid` when an option or command string is malformed
	 */
	launch(id: string, options: ProcessOptions): ProcessInterface
	/**
	 * Terminates the named children and awaits their exit.
	 *
	 * @param ids - The registry keys to stop
	 * @returns True if every named child was live and its exit was confirmed; false otherwise
	 */
	stop(ids: readonly string[]): Promise<boolean>
	/**
	 * Terminates one child and awaits its exit.
	 *
	 * @param id - The registry key to stop
	 * @returns True if the child was live and its exit was confirmed; false otherwise (the id was not live, or the confirmation deadline elapsed)
	 */
	stop(id: string): Promise<boolean>
	/**
	 * Terminates every live child and awaits their exit.
	 *
	 * @returns A promise that resolves after every child stops
	 */
	stop(): Promise<void>
	/**
	 * Stops every child, then destroys the registry emitter last.
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

/** Names the machine-readable {@link ProcessError} categories, derived from {@link PROCESS_ERROR_CODES}. */
export type ProcessErrorCode = (typeof PROCESS_ERROR_CODES)[number]

/** Represents structured context carried by a {@link ProcessError}. */
export interface ProcessErrorContext {
	/** Names the registry id involved, for a manager failure. */
	readonly id?: string
	/** Names the command line involved, for a run or spawn failure. */
	readonly command?: string
	/** Holds the child's exit code, when one was observed. */
	readonly code?: number | null
	/** Names the terminating signal, when one ended the child. */
	readonly signal?: string | null
	/** Carries the rejected public input, for an input-validation failure. */
	readonly value?: unknown
}

/** Configures a {@link ProcessError}. */
export interface ProcessErrorOptions {
	/** Names the stable machine-readable category. */
	readonly code: ProcessErrorCode
	/** Carries structured detail about the failure. */
	readonly context?: ProcessErrorContext
	/** Carries the underlying cause, when one exists. */
	readonly cause?: unknown
	/** Carries the buffered run outcome, present when an {@link ExecuteResult} produced the failure. */
	readonly result?: ExecuteResult
}
