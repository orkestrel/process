# Process

> A typed child-process toolkit in three tiers. `Process` supervises one child with eagerly
> framed stdout lines, a byte-bounded stderr tail, a typed lifecycle emitter, a writable stdin
> channel, and bounded `SIGTERM` → grace → `SIGKILL` termination. `run` and `runSync` are the
> one-shot runners that buffer a child to completion and settle with a `RunResult`. `ProcessManager`
> is a keyed registry of live children, launched and stopped by id and observed through its own
> emitter. Every contract is host-independent; the Node implementations ship from
> `@orkestrel/process/server`, and the errors, constants, and types from `@orkestrel/process`.
>
> Source: [`src/core`](../src/core) (the contracts) and [`src/server`](../src/server) (the Node
> engine).

## Surface

Spawn a supervised child from `@orkestrel/process/server`, read its framed lines, and await its exit:

```ts
import { createProcess } from '@orkestrel/process/server'

const child = createProcess({
	command: { file: 'node', arguments: ['build.js'] },
	workspace: process.cwd(),
	grace: 5_000, // milliseconds between SIGTERM and SIGKILL on stop
})

for await (const line of child.lines) console.log(line)
const exit = await child.exit // { code, signal }
await child.destroy()
```

The three tiers divide by lifetime. Reach for `Process` when you need the live stream, the stdin
channel, or the lifecycle events. Reach for `run` or `runSync` when you want the buffered output and
the exit in one call. Reach for `ProcessManager` when you supervise several children by id.

### Factories

The interface-oriented constructors, from `@orkestrel/process/server`.

| API                    | Kind     | Summary                                                       |
| ---------------------- | -------- | ------------------------------------------------------------- |
| `createProcess`        | function | Spawn one supervised child and return its `ProcessInterface`. |
| `createProcessManager` | function | Construct an empty `ProcessManagerInterface` registry.        |

### Runners

The one-shot runners, from `@orkestrel/process/server`.

| API       | Kind     | Summary                                                                    |
| --------- | -------- | -------------------------------------------------------------------------- |
| `run`     | function | Run a command to completion, buffer its output, and resolve a `RunResult`. |
| `runSync` | function | The blocking counterpart of `run`, returning the `RunResult` directly.     |

### Entities

The classes each factory constructs, from `@orkestrel/process/server`, and the error type from
`@orkestrel/process`.

| API              | Kind  | Summary                                                                    |
| ---------------- | ----- | -------------------------------------------------------------------------- |
| `Process`        | class | The supervised child engine — eager line framing plus bounded termination. |
| `ProcessManager` | class | The keyed registry of live children with auto-eviction on exit.            |
| `ProcessError`   | class | A child-process failure with a stable machine-readable `code`.             |

### Guards

The total guard, from `@orkestrel/process`.

| API              | Kind     | Summary                                                          |
| ---------------- | -------- | ---------------------------------------------------------------- |
| `isProcessError` | function | Total guard narrowing an unknown caught value to `ProcessError`. |

### Helpers

The lower-level building blocks the runners and the engine compose, exported for direct use. The
signalling and spawn helpers come from `@orkestrel/process/server`; the error factories come from
`@orkestrel/process`.

| API                    | Kind     | Origin                      | Summary                                                                      |
| ---------------------- | -------- | --------------------------- | ---------------------------------------------------------------------------- |
| `killProcess`          | function | `@orkestrel/process/server` | Signal one child, or its detached process group on a POSIX host.             |
| `requiresShell`        | function | `@orkestrel/process/server` | Report whether a command file must run through a shell on the current host.  |
| `commandLine`          | function | `@orkestrel/process/server` | Render a `ProcessCommand` into its space-joined diagnostic command line.     |
| `mergeEnvironment`     | function | `@orkestrel/process/server` | Merge environment overrides over the parent environment; `undefined` unsets. |
| `trimTail`             | function | `@orkestrel/process/server` | Keep at most `limit` trailing bytes without splitting a UTF-8 sequence.      |
| `trimHead`             | function | `@orkestrel/process/server` | Keep at most `limit` leading bytes without splitting a UTF-8 sequence.       |
| `buildRunResult`       | function | `@orkestrel/process/server` | Assemble one frozen `RunResult` from captured bytes and an exit.             |
| `createDuplicateError` | function | `@orkestrel/process`        | Construct the `duplicate`-coded failure a manager raises on a reused id.     |
| `createRunError`       | function | `@orkestrel/process`        | Construct the failure a rejecting run throws, carrying its `RunResult`.      |

### Constants

The defaults, from `@orkestrel/process`.

| API                | Kind  | Value        | Summary                                                             |
| ------------------ | ----- | ------------ | ------------------------------------------------------------------- |
| `PROCESS_GRACE`    | const | `5_000`      | Default milliseconds between `SIGTERM` and `SIGKILL` during a stop. |
| `PROCESS_EVIDENCE` | const | `2_048`      | Default maximum retained stderr tail, in bytes, for a `Process`.    |
| `PROCESS_OUTPUT`   | const | `10_485_760` | Default maximum captured bytes for a run's stdout and stderr, each. |

### Types

The contracts and options, all from `@orkestrel/process`.

| API                       | Kind      | Summary                                                                                    |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `ProcessCommand`          | interface | One spawnable command — `file`, `arguments`, optional `environment` and `input`.           |
| `ProcessExit`             | interface | The terminal state — an exit `code`, or the `signal` that ended the child.                 |
| `ProcessEventMap`         | type      | A `Process`'s events — `stderr(chunk)` and `exit(exit)`.                                   |
| `ProcessOptions`          | interface | `Process` construction — `command`, `workspace`, `grace`, and optional settings.           |
| `ProcessInterface`        | interface | The supervised-child surface — `emitter` / `lines` / `evidence` / `exit` + methods.        |
| `RunResult`               | interface | A one-shot outcome — buffered `stdout` / `stderr`, the exit, `failed`, `timedOut`.         |
| `RunOptions`              | interface | `run` and `runSync` options — workspace, timeout, grace, signal, reject, limit.            |
| `ProcessManagerEventMap`  | type      | A manager's events — `launch(id)` and `exit(id, exit)`.                                    |
| `ProcessManagerOptions`   | interface | `ProcessManager` construction — initial `on` listeners and an `error` handler.             |
| `ProcessManagerInterface` | interface | The registry surface — `emitter` / `count` + the query, launch, stop, and destroy methods. |
| `ProcessErrorCode`        | type      | The failure categories — `spawn`, `timeout`, `duplicate`, or `protocol`.                   |
| `ProcessErrorContext`     | interface | Structured failure detail — `id`, `command`, `code`, `signal`, or `value`.                 |
| `ProcessErrorOptions`     | interface | `ProcessError` construction — `code` plus optional `context`, `cause`, `result`.           |

The `emitter`, `lines`, `evidence`, and `exit` members of `ProcessInterface`, and the `emitter` and
`count` members of `ProcessManagerInterface`, are readonly data properties (Surface rows). Their
call-signature methods are documented under [Methods](#methods).

## Methods

The public methods of each behavioral interface. `Process` implements `ProcessInterface` exactly,
and `ProcessManager` implements `ProcessManagerInterface` exactly, so each table doubles as the
class's instance-method surface.

### `ProcessInterface`

`send` writes one line to the child's stdin; `stop` and `destroy` are the lifecycle verbs. `send`
never throws — it reports whether the line reached an open channel. `stop` is idempotent, and
`destroy` returns one stable barrier shared by every call.

| Method    | Returns         | Behavior                                                                                             |
| --------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `send`    | `boolean`       | Write one line to the open stdin channel; true when it landed without backpressure, false otherwise. |
| `stop`    | `Promise<void>` | Terminate the child through `SIGTERM`, then `SIGKILL` after `grace`, and await its observed exit.    |
| `destroy` | `Promise<void>` | Stop the child, then destroy the observation emitter last; the stable barrier every call shares.     |

### `ProcessManagerInterface`

`process` and `processes` query the live registry; `launch` spawns and registers; `stop` is a
three-overload terminator; `destroy` tears the registry down. `stop` returns a `boolean` when you
name ids and `void` when you stop every child.

| Method      | Returns                         | Behavior                                                                                               |
| ----------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `process`   | `ProcessInterface \| undefined` | Return the live child under `id`, or `undefined` when none is.                                         |
| `processes` | `readonly ProcessInterface[]`   | Return a snapshot of every live child, in launch order.                                                |
| `launch`    | `ProcessInterface`              | Spawn and register one child under `id`; throw a `duplicate`-coded `ProcessError` on a live id.        |
| `stop`      | `Promise<boolean>`              | Terminate one named id, or every id in an array, and await their exit; false when any id was not live. |
| `stop`      | `Promise<void>`                 | With no argument, terminate every live child and await their exit.                                     |
| `destroy`   | `Promise<void>`                 | Stop every child, then destroy the registry emitter last; the stable barrier every call shares.        |

## Supervised children

`Process` spawns one child and captures its streams eagerly. Standard output drains through
`readline` whether or not you iterate `lines`, so `exit` resolves and a late consumer still receives
every framed line, including a final line written without a trailing newline. Standard error is
decoded and forwarded live as the `stderr` event, while a byte-bounded raw tail is retained as
`evidence` — the diagnostic to attach to a failed exit. The typed `emitter` also carries the
terminal `exit`, alongside the `exit` promise.

`ProcessOptions` requires `command`, `workspace`, and `grace`; the rest are optional:

| Option      | Type                            | Required | Meaning                                                                                                    |
| ----------- | ------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `command`   | `ProcessCommand`                | yes      | The executable, its argument vector, and optional environment overrides and stdin `input`.                 |
| `workspace` | `string`                        | yes      | The working directory the child runs in.                                                                   |
| `grace`     | `number`                        | yes      | Milliseconds between `SIGTERM` and `SIGKILL` when the child does not exit on the first signal.             |
| `evidence`  | `number`                        | no       | Maximum retained stderr tail in bytes. Default: `PROCESS_EVIDENCE` (`2_048`).                              |
| `writable`  | `boolean`                       | no       | When `true`, stdin stays open for `send`; when `false` or omitted, stdin closes after any initial `input`. |
| `signal`    | `AbortSignal`                   | no       | Aborting this signal terminates the child through the same bounded `stop`.                                 |
| `on`        | `EmitterHooks<ProcessEventMap>` | no       | Initial `stderr` and `exit` listeners installed at construction.                                           |
| `error`     | `EmitterErrorHandler`           | no       | Receives a listener's throw, isolated from the engine.                                                     |

`stop` terminates the child and awaits its exit. It sends `SIGTERM`, waits up to `grace`
milliseconds, then sends `SIGKILL` when the child has not exited. On a POSIX host the child leads its
own process group, so the signal reaches the whole tree; on Windows the signal reaches the child
directly. `stop` is idempotent — repeated calls return the same in-flight barrier — and a child that
exits on its own wins the signal race. `destroy` runs `stop`, then destroys the emitter.

```ts
import { createProcess } from '@orkestrel/process/server'

const controller = new AbortController()
const child = createProcess({
	command: { file: 'node', arguments: ['server.js'] },
	workspace: process.cwd(),
	grace: 2_000,
	writable: true, // keep stdin open for send
	signal: controller.signal, // abort terminates through the bounded stop
	on: {
		stderr: (chunk) => process.stderr.write(chunk),
		exit: ({ code }) => console.log(`server exited with code ${String(code)}`),
	},
})

child.send('reload') // true when the line landed without backpressure
// …later, cancel from the outside:
controller.abort()
await child.exit
console.log(child.evidence) // the retained stderr tail, at most PROCESS_EVIDENCE bytes
await child.destroy()
```

## One-shot runs

`run` runs a command to completion, buffers its output, and resolves a `RunResult`. `runSync` is the
blocking counterpart with the same options and result. Use them when you want the exit and the
captured output together, without managing a live stream.

`RunOptions` are all optional:

| Option        | Type                                  | Default               | Meaning                                                                  |
| ------------- | ------------------------------------- | --------------------- | ------------------------------------------------------------------------ |
| `workspace`   | `string`                              | current directory     | The working directory.                                                   |
| `environment` | `Record<string, string \| undefined>` | inherit the parent    | Overrides merged over the parent environment; `undefined` unsets a key.  |
| `input`       | `string`                              | the command's `input` | Standard input written to the child, overriding `command.input`.         |
| `timeout`     | `number`                              | `0` (disabled)        | Milliseconds before the child is terminated; `0` or omitted disables it. |
| `grace`       | `number`                              | `PROCESS_GRACE`       | The `SIGTERM` → `SIGKILL` window when a timeout or abort terminates.     |
| `signal`      | `AbortSignal`                         | none                  | Aborting this signal terminates the run.                                 |
| `reject`      | `boolean`                             | `true`                | When `false`, resolve with the result on failure instead of rejecting.   |
| `limit`       | `number`                              | `PROCESS_OUTPUT`      | Maximum captured bytes for stdout and for stderr, each.                  |

Four operational truths govern a run.

`reject: false` returns the outcome instead of throwing. By default a failed run rejects with a
`ProcessError` that carries the `RunResult` on its `result` property; a timed-out run carries code
`timeout`, and any other failure carries code `spawn`. Passing `reject: false` resolves with the
result even on failure, so you inspect `failed` yourself. A run is `failed` when it timed out, was
ended by a signal, or exited with a code other than `0`; a `null` code from a spawn fault is
therefore a failure.

```ts
import { run } from '@orkestrel/process/server'

// Rejecting form (the default): a non-zero exit throws.
const passing = await run({ file: 'node', arguments: ['--version'] })
console.log(passing.stdout) // for example, "v22.12.0\n"

// Non-rejecting form: inspect the outcome directly.
const outcome = await run({ file: 'git', arguments: ['status'] }, { reject: false })
if (outcome.failed) console.error(outcome.stderr)
```

Output is byte-bounded and truncates silently. Each of `stdout` and `stderr` is capped at `limit`
bytes (default `PROCESS_OUTPUT`, `10_485_760`), keeping the captured head and never splitting a
UTF-8 sequence. There is no truncation flag: a `RunResult` carries no signal that a cap was reached,
so set `limit` to a size that holds the output you need.

```ts
import { run } from '@orkestrel/process/server'

const capped = await run({ file: 'node', arguments: ['dump.js'] }, { limit: 64_000 })
// capped.stdout holds at most 64000 bytes; anything past that is dropped without a flag.
```

On Windows a `.cmd` or `.bat` file, or a bare command name such as `git`, runs through a shell.
Node refuses to spawn a Windows batch file directly, and a bare name resolves through `PATHEXT` to a
batch shim, so `requiresShell` routes both through the shell. When it does, treat the command `file`
and `arguments` as trusted input: a shell invocation exposes shell metacharacters, so an
attacker-controlled argument can inject a command. A POSIX host, and a Windows path carrying a real
executable extension such as `.exe`, spawn directly with no shell.

```ts
import { requiresShell, runSync } from '@orkestrel/process/server'

requiresShell('git') // true on Windows, false on POSIX
runSync({ file: 'git', arguments: ['rev-parse', 'HEAD'] }) // trusted file and arguments only on Windows
```

Termination reaches the spawned process. When a `timeout` elapses or `signal` aborts, the run sends
`SIGTERM`, then `SIGKILL` after `grace`. On a POSIX host the child is detached and leads its own
process group, so the signal reaches the whole tree. On a Windows shell-spawn the child is the shell,
so the signal reaches that shell.

## The keyed registry

`ProcessManager` holds live children by id. `launch` spawns a `Process` under an id, registers it,
and emits `launch`. A child that settles removes itself from the registry and emits `exit`, so
`count` and `processes` reflect only live children — this auto-eviction needs no polling. `launch`
throws a `duplicate`-coded `ProcessError` when the id is already live; a spawn fault does not throw
from `launch` but surfaces through the returned child's `exit`. `destroy` stops every child, then
destroys the registry emitter last.

```ts
import { createProcessManager } from '@orkestrel/process/server'

const manager = createProcessManager({
	on: {
		launch: (id) => console.log(`launched ${id}`),
		exit: (id, { code }) => console.log(`${id} exited with code ${String(code)}`),
	},
})

manager.launch('lint', {
	command: { file: 'npm', arguments: ['run', 'lint'] },
	workspace: process.cwd(),
	grace: 5_000,
})
manager.launch('test', {
	command: { file: 'npm', arguments: ['test'] },
	workspace: process.cwd(),
	grace: 5_000,
})

console.log(manager.count) // 2
await manager.stop(['lint', 'test']) // true when both were live and stopped
await manager.destroy()
```

The `stop` overloads terminate by scope. `stop(id)` and `stop(ids)` return `true` when every named
child was live and stopped, and `false` when any id was not live. `stop()` with no argument
terminates every live child and resolves `void`.

## Errors

`ProcessError` is the one failure type, carrying a stable machine-readable `code`. Narrow a caught
value with `isProcessError`, then branch on `code`.

| Code        | Raised when                                                     |
| ----------- | --------------------------------------------------------------- |
| `spawn`     | A rejecting run failed for a reason other than its own timeout. |
| `timeout`   | A rejecting run's own `timeout` elapsed before completion.      |
| `duplicate` | `ProcessManager.launch` reused an id that is already live.      |
| `protocol`  | Reserved for a protocol-level violation.                        |

A run failure carries its `RunResult` on `error.result` and its command line, exit `code`, and
`signal` on `error.context`. A duplicate-id failure carries the offending `id` on `error.context`.
The underlying cause, when one exists, is retained on `error.cause`.

```ts
import { run } from '@orkestrel/process/server'
import { isProcessError } from '@orkestrel/process'

try {
	await run({ file: 'node', arguments: ['migrate.js'] }, { timeout: 30_000 })
} catch (error) {
	if (isProcessError(error)) {
		if (error.code === 'timeout') console.error('migration timed out')
		else console.error(error.result?.stderr)
	}
}
```

## Observing

Both `Process` and `ProcessManager` expose a typed `emitter` for fire-and-forget observers —
logging, metrics, tracing. Subscribe through `child.emitter.on(...)` or `manager.emitter.on(...)`,
or wire initial listeners through the `on` option; supply an `error` handler to receive a listener's
throw. Emitting is observation-only: every event fires after the transition it reports, and a
throwing listener is isolated and routed to the `error` handler, never onto a domain event, so a
buggy observer cannot corrupt the engine.

| Event map                | Events                          |
| ------------------------ | ------------------------------- |
| `ProcessEventMap`        | `stderr(chunk)` · `exit(exit)`  |
| `ProcessManagerEventMap` | `launch(id)` · `exit(id, exit)` |

A `Process` emits `stderr` for each decoded standard-error chunk and `exit` once, with the terminal
`ProcessExit`, when the child settles. A `ProcessManager` emits `launch` when a child joins the
registry and `exit`, with the child's id and terminal state, when it settles and leaves.

```ts
import { createProcess } from '@orkestrel/process/server'

const child = createProcess({
	command: { file: 'node', arguments: ['worker.js'] },
	workspace: process.cwd(),
	grace: 5_000,
})

child.emitter.on('stderr', (chunk) => log.warn(chunk))
child.emitter.on('exit', ({ code, signal }) => metrics.record('worker.exit', { code, signal }))
```

## Patterns

### Collect output in one call

```ts
import { run } from '@orkestrel/process/server'

const { stdout } = await run({ file: 'git', arguments: ['rev-parse', 'HEAD'] })
const commit = stdout.trim()
```

### Stream a long-running child and cancel it

```ts
import { createProcess } from '@orkestrel/process/server'

const controller = new AbortController()
const child = createProcess({
	command: { file: 'node', arguments: ['tail.js'] },
	workspace: process.cwd(),
	grace: 1_000,
	signal: controller.signal,
})

setTimeout(() => controller.abort(), 10_000) // stop after ten seconds
for await (const line of child.lines) console.log(line)
await child.exit
await child.destroy()
```

### Supervise a fleet by id

```ts
import { createProcessManager } from '@orkestrel/process/server'

const manager = createProcessManager()
for (const task of ['lint', 'test', 'build']) {
	manager.launch(task, {
		command: { file: 'npm', arguments: ['run', task] },
		workspace: process.cwd(),
		grace: 5_000,
	})
}
// …on shutdown, stop everything and tear down:
await manager.destroy()
```

### Practices

- **Set `grace` to the child's real cleanup budget** — `stop` waits that long after `SIGTERM` before
  `SIGKILL`, so a child that flushes on shutdown needs enough of a window to finish.
- **Trust the command on a Windows shell-spawn** — a `.cmd`, a `.bat`, or a bare command name runs
  through a shell, so build its `file` and `arguments` from trusted values only.
- **Raise `limit` for large output** — a run truncates silently at `limit` bytes with no flag, so
  size it to the output you need rather than relying on the default.
- **Read `evidence` on a failed exit** — the byte-bounded stderr tail is the diagnostic to attach,
  bounded by `evidence` (default `PROCESS_EVIDENCE`).
- **Observe, do not drive** — subscribe to `emitter` for lifecycle moments; emitting is a pure
  side-channel, so a listener never changes what the engine does.

## Tests

- [`tests/src/core/index.test.ts`](../tests/src/core/index.test.ts) — the core barrel re-exports the
  types, constants, and error surface.
- [`tests/src/server/Process.test.ts`](../tests/src/server/Process.test.ts) — the supervised child:
  eager line framing including a trailing partial line, the byte-bounded `evidence` tail and live
  `stderr` event, `send` over an open channel, bounded `SIGTERM` → grace → `SIGKILL` termination,
  idempotent `stop`, abort-signal termination, and `destroy`.
- [`tests/src/server/ProcessManager.test.ts`](../tests/src/server/ProcessManager.test.ts) — the
  registry: `launch` registration and the `duplicate` throw, auto-eviction on exit, the query
  surface, the three `stop` overloads, and emitter-last `destroy`.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — the building blocks:
  `run` and `runSync` outcomes and the `reject` branch, `trimTail` and `trimHead` UTF-8-safe
  bounding, `requiresShell`, `commandLine`, `mergeEnvironment`, and `buildRunResult`.
- [`tests/src/server/index.test.ts`](../tests/src/server/index.test.ts) — the server barrel
  re-exports the factories, runners, engine classes, and helpers.

## See also

- [`@orkestrel/emitter`](https://github.com/orkestrel/emitter#readme) — the typed push-observation
  primitive each `emitter` is built on.
- [`@orkestrel/contract`](https://github.com/orkestrel/contract#readme) — the guard primitive
  `isProcessError` composes.
- [`AGENTS.md`](../AGENTS.md) — the repository coding, naming, and lifecycle rules.
- [`README.md`](README.md) — the guides index.
