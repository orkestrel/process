# Handoff — @orkestrel/process 0.0.3 → the 0.0.4 session

Read this before planning any 0.0.4 work. It covers everything that changed between the 0.0.2 publish
and the 0.0.3 publish (the release this tree carries), the rulings a future audit must not re-litigate,
the boundaries that are deliberate, and the work already identified for a later minor. The deep
campaign record (design rounds, the fixed capability/defect matrix, three-lane falsify verdicts kept
verbatim, reconciliations) lives in the supervisor repo at `supervisor/.orkestrel/process/` — this file
is the orientation; that folder is the evidence.

## What 0.0.3 is

An owner-approved FULL BREAKING hardening. It was driven by: a Sol hardening review of 0.0.2 (found
~14 defects under pressure), four real adoptions (supervisor, mcp, sea, scaffold — their gap reports
fed the scope), a blind two-lane design round (11 of 14 draft decisions corrected before code), a
three-lane falsify round (objective source-reasoning, subjective design review, an executing attacker
running probes — all three returned FAIL), and a crossed fix audit. Every repair carries a red-first
test; the final seal ran every gate by direct exit: src 94 passed / 4 skipped, policy 86, config 28,
guides 51.

## The public-surface delta (0.0.2 → 0.0.3)

REMOVED: `requiresShell` (the concept is obsolete — nothing spawns with `shell: true` anymore),
`commandLine` (renamed).

RENAMED: `commandLine` → `formatCommand`; `RunResult.timedOut` → `expired`;
`RunOptions.reject` → `strict` (same semantics, default `true`).

SIGNATURE CHANGES:
- `ProcessInterface.send(text): Promise<boolean>` — an async delivery confirmation. NEVER rejects.
  `true` = the write callback fired without error; `false` = closed/ended/destroyed/errored or the
  process is not `writable`. Backpressure is latency, not an outcome. Settlement is guaranteed by
  teardown: `destroy()` destroys stdin, which errors any pending write callback.
- `ProcessInterface.stop(): Promise<boolean>` — `true` when the NATIVE `exit` event was observed
  (tracked separately from `close`); `false` when `PROCESS_CONFIRMATION` (5000 ms) elapsed without it.
  NEVER rejects. No signal is initiated after an observed native exit.
- `destroy(): Promise<void>` — an always-resolving barrier: await stop, destroy stdin, destroy the
  emitter LAST.
- `mergeEnvironment(isolated, base?, override?)`; `buildRunResult(input: RunInput)`;
  `trimHead`/`trimTail` accept `Uint8Array`; `runSync(command, options?: RunSyncOptions)` — no `grace`
  (spawnSync kills with SIGKILL, no window) and no `signal` (probed: spawnSync ignores it entirely);
  `ProcessOptions.grace` is now optional (default `PROCESS_GRACE`; POSIX-only cooperative phase).

NEW core: `ProcessOptions.backlog` (default `PROCESS_BACKLOG` = 10485760, must be ≥ 1),
`ProcessCommand.isolated` (default false = inherit), `RunResult.aborted` + `truncated`,
`ProcessErrorCode` gains `'invalid'`, constants `PROCESS_BACKLOG`/`PROCESS_CONFIRMATION`/
`PROCESS_TIMER`/`PROCESS_PATHEXT`, factories `createInvalidError`/`createProtocolError`, types
`RunInput`/`RunSyncOptions`/`DetachOptions`/`SpawnInput`/`ExecutableOptions`.

NEW server: `detach` (fire-and-forget: validate → resolve → error listener before `unref()` →
`detached: true, stdio: 'ignore'`), the `ProcessChild` structural contract (in the new
`src/server/types.ts` — the one named shape the four termination helpers share), and the helper
families `buildSpawn`, `resolveExecutable`, `quoteArgument`, `readVariable`, `formatCommand`,
`isExited`, `isFile`, `killTree`, `stopChild`, `waitForExit`, `retainChunk`, and five `validate*`
helpers plus `validateEnvironment`. The 16-helper surface is deliberate: five prefix families with one
meaning each, every one a piece a public entry point composes.

## The behavioral contract 0.0.3 established (each has a pinning test)

1. **No implicit shell, ever.** Bare commands resolve through the EFFECTIVE child environment's PATH
   (workspace directory first, PATHEXT with the `.COM;.EXE;.BAT;.CMD` default, regular files only,
   `undefined` on absence). A resolved `.cmd`/`.bat` runs through an explicitly QUOTED
   `cmd.exe /d /s /c` line — and this whole batch branch is WIN32-ONLY (a POSIX file named `x.cmd`
   spawns directly). `DEP0190` cannot fire. A `%`-bearing argument to a batch target is REFUSED with
   `invalid` because `cmd.exe` expands `%NAME%` before quote parsing (attacker-proven) — that refusal
   is what keeps "arguments are data, never syntax" true.
2. **Termination.** POSIX: `SIGTERM` to the group → `grace` → `SIGKILL` to the group. Windows: no
   cooperative phase; an async, bounded `taskkill /F /T` (absolute System32 path) kills the tree WHILE
   THE ROOT LIVES; after the root exits, descendants are unreachable (documented; Job Objects are the
   excluded fix). The stale-PID check-then-signal window is inherent and documented; the code
   re-checks `isExited` before every signal.
3. **The backlog.** A soft high-water mark on unconsumed `lines` bytes, each line charged
   `byteLength + 1` (empty lines cost — this was a falsify-round defect). Policy derives from consumer
   intent: once an iterator is requested, stdout pauses at the mark and resumes at 50% (lossless —
   proven at `backlog: 1` with 4096 ordered lines); while none ever has, draining continues and
   retention caps (so `exit` still resolves — pause-always would BLOCK a chatty child before it can
   exit, probed). Pausing never happens after termination begins; teardown resumes the stream so
   `close` can fire. Overshoot bound: one delivered stream chunk plus one line (readline delivers the
   in-flight chunk after a pause — measured, ~490 lines per 64 KiB chunk).
4. **`lines` is a single-consumer stream**; `exit` follows Node's `close` (all stdio drained), so a
   descendant holding the pipe delays `exit` and an UNBOUNDED `run` awaits stdio completion by design —
   callers pass `timeout` where descendants may inherit stdio.
5. **Validation is total.** Every spawn-bound string (file, each argument, workspace, env keys/values
   on BOTH the command and the per-run override) refuses NUL with `invalid`; empty env keys refuse;
   timer values cap at `2_147_483_647` (Node truncates larger to 1 ms); `backlog >= 1`; constructors,
   `runSync`, and `detach` throw synchronously; `run` REJECTS before spawning (an async function
   cannot throw synchronously — documented).
6. **`run` first-wins.** `aborted`/`expired` are distinct causes recorded atomically (the loser's timer
   clears); a post-spawn child `error` (a failed signal) never settles as a spawn failure (`spawned`
   phase flag); the result family is `failed`/`expired`/`aborted`/`truncated`, and `failed` includes
   abort and sync overflow. `runSync` overflow: `maxBuffer` terminates (`ENOBUFS` → `truncated: true`,
   `failed: true`, cause threaded, outputs trimmed); async `run` head-truncates without failing.
7. **The manager is unforgeable.** Eviction follows the private `child.exit` promise (a forged
   `emitter.emit('exit')` does nothing; a destroyed child emitter blocks nothing); ids reserve BEFORE
   construction and release on a construction throw; every caller-supplied option is read exactly once
   BEFORE the spawn (the constructor hoists all twelve reads — a post-spawn getter can no longer
   strand a child); `launch` after `destroy` throws `protocol`; a launch RACING destroy has its child
   torn down asynchronously (bounded) and throws `protocol` — the settled barrier does not extend to
   it (the documented bounded residual). Eviction lands one MICROTASK after the child's own exit
   listeners.
8. **Stdin faults are swallowed by design** (this fixed real dead-stdin crashes in consumers); a wedged
   peer surfaces through `send`'s `false` at teardown and the consumer's own timeout. `isolated: true`
   makes the child env the overrides alone — except the host set libuv injects on Windows (`PATH`,
   `SYSTEMROOT`, `TEMP`, …), documented.

## Rulings a future audit must NOT re-litigate (each is recorded with rationale)

- `run`/`runSync` stems retained: the fixed lifecycle table governs ENTITY members; these are
  standalone command runners (`names.md` tension examined and ruled; see the guide's vocabulary note).
- `process(id)`/`processes()` are the patterns-law manager accessors (singular/plural nouns), not
  bare-verb violations.
- `strict` (not `reject`) is the failure-throw switch; `evidence` names both the option (the bound) and
  the property (the subject) under the byte-bound naming rule (bound-named when an entity has one:
  `limit`; subject-named when several: `evidence`, `backlog`).
- The TOCTOU between `isExited` and a signal is inherent to userspace; do not "fix" it.
- The empty-env-key refusal is correct and documented.
- `destroy()` resolving with a poisoned `SystemRoot` and a live child was REPRODUCED — the barrier
  holds; do not add defensive try/finally the evidence says is unneeded.
- A spawn-faulted child's `stop()` returns `true` in ~0 ms — reproduced; the claimed 5-second burn was
  a false derivation.
- `signal.aborted` is deliberately NOT hoisted in the Process constructor: an early read plus later
  listener registration opens a real abort-miss window, and `AbortSignal` is a platform type outside
  the getter-stranding class.

## Look out for (known limits, quirks, and 0.0.4 candidates)

1. **Four tests are POSIX-gated and have NEVER run on a POSIX host**: the group-kill-with-descendant
   proof, the `SIGTERM` → grace → `SIGKILL` escalation (the `trap` fixture exists precisely for it),
   the POSIX resolver passthrough, and the batch-named-file direct spawn. FIRST TASK on any POSIX host:
   run the suite there.
2. **Windows Job Objects** — the excluded fix for post-root-exit descendants. The honest boundary is
   documented; a real tree guarantee is a 0.0.4+ design round, not a patch.
3. **Per-stream truncation** — `truncated` covers both streams with one flag; a consumer parsing
   `stdout` structurally cannot tell which overflowed. Recorded question, deliberately deferred.
4. **The guides gate binds fence VALUES, not comment text** (`tests/guides.test.ts` transcribes the
   flagship fences): editing a fence's `// value` comment without its transcription still passes. The
   test header says so.
5. **API Extractor prints a version notice** (bundled TS 5.9.3 vs project 6.0.3) on every build.
   Non-fatal today; upgrade when upstream ships a 6.x engine.
6. **`createProcess`/`createProcessManager` have ZERO fleet consumers** (swept); they exist as the
   factory convention. `killProcess`/`killTree`/`stopChild`/`waitForExit` are exported so a consumer
   can compose a custom bounded stop — the guide's fence shows the SAFE composition (never signal a
   child `stopChild` confirmed dead).
7. **`detach` returns `void`** — a pid return was considered and dropped (fire-and-forget; a caller
   wanting supervision uses `Process`). Revisit only with a real consumer.
8. **The `%`-refusal for batch targets** fails closed. If a real consumer must pass `%` to a `.cmd`,
   that is a design round (there is no reliable cmd.exe escape), not a relaxation.
9. **`lines` multi-consumer** (fan-out) was NOT built — single-consumer is documented. A second real
   consumer wanting it makes it a 0.0.4 candidate.
10. **Adopter states at handoff**: supervisor re-adopted and committed in its own repo; mcp, sea, and
    scaffold carry uncommitted re-adoption diffs pending owner review. scaffold now has a RUNTIME dep
    on process, so any scaffold bump is a fleet re-pin wave. sea recorded one successor unit
    (`SEAOptions.timeout`); mcp's guide prose near line 4187 predates its own 0.0.2 adoption and needs
    a refresh in that repo.
11. **Test discipline in this repo**: red-first per repair (the suite's tests were each proven to fail
    against the code before their fix); probes live ONLY in `tmp/probe/**` (the `probe` Vitest project,
    never collected by a gate) and are deleted after use; on a Windows host judge every gate by DIRECT
    exit (`npm run <gate>; echo "EXIT=$?"`) — a pipe masks the code.

## Verification map

`tests/src/server/Process.test.ts` (backlog, termination, send, destroy, tree-kill),
`tests/src/server/helpers.test.ts` (resolver, builder, validators, run/runSync, first-wins),
`tests/src/server/ProcessManager.test.ts` (reservation, forgery, destroy races),
`tests/src/server/fixtures/child.mjs` (modes incl. `trap`, `empty`, `announce`),
`tests/guides.test.ts` (59↔59 export parity both directions + 12 executed fences),
`tests/src/core/index.test.ts` + `tests/src/server/index.test.ts` (barrel membership).
Gates: `format:check` → `lint:check` → `check` → `build` → `npm test` (src, policy, config, guides).

## Upstream adopters — the 0.0.3 consumers, their republish state, and what to look for

Four repos adopted this package. supervisor consumes it directly at runtime; mcp and sea gained it as
a runtime dependency; scaffold gained it as a RUNTIME dependency of the fleet's tooling package, which
has fleet-wide consequences (see the scaffold entry). All three upstream repos were release-prepped
against the published 0.0.3 (registry-resolved installs, versions bumped from what the registry
serves, own gates green) and the owner republishes them.

### supervisor (committed in its own repo; not republished in this pass)

`ProviderExecutionInterface.send` is now `Promise<boolean>` (the package's delivery confirmation
propagated up); `ProviderExecution.stop()` keeps its `Promise<void>` bounded-termination contract by
awaiting and discarding the package boolean; `ProviderExecutor` awaits the confirmation so an
undelivered steer answers `PROTOCOL` instead of success; `CLIProvider` needed no change (proven, not
assumed). Supervisor pins `@orkestrel/process ^0.0.3`, registry-resolved.

### mcp — prepared as 0.0.19 (was 0.0.18)

- The one behavioral change: `StdioClientTransport.send` now AWAITS the package `send` and rejects
  with its established not-connected error when the answer is `false`. The unawaited 0.0.2 form was a
  floating promise that resolved before delivery — the compiler does not catch this pattern, so any
  future consumer of `Process.send` inside an `async (): Promise<void>` deserves the same scrutiny.
- A red-first test pins it: a 256 KiB payload to a never-reading child stays pending, then rejects
  when `close()` destroys the channel. Probe fact worth keeping: on Windows, a child closing its own
  stdin read handle does NOT fault the parent's write — only channel death under an undelivered write
  produces `false` with a live-then-dead peer.
- CARRIED DEBT (not this release): `guides/mcp.md` prose near line 4187 still describes the pre-0.0.2
  `node:child_process` transport (replace-env, kill-on-close). Guide parity passes because it proves
  names, not prose. Refresh it in mcp's next documentation pass.
- Consumer ripple: supervisor lists mcp in `devDependencies` (`^0.0.18`) — re-pin to `^0.0.19` on
  supervisor's next dependency pass.

### sea — prepared as 0.0.9 (was 0.0.8)

- `result.timedOut` → `result.expired`; both `reject: false` sites → `strict: false`; `openBrowser`
  now launches through the package `detach` (detached, unref'd, output-discarded — the semantics its
  old `void run(...)` could not express; the `invalid` throw path is provably unreachable from its
  validated URLs).
- RECORDED SUCCESSOR UNIT (sea's, not this package's): `SEAOptions` exposes no `timeout`, so its
  `runShell` sites cannot bound a signing tool that spawns stdio-inheriting descendants. Measured
  inert on Windows (`runSync` returns at child exit and drops later grandchild bytes) — a POSIX host
  may read to EOF differently. Adding `SEAOptions.timeout` is the fix if it ever bites.
- Consumer ripple: supervisor lists sea in `devDependencies` (`^0.0.8`) — re-pin to `^0.0.9`;
  supervisor's `ApplicationServerRunner` binds sea's `openBrowser` as its default opener, so it
  inherits the corrected detach semantics with no code change.

### scaffold — prepared as 0.0.44 (was 0.0.43) — THE FLEET-WIDE ONE

- The one code change: its git inventory (`src/bin/CLI.ts`) runs through `runSync` with
  `strict: false`; bare `git` resolves through PATH+PATHEXT with NO shell (measured: `git.EXE`, no
  `DEP0190`).
- scaffold now carries `@orkestrel/process` in runtime `dependencies`. scaffold is a devDependency of
  EVERY fleet package, so: (a) scaffold's own publish is obligatory (a runtime-dep addition moves the
  published surface), and (b) the next scaffold propagation wave re-pins `@orkestrel/scaffold` to
  `^0.0.44` across ALL packages — on-disk and off-disk — which pulls this package transitively into
  every dev tree. The deferred release-wave runbook
  (`supervisor/.orkestrel/scaffold-0.0.42-propagation.md`) was written for 0.0.43 and was never
  executed: SUPERSEDE it — the wave now targets 0.0.44 directly, same procedure.
- The version-coupled cascade was reset for 0.0.44 (the self-pin in `src/core/constants.ts`, the
  golden digest in `tests/src/core/compilers.test.ts`, the fixture pin in
  `tests/src/core/fixtures/setup-false-manifest.txt`). Any future scaffold bump repeats exactly that
  three-file reset.
- scaffold's `guides/process.md` MIRROR still documents the 0.0.2 surface (shared `RunOptions`,
  synchronous boolean `send`, no `truncated`, four error codes, `requiresShell`). Refresh the mirror
  from this package's canonical guide during the propagation wave.

### Post-republish verification recipe (for whoever runs it)

1. `npm view @orkestrel/{mcp,sea,scaffold} version` serves 0.0.19 / 0.0.9 / 0.0.44 (a first-publish or
   bump can lag on the CDN — re-read before calling a failure).
2. In each repo: `npm ls @orkestrel/process` exits 0 and resolves 0.0.3 from the registry.
3. supervisor's later dependency pass: re-pin mcp `^0.0.19` and sea `^0.0.9` in `devDependencies`.
4. The scaffold 0.0.44 propagation wave is its own owner-driven campaign (the superseded runbook has
   the per-target visit procedure); it is NOT part of this package's 0.0.4 work — but 0.0.4's
   publish, if it happens first, changes the pin the wave re-declares, so coordinate the order.
