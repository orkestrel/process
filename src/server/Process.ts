import type { Interface as ReadLineInterface } from 'node:readline'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { ProcessEventMap, ProcessExit, ProcessInterface, ProcessOptions } from '@src/core'
import { Buffer } from 'node:buffer'
import { createInterface } from 'node:readline'
import { Emitter } from '@orkestrel/emitter'
import { PROCESS_BACKLOG } from '@src/core'
import { snapshotCommand } from './cloners.js'
import { validateBytes, validateCommand, validateTimer, validateWorkspace } from './helpers.js'
import { Supervisor } from './Supervisor.js'

/**
 * Supervises one child while keeping every observation channel aligned at termination.
 *
 * @remarks
 * The child's ending and the supervision's ending are distinct. `pid`, `code`, and `signal` read
 * the host child directly, so they expose native exit as soon as the host records it. `settled`,
 * `exit`, `evidence`, and `lines` reach one terminal moment after the read channels close or the
 * bounded `drain` window cuts them off. That window is armed by the child's native exit and by a
 * termination this package initiated, so every way a child can end reaches the moment. The terminal
 * routine freezes `evidence` and ends `lines` before it destroys stdout, stderr, or the emitter, so
 * the push channel never disappears while a pull channel can still change or wait indefinitely.
 *
 * Standard output is framed through `readline` into a single-consumer stream. Lines already framed
 * and queued remain available through the terminal moment, while bytes arriving after a requested
 * termination may be cut off. Standard error is forwarded through the live `stderr` event and
 * retained as a byte-bounded raw tail until that same moment. `stop` ends the child tree and the
 * observation surfaces. `destroy` performs that stop and then destroys the emitter after the
 * frozen terminal state exists.
 *
 * @example
 * ```ts
 * import { Process } from '@orkestrel/process/server'
 *
 * const child = new Process({
 * 	command: { file: 'node', arguments: ['--version'] },
 * 	workspace: process.cwd(),
 * })
 * const exit = await child.exit
 * await child.destroy()
 * ```
 */
export class Process implements ProcessInterface {
	readonly #emitter: Emitter<ProcessEventMap>
	readonly #engine: Supervisor
	readonly #reader: ReadLineInterface
	readonly #backlog: number
	readonly #lines: AsyncIterable<string>
	readonly #queue: string[] = []
	readonly #waiters: Array<PromiseWithResolvers<IteratorResult<string, void>>> = []
	#head = 0
	#pending = 0
	#requested = false
	#paused = false
	#truncated = false
	#ended = false

	/**
	 * Spawn one child process and begin stream capture.
	 *
	 * @param options - Command, workspace, termination, capture, stdin, and observation settings
	 * @throws A {@link ProcessError} coded `invalid` when an option or command string is malformed
	 */
	constructor(options: ProcessOptions) {
		// Every option and command property is read once, here, before the engine spawns. Reading a
		// property runs the caller's own getter, so the engine receives these plain values and re-reads
		// none of them: a getter runs once whether the construction succeeds or is refused.
		// The engine's own options are validated first, in the order the engine reads them, and the
		// line pipeline's `backlog` after them, so a construction carrying more than one invalid option
		// reports the same option a single supervised face has always reported, and a malformed
		// `backlog` still refuses while nothing has been spawned.
		const source = options.command
		const workspace = options.workspace
		const grace = options.grace
		const drain = options.drain
		const evidence = options.evidence
		const backlog = options.backlog
		const delivery = options.delivery
		const writable = options.writable
		const signal = options.signal
		const on = options.on
		const error = options.error
		const command = snapshotCommand(source)
		validateCommand(command)
		validateWorkspace(workspace)
		validateTimer(grace, "option 'grace'")
		validateTimer(drain, "option 'drain'")
		validateTimer(delivery, "option 'delivery'")
		validateBytes(evidence, "option 'evidence'", 0)
		validateBytes(backlog, "option 'backlog'", 1)
		this.#emitter = new Emitter<ProcessEventMap>({
			...(on === undefined ? {} : { on }),
			...(error === undefined ? {} : { error }),
		})
		this.#backlog = backlog ?? PROCESS_BACKLOG
		this.#lines = Object.freeze({ [Symbol.asyncIterator]: this.#iterate.bind(this) })
		this.#engine = new Supervisor(
			{
				command,
				workspace,
				...(grace === undefined ? {} : { grace }),
				...(drain === undefined ? {} : { drain }),
				...(evidence === undefined ? {} : { evidence }),
				...(delivery === undefined ? {} : { delivery }),
				...(writable === undefined ? {} : { writable }),
				...(signal === undefined ? {} : { signal }),
			},
			{
				chunk: this.#reportStderr.bind(this),
				fault: this.#reportFault.bind(this),
				relieve: this.#releaseBackpressure.bind(this),
				close: this.#closeReader.bind(this),
				terminal: this.#reportExit.bind(this),
				teardown: this.#emitter.destroy.bind(this.#emitter),
			},
		)
		// The host delivers no output before this synchronous constructor returns, so framing attaches
		// here without losing a byte the engine already spawned for.
		this.#reader = createInterface({ input: this.#engine.stdout, crlfDelay: Infinity })
		this.#reader.on('line', this.#push.bind(this))
		this.#reader.once('close', this.#finish.bind(this))
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
	get emitter(): EmitterInterface<ProcessEventMap> {
		return this.#emitter
	}

	/** The captured stdout lines, in arrival order, ending after queued lines at the terminal moment. */
	get lines(): AsyncIterable<string> {
		return this.#lines
	}

	/** The decoded byte-bounded stderr tail, frozen at the terminal moment. */
	get evidence(): string {
		return this.#engine.evidence
	}

	/** True when the `lines` stream omitted output after a retention bound was reached. */
	get truncated(): boolean {
		return this.#truncated
	}

	/** True after the terminal moment arrived and `exit` settled. */
	get settled(): boolean {
		return this.#engine.settled
	}

	/** True after termination began, including after the terminal moment. */
	get stopping(): boolean {
		return this.#engine.stopping
	}

	/** The terminal child state, observed once after stream close or the drain cutoff. */
	get exit(): Promise<ProcessExit> {
		return this.#engine.exit
	}

	/**
	 * Write one line to the open standard-input channel.
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
	 * @returns True when the host accepted the bytes without reporting a fault; false when the channel was closed, destroyed, ended, failed, or remained unconfirmed through `delivery`
	 */
	send(text: string): Promise<boolean> {
		return this.#engine.deliver(Buffer.from(`${text}\n`, 'utf8'))
	}

	/**
	 * Terminates the child process tree and reaches the terminal observation moment.
	 *
	 * @remarks
	 * Never rejects, and every call shares one termination. After the termination sequence returns,
	 * confirmed or not, it waits at most `drain` for the read channels to close, then cuts them off
	 * and settles `exit` when they remain open. A cutoff reached before the native exit reports the
	 * `code` and `signal` the host had recorded by then, which is `null` for a child still running.
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

	#iterate(): AsyncIterator<string, void, void> {
		this.#requested = true
		return Object.freeze({ next: this.#next.bind(this) })
	}

	#next(): Promise<IteratorResult<string, void>> {
		const line = this.#take()
		if (line !== undefined) return Promise.resolve(Object.freeze({ done: false, value: line }))
		if (this.#ended) return Promise.resolve(Object.freeze({ done: true, value: undefined }))
		const waiter = Promise.withResolvers<IteratorResult<string, void>>()
		this.#waiters.push(waiter)
		return waiter.promise
	}

	// Dequeues through a read index, so draining a long backlog stays linear.
	#take(): string | undefined {
		if (this.#head >= this.#queue.length) return undefined
		const line = this.#queue[this.#head]
		this.#queue[this.#head] = ''
		this.#head += 1
		if (this.#head >= this.#queue.length) {
			this.#queue.length = 0
			this.#head = 0
		}
		if (line === undefined) return undefined
		this.#pending -= Buffer.byteLength(line) + 1
		this.#relieve()
		return line
	}

	#push(line: string): void {
		if (this.#ended) return
		const waiter = this.#waiters.shift()
		if (waiter !== undefined) {
			waiter.resolve(Object.freeze({ done: false, value: line }))
			return
		}
		// A retained line costs its payload plus the newline that framed it, so an empty line still
		// costs a byte and a flood of them reaches the mark.
		const bytes = Buffer.byteLength(line) + 1
		// With no consumer ever attached, retention stops at the mark and the stream keeps draining
		// so the child can exit; a consumer attaching later receives the head, a gap, then the live
		// stream.
		const stopping = this.#engine.stopping
		const limit = stopping ? this.#backlog * 2 : this.#backlog
		if ((!this.#requested || stopping) && this.#pending + bytes > limit) {
			this.#truncated = true
			return
		}
		this.#queue.push(line)
		this.#pending += bytes
		this.#restrain()
	}

	#restrain(): void {
		if (this.#paused || this.#engine.stopping || !this.#requested) return
		if (this.#pending < this.#backlog) return
		this.#paused = true
		this.#reader.pause()
	}

	#relieve(): void {
		if (!this.#paused || this.#ended) return
		if (!this.#engine.stopping && this.#pending > this.#backlog / 2) return
		this.#paused = false
		this.#reader.resume()
	}

	#finish(): void {
		if (this.#ended) return
		this.#ended = true
		this.#paused = false
		for (const waiter of this.#waiters) {
			waiter.resolve(Object.freeze({ done: true, value: undefined }))
		}
		this.#waiters.length = 0
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

	// Closing readline ends pending reads while preserving lines already framed and queued.
	#closeReader(): void {
		this.#reader.close()
	}

	// A paused stdout holds the child's own write, and therefore its exit. Bound the retained head,
	// then release backpressure before the engine signals; later lines drop at the teardown cap
	// instead of pausing the reader again.
	#releaseBackpressure(): void {
		this.#capBacklog()
		this.#relieve()
	}

	#capBacklog(): void {
		const limit = this.#backlog * 2
		while (this.#pending > limit && this.#queue.length > this.#head) {
			const line = this.#queue.pop()
			if (line === undefined) break
			this.#pending -= Buffer.byteLength(line) + 1
			this.#truncated = true
		}
	}
}
