import type { EmitterInterface } from '@orkestrel/emitter'
import type { ProcessExit, SessionEventMap, SessionInterface, SessionOptions } from '@src/core'
import { Buffer } from 'node:buffer'
import { Emitter } from '@orkestrel/emitter'
import { Supervisor } from './Supervisor.js'

/**
 * Supervises one child and publishes its standard output as raw bytes.
 *
 * @remarks
 * This is the transport face of the supervision engine `Process` also composes. It frames nothing,
 * retains nothing, and decodes nothing on the output side: every chunk the host delivers becomes one
 * `stdout` event carrying that chunk's bytes, in arrival order, so a consumer speaking a
 * length-prefixed or delimiter-framed protocol reads exactly what the child wrote and frames it
 * itself. Standard error is decoded and forwarded as `stderr`, with the same byte-bounded `evidence`
 * tail a `Process` retains, because a diagnostic stream is read rather than parsed.
 *
 * Each emitted chunk is this session's own copy. The host reads into a pooled buffer and hands out a
 * view of it, so publishing that view would expose bytes the pool holds for unrelated reads and would
 * keep the whole pool alive for as long as any consumer kept one chunk. Copying is what makes the
 * payload the consumer's to retain, concatenate, and mutate.
 *
 * The standard-input channel is open from the spawn, and `end` closes it without terminating
 * anything. That is the member a cooperative protocol reaches for: the child observes end of input
 * and exits on its own, which `ending` reports. `stop` and `destroy` remain the terminations, and
 * `exit` remains the terminal moment — the native exit plus at most `drain` while a descendant holds
 * the inherited read ends.
 *
 * @example
 * ```ts
 * import { Session } from '@orkestrel/process/server'
 *
 * const session = new Session({
 * 	command: { file: 'node', arguments: ['-e', 'process.stdin.pipe(process.stdout)'] },
 * 	workspace: process.cwd(),
 * })
 * ```
 */
export class Session implements SessionInterface {
	readonly #emitter: Emitter<SessionEventMap>
	readonly #engine: Supervisor
	readonly #output: (chunk: unknown) => void

	/**
	 * Spawn one child process and begin byte capture.
	 *
	 * @param options - Command, workspace, termination, evidence, stdin, and observation settings
	 * @throws A {@link ProcessError} coded `invalid` when an option or command string is malformed
	 */
	constructor(options: SessionOptions) {
		// Every option is read once, here, before the engine reads the command and spawns anything.
		// Reading a property runs the caller's own getter, so a read after the spawn would let that
		// getter throw while a live child exists and nobody holds a reference to it. The engine
		// receives the plain values below and validates each one before it spawns, so an invalid
		// option and a throwing getter alike refuse construction while nothing has started.
		const command = options.command
		const workspace = options.workspace
		const grace = options.grace
		const drain = options.drain
		const evidence = options.evidence
		const delivery = options.delivery
		const signal = options.signal
		const on = options.on
		const error = options.error
		this.#emitter = new Emitter<SessionEventMap>({
			...(on === undefined ? {} : { on }),
			...(error === undefined ? {} : { error }),
		})
		this.#output = this.#publish.bind(this)
		this.#engine = new Supervisor(
			{
				command,
				workspace,
				// The channel stays open from the spawn until `end` closes it, so a session selects
				// nothing here and declares no `writable` option of its own.
				writable: true,
				...(grace === undefined ? {} : { grace }),
				...(drain === undefined ? {} : { drain }),
				...(evidence === undefined ? {} : { evidence }),
				...(delivery === undefined ? {} : { delivery }),
				...(signal === undefined ? {} : { signal }),
			},
			{
				chunk: this.#reportStderr.bind(this),
				fault: this.#reportFault.bind(this),
				close: this.#closeOutput.bind(this),
				terminal: this.#reportExit.bind(this),
				teardown: this.#emitter.destroy.bind(this.#emitter),
			},
		)
		// The host delivers no output before this synchronous constructor returns, so the consumer
		// attaches here without losing a byte the engine already spawned for. Attaching is also what
		// puts stdout in flowing mode, which is what a session wants: it retains nothing, and a paused
		// stream would hold the child's own write and therefore its exit.
		this.#engine.stdout.on('data', this.#output)
	}

	/** The host process id, fixed when construction returns, or `undefined` when the spawn produced none. */
	get pid(): number | undefined {
		return this.#engine.pid
	}

	/** The exit code the host recorded, or `null` while the child has not exited and when a signal ended it. */
	get code(): number | null {
		return this.#engine.code
	}

	/** The terminating signal name the host recorded, or `null` while the child has not exited and when it exited on its own. */
	get signal(): string | null {
		return this.#engine.signal
	}

	/** The typed lifecycle observation surface. */
	get emitter(): EmitterInterface<SessionEventMap> {
		return this.#emitter
	}

	/** The decoded byte-bounded stderr tail, frozen at the terminal moment. */
	get evidence(): string {
		return this.#engine.evidence
	}

	/** True after the terminal moment arrived and `exit` settled. */
	get settled(): boolean {
		return this.#engine.settled
	}

	/** True after termination began, including after the terminal moment. `end` never turns it true. */
	get stopping(): boolean {
		return this.#engine.stopping
	}

	/** The child's own ending, awaited without the terminal moment's drain window. */
	get ending(): Promise<void> {
		return this.#engine.ending
	}

	/** The terminal child state, observed once after stream close or the drain cutoff. */
	get exit(): Promise<ProcessExit> {
		return this.#engine.exit
	}

	/**
	 * Writes raw bytes to the open standard-input channel.
	 *
	 * @remarks
	 * Never rejects, and appends no terminator: the child receives exactly these bytes. `true` means
	 * the host accepted them without reporting a fault; it does not prove that the child read them.
	 * The channel can queue the payload, so treat the array as owned by the channel until the
	 * returned promise settles.
	 *
	 * @param bytes - The payload to write, already framed by the caller
	 * @returns True when the host accepted the bytes without reporting a fault; false when the channel was closed, destroyed, ended, failed, or remained unconfirmed through `delivery`
	 */
	write(bytes: Uint8Array): Promise<boolean> {
		return this.#engine.deliver(bytes)
	}

	/**
	 * Closes the standard-input channel and leaves the child running.
	 *
	 * @remarks
	 * Never rejects and terminates nothing: `stopping` stays false and the terminal moment does not
	 * arrive. Every call shares one barrier, which resolves after the host flushes the writes it had
	 * already accepted. A later `write` resolves `false`.
	 *
	 * @returns The stable barrier shared by every call
	 */
	end(): Promise<void> {
		return this.#engine.end()
	}

	/**
	 * Terminates the child process tree and reaches the terminal observation moment.
	 *
	 * @remarks
	 * Never rejects, and every call shares one termination bounded by `grace` and `drain`.
	 *
	 * @returns True when the child's native exit was observed; false when the confirmation deadline elapsed without it
	 */
	stop(): Promise<boolean> {
		return this.#engine.stop()
	}

	/**
	 * Stops the child and destroys the observation emitter after the terminal state freezes.
	 *
	 * @remarks
	 * Always resolves, including when termination was never confirmed. Every call shares one barrier.
	 *
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void> {
		return this.#engine.destroy()
	}

	// One owned copy per host chunk, taken before the payload leaves this class. The settled check is
	// the second half of the same guarantee: the engine hands over its terminal moment before it
	// destroys the read ends, so nothing this stream still holds can arrive after the `exit` event.
	#publish(chunk: unknown): void {
		if (!Buffer.isBuffer(chunk) || this.#engine.settled) return
		this.#emitter.emit('stdout', new Uint8Array(chunk))
	}

	// The engine publishes nothing itself, so each moment it hands over is republished here on this
	// face's own typed event map. A generic `emit` cannot be bound to one event without collapsing
	// its payload to the first member of the map.
	#reportStderr(chunk: string): void {
		this.#emitter.emit('stderr', chunk)
	}

	#reportFault(cause: unknown): void {
		this.#emitter.emit('error', cause)
	}

	#reportExit(exit: ProcessExit): void {
		this.#emitter.emit('exit', exit)
	}

	// Releasing the consumer at the terminal moment, rather than letting the engine's stream
	// destruction reach it, is what keeps a `stdout` event from following the `exit` event.
	#closeOutput(): void {
		this.#engine.stdout.off('data', this.#output)
	}
}
