import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Interface as ReadLineInterface } from 'node:readline'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { ProcessEventMap, ProcessExit, ProcessInterface, ProcessOptions } from '@src/core'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { StringDecoder } from 'node:string_decoder'
import { Emitter } from '@orkestrel/emitter'
import { PROCESS_EVIDENCE } from '@src/core'
import { killProcess, mergeEnvironment, trimTail } from './helpers.js'

/**
 * One supervised child process with eagerly framed output and bounded termination.
 *
 * @remarks
 * Standard output is drained eagerly through `readline`, so `exit` resolves and a late consumer of
 * `lines` still receives every framed line, including a final line written without a trailing
 * newline. Standard error is decoded and forwarded live as the `stderr` event while a byte-bounded
 * raw tail is retained as `evidence`. The typed `emitter` also carries the child `error` cause on a
 * spawn fault and the terminal `exit`, alongside the `exit` promise. `stop` terminates the child
 * through `SIGTERM`, then `SIGKILL` after
 * `grace`, and is idempotent; `destroy` stops the child and destroys the emitter last.
 *
 * @example
 * ```ts
 * import { Process } from '@orkestrel/process/server'
 *
 * const child = new Process({
 * 	command: { file: 'node', arguments: ['--version'] },
 * 	workspace: process.cwd(),
 * 	grace: 5000,
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
	readonly #limit: number
	readonly #decoder = new StringDecoder('utf8')
	readonly #exit = Promise.withResolvers<ProcessExit>()
	readonly #lines: AsyncIterable<string>
	readonly #buffer: string[] = []
	readonly #waiters: Array<PromiseWithResolvers<IteratorResult<string, void>>> = []
	readonly #signal: AbortSignal | undefined
	readonly #abort: EventListener | undefined
	#tail: Buffer = Buffer.alloc(0)
	#closed = false
	#ended = false
	#stopping: Promise<void> | undefined
	#ending: Promise<void> | undefined

	/**
	 * Spawn one child process and begin eager stream capture.
	 *
	 * @param options - Command, workspace, termination, evidence, stdin, and observation settings
	 */
	constructor(options: ProcessOptions) {
		const on = options.on
		const error = options.error
		this.#emitter = new Emitter<ProcessEventMap>({
			...(on === undefined ? {} : { on }),
			...(error === undefined ? {} : { error }),
		})
		this.#grace = options.grace
		this.#limit = options.evidence ?? PROCESS_EVIDENCE
		this.#signal = options.signal
		this.#lines = Object.freeze({ [Symbol.asyncIterator]: this.#iterate.bind(this) })
		this.#child = spawn(options.command.file, [...options.command.arguments], {
			cwd: options.workspace,
			detached: process.platform !== 'win32',
			env: mergeEnvironment(options.command.environment),
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		})
		this.#reader = createInterface({ input: this.#child.stdout, crlfDelay: Infinity })
		this.#reader.on('line', this.#push.bind(this))
		this.#reader.once('close', this.#finish.bind(this))
		this.#child.once('error', (cause: unknown) => this.#emitter.emit('error', cause))
		this.#child.once('close', this.#close.bind(this))
		this.#child.stdin.on('error', () => undefined)
		this.#child.stderr.on('data', this.#retain.bind(this))
		if (options.command.input !== undefined) this.#child.stdin.write(options.command.input)
		if (options.writable !== true) this.#child.stdin.end()
		if (this.#signal !== undefined) {
			this.#abort = this.#terminate.bind(this)
			this.#signal.addEventListener('abort', this.#abort, { once: true })
			if (this.#signal.aborted) void this.stop()
		}
	}

	/** The typed lifecycle observation surface. */
	get emitter(): EmitterInterface<ProcessEventMap> {
		return this.#emitter
	}

	/** The eagerly captured stdout lines, in arrival order, ending when the child's stdout closes. */
	get lines(): AsyncIterable<string> {
		return this.#lines
	}

	/** The decoded byte-bounded stderr tail. */
	get evidence(): string {
		return this.#tail.toString('utf8')
	}

	/** The terminal child state, observed once from the close event. */
	get exit(): Promise<ProcessExit> {
		return this.#exit.promise
	}

	/**
	 * Write one line to the open standard-input channel.
	 *
	 * @param text - The line text without its trailing newline
	 * @returns True when the channel accepted the line without backpressure; false otherwise
	 */
	send(text: string): boolean {
		if (this.#closed || this.#child.stdin.destroyed || this.#child.stdin.writableEnded) return false
		try {
			return this.#child.stdin.write(`${text}\n`)
		} catch {
			return false
		}
	}

	/**
	 * Terminate the child process tree and await its observed exit.
	 *
	 * @returns A promise that resolves after bounded termination
	 */
	stop(): Promise<void> {
		if (this.#stopping !== undefined) return this.#stopping
		this.#stopping = this.#kill()
		return this.#stopping
	}

	/**
	 * Stop the child and destroy the observation emitter.
	 *
	 * @returns The stable barrier shared by every call
	 */
	destroy(): Promise<void> {
		if (this.#ending !== undefined) return this.#ending
		this.#ending = this.#teardown()
		return this.#ending
	}

	#iterate(): AsyncIterator<string, void, void> {
		return Object.freeze({ next: this.#next.bind(this) })
	}

	#next(): Promise<IteratorResult<string, void>> {
		const line = this.#buffer.shift()
		if (line !== undefined) return Promise.resolve(Object.freeze({ done: false, value: line }))
		if (this.#ended) return Promise.resolve(Object.freeze({ done: true, value: undefined }))
		const waiter = Promise.withResolvers<IteratorResult<string, void>>()
		this.#waiters.push(waiter)
		return waiter.promise
	}

	#push(line: string): void {
		if (this.#ended) return
		const waiter = this.#waiters.shift()
		if (waiter === undefined) {
			this.#buffer.push(line)
			return
		}
		waiter.resolve(Object.freeze({ done: false, value: line }))
	}

	#finish(): void {
		if (this.#ended) return
		this.#ended = true
		for (const waiter of this.#waiters) {
			waiter.resolve(Object.freeze({ done: true, value: undefined }))
		}
		this.#waiters.length = 0
	}

	#retain(chunk: unknown): void {
		if (!Buffer.isBuffer(chunk) || this.#closed) return
		this.#tail = trimTail(Buffer.concat([this.#tail, chunk]), this.#limit)
		const text = this.#decoder.write(chunk)
		if (text.length > 0) this.#emitter.emit('stderr', text)
	}

	#close(code: number | null, signal: NodeJS.Signals | null): void {
		if (this.#closed) return
		const suffix = this.#decoder.end()
		if (suffix.length > 0) this.#emitter.emit('stderr', suffix)
		this.#closed = true
		if (this.#signal !== undefined && this.#abort !== undefined) {
			this.#signal.removeEventListener('abort', this.#abort)
		}
		this.#reader.close()
		const exit = Object.freeze({ code, signal })
		this.#exit.resolve(exit)
		this.#emitter.emit('exit', exit)
	}

	#terminate(): void {
		void this.stop()
	}

	async #kill(): Promise<void> {
		if (this.#closed) return
		killProcess(this.#child, 'SIGTERM')
		const grace = Promise.withResolvers<void>()
		const timer = setTimeout(grace.resolve, this.#grace)
		await Promise.race([this.#exit.promise, grace.promise])
		clearTimeout(timer)
		if (this.#closed) return
		killProcess(this.#child, 'SIGKILL')
		await this.#exit.promise
	}

	async #teardown(): Promise<void> {
		await this.stop()
		this.#emitter.destroy()
	}
}
