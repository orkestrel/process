# @orkestrel/process

A typed **child-process toolkit** in tiers. `Process` supervises one
child: stdout is framed into lines under a bounded backlog, stderr is forwarded
live and kept as a byte-bounded tail, stdin is a writable channel, and
termination is bounded and reports whether the real exit arrived — `SIGTERM` then
`SIGKILL` after a grace window on a POSIX host, a whole-tree kill on Windows.
`execute` and `executeSync` buffer a child to completion and settle with an
`ExecuteResult` carrying the captured output, the exit, and `failed` /
`expired` / `aborted` / `truncated`, rejecting with a `ProcessError` by default
or resolving the result when you pass `strict: false`. `ProcessManager` is a
keyed registry of live children: `launch` spawns and registers by id, a settled
child evicts itself with no polling, and `stop` terminates one id, a list, or
every child. `Process` and `ProcessManager` expose typed `emitter` properties,
`Process` and `execute` accept `AbortSignal` cancellation, and no spawn uses a
shell, so a metacharacter in an argument is data rather than syntax. The
contracts are host-independent and ship from `@orkestrel/process`; the Node
engine ships from `@orkestrel/process/server`. Part of the `@orkestrel` line.

## Install

```sh
npm install @orkestrel/process
```

## Requirements

- Node.js >= 22.12.0
- ESM and CommonJS builds
- TypeScript `moduleResolution` set to `node16`, `nodenext`, or `bundler`

## Usage

```ts
import { execute } from '@orkestrel/process/server'

// One-shot: buffer a command to completion and read its output and exit.
const { stdout } = await execute({ file: 'node', arguments: ['--version'] })
console.log(stdout.trim()) // for example, "v22.12.0"
```

```ts
import { createProcess } from '@orkestrel/process/server'

// Supervised: stream a live child's framed lines and stop it on a bounded window.
const child = createProcess({
	command: { file: 'node', arguments: ['worker.js'] },
	workspace: process.cwd(),
	grace: 5_000, // POSIX only: milliseconds between SIGTERM and SIGKILL on stop
})

for await (const line of child.lines) console.log(line)
const exit = await child.exit // { code, signal }
await child.destroy()
```

## Guide

For the full surface — the supervised `Process`, the `execute` / `executeSync` /
`detach` spawns, the keyed `ProcessManager`, the observable `emitter`, the
`ProcessError` failure type, and the lower-level helpers — see
[`guides/process.md`](guides/process.md).

## Package

Typed entry points per the `exports` field in `package.json`: the
host-independent contracts, constants, errors, and `isProcessError` guard from
`@orkestrel/process`, and the Node engine — `Process`, `execute`, `executeSync`,
`detach`, `ProcessManager`, and their factories and helpers — from
`@orkestrel/process/server`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
