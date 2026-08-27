import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { ProcessExit, ProcessOptions } from '@src/core'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import {
	ProcessError,
	PROCESS_CONFIRMATION,
	PROCESS_DRAIN,
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
	waitForClose,
} from './helpers.js'

/**
 * Supervises one child process and reports each lifecycle moment to the face composing it.
 *
 * @remarks
 * This is the engine every supervised-child face shares. It owns the eager spawn, the byte-bounded
 * stderr tail and its decoded chunks, the standard-input channel and its bounded confirmation, the
 * termination sequence, and the progression from the child's native exit through the bounded `drain`
 * window to one terminal moment. It owns no output framing and no observation surface: a face
 * attaches its own consumer to `stdout`, frames bytes however its contract promises, and owns the
 * emitter and event map its consumers subscribe to.
 *
 * The child's ending and the supervision's ending are distinct. `pid`, `code`, and `signal` read the
 * host child directly, so they expose native exit as soon as the host records it, and `ending`
 * settles at that same moment. `settled`, `exit`, and `evidence` reach one terminal moment after the
 * read channels close or the bounded `drain` window cuts them off. That window is armed by the
 * child's native exit and by a termination this package initiated, so every way a child can end
 * reaches the moment. The terminal routine hands the face its `close` and `terminal` moments before
 * it destroys stdout and stderr, so a face's own pull surfaces are final while its read ends still
 * exist.
 *
 * The face is a set of callbacks rather than an emitter, because each face publishes a different
 * event map over the same moments. `chunk` and `fault` carry the live stderr text and the child or
 * channel faults, `relieve` reports that a termination began so the face can release whatever
 * backpressure it holds, `close` ends the face's read pipeline at the terminal moment, `terminal`
 * carries the frozen {@link ProcessExit}, and `teardown` releases the face's own surface after the
 * termination completes.
 */
export class Supervisor {
	readonly #chunk: (text: string) => void
	readonly #fault: (cause: unknown) => void
	readonly #relieve: () => void
	readonly #close: () => void
	readonly #terminal: (exit: ProcessExit) => void
	readonly #teardown: () => void
	readonly #child: ChildProcessWithoutNullStreams
	readonly #grace: number
	readonly #drain: number
	readonly #evidence: number
	readonly #delivery: number
	readonly #decoder = new StringDecoder('utf8')
	readonly #exit = Promise.withResolvers<ProcessExit>()
	readonly #ending = Promise.withResolvers<void>()
	readonly #signal: AbortSignal | undefined
	readonly #abort: EventListener | undefined
	readonly #writes = new Map<
		PromiseWithResolvers<boolean>,
		ReturnType<typeof setTimeout> | undefined
	>()
	#tail: Buffer = Buffer.alloc(0)
	// A guard reads `#stopping`, never `#termination !== undefined`. `#kill` assigns the boolean in
	// its synchronous prefix, which runs while `stop` is still evaluating
	// `this.#termination = this.#kill()`, so the boolean also covers the retention and backpressure
	// decisions a face takes while `#termination` is still `undefined`.
	#stopping = false
	#settled = false
	#input = 0
	#failure: Error | undefined
	#waiting: Promise<void> | undefined
	#termination: Promise<boolean> | undefined
	#destruction: Promise<void> | undefined

	/**
	 * Spawn one child process and begin standard-error capture.
	 *
	 * @remarks
	 * The face's callbacks are captured before anything is read or spawned, so the first moment the
	 * child can produce already has somewhere to go. `options` supplies the command, workspace,
	 * termination, capture, and standard-input settings; a face's own settings, such as an output
	 * retention bound, are read and validated by that face before it constructs this engine, so an
	 * invalid one refuses construction while nothing has been spawned.
	 *
	 * @param options - Command, workspace, termination, capture, and stdin settings
	 * @param face - The composing face's callbacks for each lifecycle moment
	 * @throws A {@link ProcessError} coded `invalid` when an option or command string is malformed
	 */
	constructor(
		options: ProcessOptions,
		face: {
			readonly chunk: (text: string) => void
			readonly fault: (cause: unknown) => void
			readonly relieve: () => void
			readonly close: () => void
			readonly terminal: (exit: ProcessExit) => void
			readonly teardown: () => void
		},
	) {
		this.#chunk = face.chunk
		this.#fault = face.fault
		this.#relieve = face.relieve
		this.#close = face.close
		this.#terminal = face.terminal
		this.#teardown = face.teardown
		// Every option and command property is read once, here, before anything is spawned. Reading a
		// property runs the caller's own getter, so a read after the spawn would let that getter throw
		// while a live child exists and no one holds a reference to it. Hoisting the reads is what
		// makes a construction failure unable to strand a process.
		const source = options.command
		const workspace = options.workspace
		const grace = options.grace
		const drain = options.drain
		const evidence = options.evidence
		const delivery = options.delivery
		const writable = options.writable
		const signal = options.signal
		const command = snapshotCommand(source)
		const input = command.input
		validateCommand(command)
		validateWorkspace(workspace)
		validateTimer(grace, "option 'grace'")
		validateTimer(drain, "option 'drain'")
		validateTimer(delivery, "option 'delivery'")
		validateBytes(evidence, "option 'evidence'", 0)
		this.#grace = grace ?? PROCESS_GRACE
		this.#drain = drain ?? PROCESS_DRAIN
		this.#evidence = evidence ?? PROCESS_EVIDENCE
		this.#delivery = delivery ?? 0
		this.#signal = signal
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
		this.#child.once('error', this.#fault)
		this.#child.once('exit', this.#expire.bind(this))
		this.#child.once('close', this.#complete.bind(this))
		this.#child.stdin.on('error', this.#failInputStream.bind(this))
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

	/** The child's standard-output stream, for the composing face to attach its own consumer to. */
	get stdout(): Readable {
		return this.#child.stdout
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

	/** The decoded byte-bounded stderr tail, frozen at the terminal moment. */
	get evidence(): string {
		return this.#tail.toString('utf8')
	}

	/** True after the terminal moment arrived and `exit` settled. */
	get settled(): boolean {
		return this.#settled
	}

	/** True after termination began, including after the terminal moment. */
	get stopping(): boolean {
		return this.#stopping
	}

	/**
	 * The child's own ending, awaited without the terminal moment's drain window.
	 *
	 * @remarks
	 * Never rejects, and resolves no value: `code` and `signal` carry the terminal facts as soon as
	 * the host records them. It settles at the native exit, and at the terminal moment for a child
	 * whose spawn produced no native exit at all, so it can never outlive the supervision.
	 */
	get ending(): Promise<void> {
		return this.#ending.promise
	}

	/** The terminal child state, observed once after stream close or the drain cutoff. */
	get exit(): Promise<ProcessExit> {
		return this.#exit.promise
	}

	/**
	 * Write raw bytes to the open standard-input channel.
	 *
	 * @remarks
	 * Never rejects, and adds no framing: a face composes whatever terminator its contract promises
	 * before it calls this. `true` means the host accepted the bytes without reporting a fault; it
	 * does not prove that the child read them. An ordinary write settles when the kernel accepts it.
	 * Only a full pipe can hold the write unconfirmed. The `delivery` option can bound that wait, and
	 * every terminal teardown path settles pending writes. After `stop` or `destroy` begins, a later
	 * call settles `false`, because teardown cannot confirm delivery for bytes it is about to
	 * discard.
	 *
	 * @param bytes - The payload to write, already framed by the caller
	 * @returns True when the host accepted the bytes without reporting a fault; false when the channel was closed, destroyed, ended, failed, or remained unconfirmed through `delivery`
	 */
	deliver(bytes: Uint8Array): Promise<boolean> {
		const stdin = this.#child.stdin
		if (this.#settled || this.#stopping || this.#failure !== undefined || !stdin.writable) {
			return Promise.resolve(false)
		}
		const settled = Promise.withResolvers<boolean>()
		this.#writes.set(settled, undefined)
		try {
			stdin.write(bytes, this.#confirmWrite.bind(this, settled))
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
		if (this.#termination !== undefined) return this.#termination
		this.#termination = this.#kill()
		return this.#termination
	}

	/**
	 * Stops the child and releases the composing face after the terminal state freezes.
	 *
	 * @remarks
	 * Always resolves, including when termination was never confirmed. Every call shares one barrier.
	 *
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void> {
		if (this.#destruction !== undefined) return this.#destruction
		this.#destruction = this.#end()
		return this.#destruction
	}

	#retain(chunk: unknown): void {
		if (!Buffer.isBuffer(chunk) || this.#settled) return
		this.#tail = trimTail(Buffer.concat([this.#tail, chunk]), this.#evidence)
		const text = this.#decoder.write(chunk)
		if (text.length > 0) this.#chunk(text)
	}

	#complete(): void {
		if (this.#settled) return
		this.#settle(true)
	}

	// A native exit does not close the read ends: a descendant that inherited them holds them open
	// for its own remaining life, and one that never ends never closes them at all. Arming the same
	// bounded wait a requested termination awaits is what makes every ending reach the terminal
	// moment. `ending` settles here rather than at that moment, because it reports the child's own
	// exit and not the release of the channels a descendant may still hold.
	#expire(): void {
		this.#ending.resolve()
		if (this.#settled) return
		void this.#wait()
	}

	// One bounded wait per close, created once and shared: the native exit arms it and a termination
	// awaits the same one, so a close never carries two overlapping bounds. `waitForClose` clears its
	// own timer on either outcome. The constructor registers `#complete` before this listener exists,
	// so a natural close settles drained and the continuation below finds the latch already set.
	#wait(): Promise<void> {
		this.#waiting ??= waitForClose(this.#child, this.#drain).then(() => {
			if (!this.#settled) this.#settle(false)
		})
		return this.#waiting
	}

	#settle(drained: boolean): void {
		// Flush the decoder while the face's stderr channel is still live.
		const suffix = this.#decoder.end()
		if (suffix.length > 0) this.#chunk(suffix)
		// Latch before the terminal value is resolved and delivered below, so a consumer handed that
		// value never reads a child still reporting itself unfinished.
		this.#settled = true
		this.#removeAbortListener()
		// Ending the face's read pipeline here preserves whatever it has already framed and queued.
		this.#close()
		const exit = Object.freeze({ code: this.code, signal: this.signal, drained })
		this.#exit.resolve(exit)
		// A spawn that produced no child reports no native exit, so the terminal moment is the last
		// place `ending` can settle rather than wait forever.
		this.#ending.resolve()
		this.#terminal(exit)
		// Release read handles only after every pull surface is final.
		this.#child.stdout.destroy()
		this.#child.stderr.destroy()
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
		if (this.#failure !== undefined || this.#stopping) return
		this.#failure = cause
		this.#settleWrites()
		this.#fault(new ProcessError('The standard-input channel failed', { code: 'protocol', cause }))
	}

	async #kill(): Promise<boolean> {
		// A paused stdout holds the child's own write, and therefore its exit. The face releases its
		// backpressure before anything is signalled; later output drops at the face's teardown bound
		// instead of pausing the stream again.
		this.#stopping = true
		this.#relieve()
		const confirmed = await stopChild(this.#child, this.#grace, PROCESS_CONFIRMATION)
		this.#settleWrites()
		this.#child.stdin.destroy()
		if (!this.#settled) await this.#wait()
		if (!this.#settled) this.#settle(false)
		return confirmed
	}

	async #end(): Promise<void> {
		await this.stop()
		this.#teardown()
	}
}
