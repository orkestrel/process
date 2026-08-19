# P1 — close the seven POSIX failures for 0.0.4

## Role and engine

`sol` (GPT-5.6 Sol), a direct `codex exec`. You are the engine reading this inside your own CLI:
perform the assignment directly and spawn nothing.

## The finding that shapes this unit

`HANDOFF.md` named running the suite on a POSIX host as the first task on such a host, because four
tests were POSIX-gated and had never executed anywhere. That run happened. Seven tests fail.

**Zero of them are product defects.** Four blind diagnosis lanes classified each failure as PRODUCT,
TEST, or CONTRACT with executed evidence. Six are defects in tests and fixtures; one is a defect in
published guidance. The full record is `.orkestrel/process/posix-first-run.md` and the lanes'
reconciliation. Read both before touching anything.

**Do not "fix" runtime behaviour to make a test pass.** The backlog is lossless on POSIX, the
termination sequence escalates correctly, and the manager tears down and refuses exactly as contract
item 7 requires. Each of those was proven by driving the real code against a corrected fixture. If you
find yourself editing `src/server/Process.ts` or `src/server/ProcessManager.ts` to turn a test green,
stop and report — you have found something the lanes did not, and it needs a ruling before a repair.

## Context

`/workspace/process`, branch `main`, version 0.0.3. Read `AGENTS.md`, `.claude/rules/tests.md`,
`.claude/rules/typescript.md`, and `.claude/rules/documentation.md` first. Then read `HANDOFF.md` in
full, **especially "Rulings a future audit must NOT re-litigate"**. Nothing below reopens one.

Every failure was reproduced. Run each repair's test before and after.

## The repairs

### 1. The `chatty` and `empty` fixtures truncate themselves

Closes `drains output with no line consumer and still resolves exit` and `loses no line for a consumer
holding a chatty child at the backlog mark`. One defect, not two.

`tests/src/server/fixtures/child.mjs` writes 4096 lines then calls `process.exit(0)`, which discards
the child's own queued bytes. Measured in the child immediately before exit:
`backpressured=3287 queued=505703`. The loss reproduces with plain `spawn` and no package code; a
control omitting `process.exit` delivers 4096 of 4096 five times out of five.

Node makes a child's stdout pipe blocking on **Windows only**, so the synchronous write loop
self-throttles there and the queue is empty at exit. On POSIX it is not.

**Repair:** delete `process.exit(0)` from the `chatty` branch and from the `empty` branch. Both hold no
handles and exit 0 when stdout flushes. The `empty` mode has the same latent defect and passes today
only because its assertions are loose — fix it in the same edit.

### 2. The `trap` test signals before the fixture installs its handler

Closes `escalates to SIGKILL when the child traps SIGTERM and stays alive`.

`stop()` runs ~3 ms after spawn; Node needs ~50-60 ms to reach `process.on('SIGTERM', …)`. The signal
lands on a process still carrying the default disposition, so it dies immediately and there is nothing
to escalate past. Measured: SIGTERM at 0/20/40 ms yields `signal=SIGTERM`; at 60/400 ms yields
`signal=SIGKILL`.

**Repair:** write `trapped\n` from the `trap` branch **after** registering the handler, and have the
test read one line from `child.lines` before `stop()`. **Do not use a fixed delay** — that trades a
race for a slower race.

### 3. The grandchild test reads a zombie as alive

Closes `kills a grandchild through the process group while the root is still live`.

`process.kill(pid, 0)` succeeds against a zombie until PID 1 reaps it, measured at 1250 ms on this
host, so the post-stop assertion tests the PID table rather than liveness.

**Repair:** replace the post-stop `process.kill(pid, 0)` probe with a pipe-release observation —
`Promise.race` of `child.exit` against a bounded delay, expecting the closed outcome. Keep the pre-stop
liveness assertion. **Do not lengthen the delay.**

### 4. The `stopChild` stub watches a channel POSIX never uses

Closes `stopChild > signals a live child and reports an unconfirmed termination`.

The stub records `kill`, but on POSIX `killProcess` calls `process.kill(-pid, signal)` and never
`child.kill`. The signal is sent to the correct target and is simply unobservable on the watched
channel. Line 443 (`confirmed === false`) already passes, so the return value is right.

**Repair:** set the stub's `pid` to `undefined`, routing both hosts through the direct `child.kill`
branch and keeping every assertion host-independent.

**Record in your report** that this drops the Windows `killTree` branch from this test's coverage. Do
not patch `process.kill`.

### 5. The manager race test observes a child POSIX kills before it boots

Closes `refuses a launch whose own options destroyed the registry mid-construction`.

The zero is a `pid` read from the `announce` marker file, not a signal count. `void child.destroy()`
runs synchronously down to `process.kill(-pid, 'SIGTERM')` inside `launch`, and the fixture needs
~46 ms of Node bootstrap before it can write. On Windows `killTree` spawns `taskkill.exe` and waits,
which handed the child enough time.

**Repair:** keep the host-independent assertions (the `protocol` throw and `manager.count === 0`)
unconditional. Retain the marker/pid proof under `process.platform === 'win32'`. On POSIX assert the
marker never appears within a bounded window.

**A weakness you must carry into your report, not resolve:** the POSIX branch proves only a negative,
so a change that stopped spawning the child at all would also pass it. State that limit in a comment
above the POSIX branch, in the words the test can be held to.

### 6. The `isolated` fence throws `ENOENT` on POSIX — published guidance

Closes `guides > reads the isolated environment fence back from the child`. This is the CONTRACT one.

The fence combines `isolated: true` with a bare `node`. `isolated` makes the child environment the
overrides alone, so it has no `PATH`, and POSIX `execvp` resolves a bare name against the **child's**
environment. On Windows libuv injects `PATH` and friends into any explicit environment, so it resolved
there. The package's own `resolveExecutable` returns `undefined` under isolation on **both** platforms
— the divergence is libuv's, not this package's.

**Repair, all three parts:**

- `guides/process.md` fence (around lines 448-461): change `file: 'node'` to `process.execPath`. The
  fence's subject is what the child environment *contains*, and an absolute path preserves that
  subject while making the example run on both hosts. Verified: the fence's two claimed values are
  then exactly right on POSIX — `TOKEN` present, `SYSTEMROOT` absent.
- `guides/process.md` `isolated` paragraph (around lines 432-436): add one sentence stating that
  `isolated: true` removes `PATH`, so a bare command name cannot resolve on a POSIX host — pass an
  absolute file, or include `PATH` among the overrides.
- `guides/process.md` around line 388: sharpen it. It currently reads as though POSIX resolution is
  unconditional. POSIX resolution is `execvp` against the child's **effective** `PATH`.
- `tests/guides.test.ts:405-416` is the fence's transcription and follows it: change `file` to
  `process.execPath`, keep both assertions, and update the comment above it, which today explains only
  the Windows injection.

**Refused, do not implement:** making `isolated` retain `PATH` on POSIX (it contradicts the shipped
semantic), and resolving against the caller's `PATH` (it contradicts settled contract item 1).

### 7. `killProcess` is a silent no-op over a non-detached POSIX child

No failing test. Found adjacent and reproduced independently:

```text
group-signal result: ESRCH
alive after group signal: true
detached group-signal: delivered alive: false
```

`process.kill(-pid)` fails `ESRCH` against a pid owning no process group, and the throw is swallowed.
The package's own children are unaffected — `Process` always spawns `detached: true` on POSIX — but
`killProcess` and `stopChild` are **exported for consumer composition**, which `HANDOFF.md`
"Look out for" item 6 actively advertises.

**This is the unit's one product change.** In `killProcess`'s POSIX branch, fall back to
`child.kill(signal)` when the group signal throws `ESRCH`. That makes the helper work for a direct
child and is a no-op for a live detached group.

Prove both halves with a red-first test: a non-detached child is now signalled, and a detached child's
group signal still reaches the whole group. Then state the behaviour in the TSDoc of `killProcess` and
`stopChild`, and in the guide's termination-helpers section.

If you judge the fallback wrong, **stop and report** rather than implementing a variant.

## Ordering

Repairs 1, 2, and 3 touch `tests/src/server/fixtures/child.mjs` and `tests/src/server/Process.test.ts`.
Do them in one pass, not as separate edits racing each other.

## Scope

Owned: `tests/src/server/fixtures/child.mjs`, `tests/src/server/Process.test.ts`,
`tests/src/server/helpers.test.ts`, `tests/src/server/ProcessManager.test.ts`, `tests/guides.test.ts`,
`guides/process.md`, and `src/server/helpers.ts` **for repair 7 only**.

Off-limits: `src/server/Process.ts`, `src/server/ProcessManager.ts`, every other file under `src/`,
`package.json` (the version bump is the Orchestrator's), and `.orkestrel/`.

## Execution

Perform this assignment directly. Spawn nothing.

## Acceptance criteria

Cheap non-timing gates first, deliberately.

1. `npm run format:check`, `npm run lint:check`, and `npm run check` each exit 0.
2. Each of the seven failures passes, proven red-before and green-after with the exact command.
3. No file under `src/` changed except `src/server/helpers.ts`, and that only for repair 7.
4. Repair 7 has a test that fails against the current `killProcess` and passes after.

**`npm run build` and the test projects are observations, not criteria.** Run them, report each command
and its bare exit code, and report both readings for anything you re-run. Your own exec is load, so a
whole-suite timing failure read from inside it is a question rather than an answer — the Orchestrator
takes the authoritative run after you exit. **Judge every gate by direct exit (`npm run <g>; echo $?`);
a pipe masks the code.** That already bit this session once.

## Deviation contract

Stop and report if a repair needs a file you do not own, if making a test pass would require editing
runtime behaviour outside repair 7, or if repair 7's fallback looks wrong to you. How you word a guide
sentence, where a comment sits, and how you name a fixture line are yours to decide and carry on from.

## Output

**Per numbered repair: what changed and why**, **Files written**, **Red-then-green proofs** with exact
commands and both counts, **Validation** (each gate, bare exit code), **Coverage you removed** (repair
4), **The weakness you carried** (repair 5), **Deviation**, **Decisions**. No process diary.
