import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ExecuteOptions, ExecuteResult, ProcessCommand } from '@src/core'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import {
	createExecuteError,
	PROCESS_CONFIRMATION,
	PROCESS_GRACE,
	PROCESS_OUTPUT,
	ProcessError,
} from '@src/core'
import { snapshotCommand } from '../cloners.js'
import {
	buildExecuteResult,
	buildSpawn,
	captureChunk,
	formatCommand,
	mergeEnvironment,
	stopChild,
	validateBytes,
	validateCommand,
	validateEnvironment,
	validateTimer,
	validateWorkspace,
} from '../helpers.js'

/** Owns the child, capture, cancellation, and terminal state of one buffered execution. */
export class Execution {
	readonly #child: ChildProcessWithoutNullStreams
	readonly #settled: PromiseWithResolvers<ExecuteResult>
	readonly #terminate: AbortController
	readonly #cleanup: AbortController
	readonly #finish: AbortController
	readonly #inputFailure: AbortController
	readonly #outChunks: Buffer[] = []
	readonly #errChunks: Buffer[] = []
	readonly #strict: boolean
	#spawned = false
	#expired = false
	#aborted = false
	#outRetained = 0
	#errRetained = 0
	#cause: unknown
	#timeoutTimer: ReturnType<typeof setTimeout> | undefined
	#confirmTimer: ReturnType<typeof setTimeout> | undefined

	constructor(command: ProcessCommand, options?: ExecuteOptions) {
		const snapshot = snapshotCommand(command)
		const optionEnvironment = options?.environment
		const optionWorkspace = options?.workspace
		const optionInput = options?.input
		const optionTimeout = options?.timeout
		const optionGrace = options?.grace
		const optionSignal = options?.signal
		const optionStrict = options?.strict
		const optionLimit = options?.limit
		validateCommand(snapshot)
		validateEnvironment(optionEnvironment)
		validateWorkspace(optionWorkspace)
		validateTimer(optionTimeout, "option 'timeout'")
		validateTimer(optionGrace, "option 'grace'")
		validateBytes(optionLimit, "option 'limit'", 0)
		const limit = optionLimit ?? PROCESS_OUTPUT
		const grace = optionGrace ?? PROCESS_GRACE
		const timeout = optionTimeout ?? 0
		this.#strict = optionStrict ?? true
		const text = optionInput ?? snapshot.input
		const line = formatCommand(snapshot)
		const workspace = optionWorkspace ?? process.cwd()
		const environment = mergeEnvironment(
			snapshot.isolated === true,
			snapshot.environment,
			optionEnvironment,
		)
		const plan = buildSpawn(snapshot, { workspace, environment })
		this.#settled = Promise.withResolvers<ExecuteResult>()
		this.#terminate = new AbortController()
		this.#cleanup = new AbortController()
		this.#finish = new AbortController()
		this.#inputFailure = new AbortController()

		this.#child = spawn(plan.file, [...plan.arguments], {
			cwd: workspace,
			detached: process.platform !== 'win32',
			env: environment,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
			windowsVerbatimArguments: plan.verbatim,
		})

		this.#finish.signal.addEventListener(
			'abort',
			() => {
				clearTimeout(this.#timeoutTimer)
				clearTimeout(this.#confirmTimer)
				this.#cleanup.abort()
				this.#settled.resolve(
					buildExecuteResult({
						command: line,
						stdout: Buffer.concat(this.#outChunks),
						stderr: Buffer.concat(this.#errChunks),
						code: this.#child.exitCode,
						signal: this.#child.signalCode,
						expired: this.#expired,
						aborted: this.#aborted,
						truncated: this.#outRetained > limit || this.#errRetained > limit,
						limit,
						...(this.#cause === undefined ? {} : { cause: this.#cause }),
					}),
				)
			},
			{ once: true },
		)

		this.#terminate.signal.addEventListener(
			'abort',
			() => {
				if (this.#finish.signal.aborted) return
				clearTimeout(this.#timeoutTimer)
				this.#cleanup.abort()
				void stopChild(this.#child, grace, PROCESS_CONFIRMATION).then(() => {
					if (this.#finish.signal.aborted) return
					this.#confirmTimer = setTimeout(() => this.#finish.abort(), PROCESS_CONFIRMATION)
				})
			},
			{ once: true },
		)

		this.#inputFailure.signal.addEventListener(
			'abort',
			() => {
				if (this.#finish.signal.aborted) return
				this.#cause = this.#inputFailure.signal.reason
				this.#terminate.abort()
			},
			{ once: true },
		)

		this.#child.stdin.on('error', (error: Error) => this.#inputFailure.abort(error))
		this.#child.stdout.on('data', (chunk: unknown) => {
			const captured = captureChunk(chunk, limit + 1 - this.#outRetained)
			if (captured === undefined) return
			this.#outRetained += captured.byteLength
			this.#outChunks.push(captured)
		})
		this.#child.stderr.on('data', (chunk: unknown) => {
			const captured = captureChunk(chunk, limit + 1 - this.#errRetained)
			if (captured === undefined) return
			this.#errRetained += captured.byteLength
			this.#errChunks.push(captured)
		})
		this.#child.once('spawn', () => {
			this.#spawned = true
		})
		this.#child.once('error', (error: unknown) => {
			if (this.#spawned) return
			this.#cause = error
			this.#finish.abort()
		})
		this.#child.once('close', () => this.#finish.abort())

		if (text !== undefined) {
			this.#child.stdin.write(text, (error?: Error | null) => {
				if (error !== undefined && error !== null) this.#inputFailure.abort(error)
			})
		}
		this.#child.stdin.end()
		if (timeout > 0) {
			this.#timeoutTimer = setTimeout(() => {
				this.#expired = true
				this.#terminate.abort()
			}, timeout)
		}
		if (optionSignal !== undefined) {
			optionSignal.addEventListener(
				'abort',
				() => {
					this.#aborted = true
					this.#terminate.abort()
				},
				{ once: true, signal: this.#cleanup.signal },
			)
			if (optionSignal.aborted) {
				this.#aborted = true
				this.#terminate.abort()
			}
		}
	}

	get settled(): Promise<ExecuteResult> {
		return this.#settled.promise
	}

	read(result: ExecuteResult): ExecuteResult {
		if (result.failed && this.#strict) {
			if (this.#cause !== undefined && this.#cause === this.#inputFailure.signal.reason) {
				throw new ProcessError(`Command '${result.command}' failed while writing standard input`, {
					code: 'input',
					context: { command: result.command, code: result.code, signal: result.signal },
					cause: this.#inputFailure.signal.reason,
					result,
				})
			}
			throw createExecuteError(result, this.#cause)
		}
		return result
	}
}
