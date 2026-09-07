# @orkestrel/process

> A typed child-process toolkit in tiers: the supervised `Process` with framed stdout lines and a
> writable stdin channel, the byte-oriented `Session`, the buffered `execute` and `executeSync`
> runs, the fire-and-forget `detach`, and the keyed `ProcessManager` registry, none of them spawning
> through a shell.

Spawn a supervised child with the `createProcess` function, read the lines it frames, and call
`stop()` to end it on a bounded window. Reach for `execute` where you want the captured output and
the exit in one call, and for `ProcessManager` where you supervise several children by id. The
contracts ship from `@orkestrel/process` and the Node engine from `@orkestrel/process/server`. Part
of the `@orkestrel` line.

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

For the full surface — the supervised `Process`, the byte-oriented `Session`,
the `Supervisor` engine a consumer composes its own face over, the
`execute` / `executeSync` / `detach` spawns, the keyed `ProcessManager`, the
observable `emitter`, the `ProcessError` failure type, and the lower-level
helpers — see
[`guides/process.md`](guides/process.md).

## Package

Typed entry points per the `exports` field in `package.json`: the
host-independent contracts, constants, errors, and `isProcessError` guard from
`@orkestrel/process`, and the Node engine — `Process`, `Session`, `Supervisor`,
`execute`, `executeSync`, `detach`, `ProcessManager`, `createSession`, and their
sibling factories and helpers — from `@orkestrel/process/server`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
