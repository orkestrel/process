import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Interface as ReadLineInterface } from 'node:readline'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { ProcessEventMap, ProcessExit, ProcessInterface, ProcessOptions } from '@src/core'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { StringDecoder } from 'node:string_decoder'
import { Emitter } from '@orkestrel/emitter'
import {
	ProcessError,
	PROCESS_BACKLOG,
	PROCESS_CONFIRMATION,
	PROCESS_EVIDENCE,
	PROCESS_GRACE,
} from '@src/core'
import {
	buildSpawn,
	mergeEnvironment,
	snapshotCommand,
	stopChild,
	trimTail,
	validateBytes,
	validateCommand,
	validateTimer,
	validateWorkspace,
} from './helpers.js'

/**
 * One supervised child process with framed output, a bounded backlog, and bounded termination.
 *
 * @remarks
 * Standard output is framed through `readline` into a single-consumer stream: each line goes to
 * exactly one waiting iterator, so concurrent iterators split the output rather than each receiving
 * all of it. While no consumer has ever requested an iterator, stdout keeps draining so `exit` still
 * resolves, and retention stops at the `backlog` mark: a
 * consumer attaching later receives the retained head, a gap, then the live stream. After an iterator
 * has been requested, stdout pauses at the mark and resumes at half of it, so that consumer loses
 * nothing before termination and the child feels real backpressure. The mark is soft — the ordinary backlog can
 * overshoot it by the line that crossed it plus the rest of its delivered chunk. Termination never
 * reapplies backpressure, and retained lines are capped at twice `backlog`; later lines are dropped
 * and `truncated` reports the omission. Standard error is decoded and forwarded live as the `stderr`
 * event while a byte-bounded raw tail is retained as `evidence`. The typed `emitter` also carries a
 * child `error` cause on a spawn fault, a `protocol` {@link ProcessError} on a host-reported stdin
 * fault after the constructor input phase, and the terminal `exit`, alongside the `exit` promise.
 * A fault arising from the constructor-supplied `input` write or its closing `end` stays quiet
 * because the package initiated that sequence. `pid`,
 * `code`, and `signal` read the spawned child directly, so the native exit is readable before the
 * `exit` promise settles on stdio close. `stop` ends the whole tree and reports whether the native
 * exit was observed; `destroy` stops the child, destroys stdin so every pending `send` settles, and
 * destroys the emitter last. `destroy` resolving does not imply the child's stdio has closed, so
 * `exit` and `lines` can still be outstanding when a descendant holds an inherited pipe.
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
	readonly #child: ChildProcessWithoutNullStreams
	readonly #reader: ReadLineInterface
	readonly #grace: number
	readonly #evidence: number
	readonly #backlog: number
	readonly #delivery: number
	readonly #decoder = new StringDecoder('utf8')
	readonly #exit = Promise.withResolvers<ProcessExit>()
	readonly #lines: AsyncIterable<string>
	readonly #queue: string[] = []
	readonly #waiters: Array<PromiseWithResolvers<IteratorResult<string, void>>> = []
	readonly #signal: AbortSignal | undefined
	readonly #abort: EventListener | undefined
	readonly #writes = new Map<
		PromiseWithResolvers<boolean>,
		ReturnType<typeof setTimeout> | undefined
	>()
	#tail: Buffer = Buffer.alloc(0)
	#head = 0
	#pending = 0
	#requested = false
	#paused = false
	#truncated = false
	// A guard reads `#terminating`, never `#stopping !== undefined`. `#kill` assigns the boolean in
	// its synchronous prefix, which runs while `stop` is still evaluating
	// `this.#stopping = this.#kill()`, so the boolean also covers the retention and backpressure
	// decisions taken while `#stopping` is still `undefined`.
	#terminating = false
	#closed = false
	#ended = false
	#input = 0
	#failure: Error | undefined
	#stopping: Promise<boolean> | undefined
	#ending: Promise<void> | undefined

	/**
	 * Spawn one child process and begin stream capture.
	 *
	 * @param options - Command, workspace, termination, capture, stdin, and observation settings
	 * @throws A {@link ProcessError} coded `invalid` when an option or command string is malformed
	 */
	constructor(options: ProcessOptions) {
		// Every option and command property is read once, here, before anything is spawned. Reading a
		// property runs the caller's own getter, so a read after the spawn would let that getter throw
		// while a live child exists and no one holds a reference to it. Hoisting the reads is what
		// makes a construction failure unable to strand a process.
		const source = options.command
		const workspace = options.workspace
		const grace = options.grace
		const evidence = options.evidence
		const backlog = options.backlog
		const delivery = options.delivery
		const writable = options.writable
		const signal = options.signal
		const on = options.on
		const error = options.error
		const command = snapshotCommand(source)
		const input = command.input
		validateCommand(command)
		validateWorkspace(workspace)
		validateTimer(grace, "option 'grace'")
		validateTimer(delivery, "option 'delivery'")
		validateBytes(evidence, "option 'evidence'", 0)
		validateBytes(backlog, "option 'backlog'", 1)
		this.#emitter = new Emitter<ProcessEventMap>({
			...(on === undefined ? {} : { on }),
			...(error === undefined ? {} : { error }),
		})
		this.#grace = grace ?? PROCESS_GRACE
		this.#evidence = evidence ?? PROCESS_EVIDENCE
		this.#backlog = backlog ?? PROCESS_BACKLOG
		this.#delivery = delivery ?? 0
		this.#signal = signal
		this.#lines = Object.freeze({ [Symbol.asyncIterator]: this.#iterate.bind(this) })
		const childEnvironment = mergeEnvironment(command.isolated === true, command.environment)
		const plan = buildSpawn(command, { workspace, environment: childEnvironment })
		this.#child = spawn(plan.file, [...plan.arguments], {
			cwd: workspace,
			detached: process.platform !== 'win32',
			env: childEnvironment,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
			windowsVerbatimArguments: plan.verbatim,
		})
		this.#reader = createInterface({ input: this.#child.stdout, crlfDelay: Infinity })
		this.#reader.on('line', this.#push.bind(this))
		this.#reader.once('close', this.#finish.bind(this))
		this.#child.once('error', (cause: unknown) => this.#emitter.emit('error', cause))
		this.#child.once('close', this.#close.bind(this))
		this.#child.stdin.on('error', (cause: Error) => this.#failInputStream(cause))
		this.#child.stderr.on('data', this.#retain.bind(this))
		if (input !== undefined) {
			this.#input += 1
			this.#child.stdin.write(input, this.#completeInput.bind(this))
		}
		if (writable !== true) {
			this.#input += 1
			this.#child.stdin.end(this.#completeInput.bind(this))
		}
		if (signal !== undefined) {
			this.#abort = this.#terminate.bind(this)
			signal.addEventListener('abort', this.#abort, { once: true })
			if (signal.aborted) void this.stop()
		}
	}

	/** The host process id, fixed when construction returns, or `undefined` when the spawn produced none. */
	get pid(): number | undefined {
		return this.#child.pid
	}

	/** The exit code the host recorded, or `null` while the child has not exited and when a signal ended it. */
	get code(): number | null {
		return this.#child.exitCode
	}

	/** The terminating signal name the host recorded, or `null` while the child has not exited and when it exited on its own. */
	get signal(): string | null {
		return this.#child.signalCode
	}

	/** The typed lifecycle observation surface. */
	get emitter(): EmitterInterface<ProcessEventMap> {
		return this.#emitter
	}

	/** The captured stdout lines, in arrival order, ending when the child's stdout closes. */
	get lines(): AsyncIterable<string> {
		return this.#lines
	}

	/** The decoded byte-bounded stderr tail. */
	get evidence(): string {
		return this.#tail.toString('utf8')
	}

	/** True when the `lines` stream omitted output after a retention bound was reached. */
	get truncated(): boolean {
		return this.#truncated
	}

	/** The terminal child state, observed once from the close event. */
	get exit(): Promise<ProcessExit> {
		return this.#exit.promise
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
		const stdin = this.#child.stdin
		if (this.#closed || this.#terminating || this.#failure !== undefined || !stdin.writable) {
			return Promise.resolve(false)
		}
		const settled = Promise.withResolvers<boolean>()
		this.#writes.set(settled, undefined)
		try {
			stdin.write(`${text}\n`, this.#confirmWrite.bind(this, settled))
		} catch {
			this.#settleWrite(settled, false)
			return settled.promise
		}
		if (this.#delivery > 0 && this.#writes.has(settled)) {
			const timer = setTimeout(() => this.#settleWrite(settled, false), this.#delivery)
			timer.unref()
			this.#writes.set(settled, timer)
		}
		return settled.promise
	}

	/**
	 * Terminate the child process tree and await its observed exit.
	 *
	 * @remarks
	 * Never rejects, and every call shares one termination.
	 *
	 * @returns True when the child's native exit was observed; false when the confirmation deadline elapsed without it
	 */
	stop(): Promise<boolean> {
		if (this.#stopping !== undefined) return this.#stopping
		this.#stopping = this.#kill()
		return this.#stopping
	}

	/**
	 * Stop the child, close its standard-input channel, and destroy the observation emitter.
	 *
	 * @remarks
	 * Always resolves, including when termination was never confirmed.
	 *
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void> {
		if (this.#ending !== undefined) return this.#ending
		this.#ending = this.#teardown()
		return this.#ending
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
		const limit = this.#terminating ? this.#backlog * 2 : this.#backlog
		if ((!this.#requested || this.#terminating) && this.#pending + bytes > limit) {
			this.#truncated = true
			return
		}
		this.#queue.push(line)
		this.#pending += bytes
		this.#restrain()
	}

	#restrain(): void {
		if (this.#paused || this.#terminating || !this.#requested) return
		if (this.#pending < this.#backlog) return
		this.#paused = true
		this.#reader.pause()
	}

	#relieve(): void {
		if (!this.#paused || this.#ended) return
		if (!this.#terminating && this.#pending > this.#backlog / 2) return
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

	#retain(chunk: unknown): void {
		if (!Buffer.isBuffer(chunk) || this.#closed) return
		this.#tail = trimTail(Buffer.concat([this.#tail, chunk]), this.#evidence)
		const text = this.#decoder.write(chunk)
		if (text.length > 0) this.#emitter.emit('stderr', text)
	}

	#close(code: number | null, signal: NodeJS.Signals | null): void {
		if (this.#closed) return
		const suffix = this.#decoder.end()
		if (suffix.length > 0) this.#emitter.emit('stderr', suffix)
		this.#closed = true
		this.#removeAbortListener()
		this.#reader.close()
		const exit = Object.freeze({ code, signal })
		this.#exit.resolve(exit)
		this.#emitter.emit('exit', exit)
	}

	#terminate(): void {
		void this.stop()
	}

	#removeAbortListener(): void {
		if (this.#signal === undefined || this.#abort === undefined) return
		this.#signal.removeEventListener('abort', this.#abort)
	}

	#confirmWrite(settled: PromiseWithResolvers<boolean>, error?: Error | null): void {
		if (error === undefined || error === null) {
			this.#settleWrite(settled, true)
			return
		}
		this.#failInputCallback(error)
	}

	#completeInput(): void {
		this.#input -= 1
	}

	#settleWrite(settled: PromiseWithResolvers<boolean>, accepted: boolean): void {
		if (!this.#writes.has(settled)) return
		const timer = this.#writes.get(settled)
		this.#writes.delete(settled)
		clearTimeout(timer)
		settled.resolve(accepted)
	}

	#settleWrites(): void {
		for (const settled of this.#writes.keys()) this.#settleWrite(settled, false)
	}

	#failInputStream(cause: Error): void {
		// `writableEnded` keeps a package-ended or consumer-ended channel quiet after its input phase
		// settles. A `writable: true` channel never sets it until ended, so a later host fault remains
		// classifiable after `#input` reaches zero.
		if (this.#child.stdin.writableEnded || this.#input > 0) {
			this.#settleWrites()
			return
		}
		this.#failInputCallback(cause)
	}

	#failInputCallback(cause: Error): void {
		if (this.#failure !== undefined || this.#terminating) return
		this.#failure = cause
		this.#settleWrites()
		this.#emitter.emit(
			'error',
			new ProcessError('The standard-input channel failed', { code: 'protocol', cause }),
		)
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

	async #kill(): Promise<boolean> {
		// A paused stdout holds the child's own write, and therefore its exit. Bound the retained head,
		// then release backpressure before signalling; later lines drop at the teardown cap instead of
		// pausing the reader again.
		this.#terminating = true
		this.#capBacklog()
		this.#relieve()
		const confirmed = await stopChild(this.#child, this.#grace, PROCESS_CONFIRMATION)
		this.#settleWrites()
		this.#child.stdin.destroy()
		return confirmed
	}

	async #teardown(): Promise<void> {
		this.#removeAbortListener()
		await this.stop()
		this.#emitter.destroy()
	}
}
