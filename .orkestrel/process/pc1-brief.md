# PC1 — the two correctness blockers, and the leaks beside them

## Role and engine

`sol` (GPT-5.6 Sol), direct `codex exec`. You are the engine reading this inside your own CLI:
perform the assignment directly and spawn nothing.

## Why this unit is first

A six-lane production-readiness audit graded this package **not ready, four blockers**. The grade is
`.orkestrel/process/readiness-grade.md` — read it, and read `HANDOFF.md`, before you start.

The audit was clear that this package is in a different class from its sibling: its published surface
is executed end to end and holds. These are real defects in an otherwise sound package, not a
rebuild.

**Do not re-litigate a settled ruling.** `HANDOFF.md` § "Rulings a future audit must NOT re-litigate"
binds. Nothing below reopens one.

## The repairs

### Q4 — `isProcessError` returns `false` for a genuine `ProcessError`

**This is the time-critical one.** The defect is pre-existing in 0.0.3, but 0.0.4 is what opens the
multi-version window across `mcp`, `scaffold`, `probe`, and `supervisor` — and across that window the
guard silently returns `false` for failures this package itself threw. Two copies already coexist in
this repository's own tree, and it also fails across this single tarball's own ESM/CJS boundary.

Brand the error so identity survives a copy boundary. The audit's own suggestion is a
`Symbol.for('@orkestrel/process.error')` own property set in the constructor; use it or a better
mechanism you can defend, and say which you chose and why.

The test must load **two copies in one process** and assert:

- `true` for a `ProcessError` from the other copy;
- `true` across the ESM/CJS boundary of this tarball;
- `false` for a plain `Error` — control;
- `false` for a **shape-only lookalike** that sets the same own property without being one — control.

Both controls are required. A branding check that admits a lookalike has replaced one defect with a
worse one.

### Q3 — every command string is validated on one read and spawned from another

For a library whose only job is spawning processes, this is not an ergonomics gap. A getter answering
differently on the second read defeats `validateCommand` in **all four** entry points, the thrown
error is a host `TypeError` rather than the `ProcessError` coded `invalid` every `@throws` tag
promises, and the validated `file` is not necessarily the spawned file.

Each entry point snapshots `file`, `arguments`, `environment`, `input`, and `isolated` into locals
**once**, validates the snapshot, and passes that same snapshot to `buildSpawn`, `mergeEnvironment`,
and `formatCommand`.

The test uses a getter that changes on the second read and asserts a `ProcessError` coded `invalid`
**and** that the spawned file equals the validated one. Both halves.

### Q5, Q6 — two handle leaks, measured

- `destroy` leaves the caller's `AbortSignal` listener attached. `#teardown` must remove it as
  `#close` does. Test: `getEventListeners(signal, 'abort').length === 0` after `destroy()` on a child
  whose `close` has not arrived. The audit measured 1, 2, 3, 4, 5 across five instances — a monotonic
  leak.
- `waitForExit` retains its `exit` listener when its deadline wins. Test: `listenerCount('exit') === 0`
  after twelve deadline-expiring calls. Node printed `MaxListenersExceededWarning` during the probe.

## A host constraint you will hit

This executor's sandbox denies **nested** child creation with `EPERM` — a child spawning its own
child. A previous unit hit exactly this. Spawn-dependent tests may therefore fail inside your exec for
a reason that is not the product.

When that happens: **record it as an observation, name the exact command that would settle it, and
carry on.** Do not substitute a weaker instrument and present its result as a proof. The Orchestrator
re-runs every spawn-dependent test on the host after you exit.

## Scope

Owned: `src/core/errors.ts`, `src/core/validators.ts`, `src/core/types.ts`, `src/server/helpers.ts`,
`src/server/Process.ts`, and the matching files under `tests/src/`.

Report-only: `guides/process.md` — a later unit owns the guide. If a repair here changes documented
behaviour, say exactly which sentence must move and leave it.

Off-limits: `package.json` (the version is the Orchestrator's), `.orkestrel/`, `HANDOFF.md`.

## Execution

Perform this assignment directly. Spawn nothing.

## Acceptance criteria

1. `npm run format:check`, `npm run lint:check`, and `npm run check` each exit 0.
2. Q4's test loads two copies and passes all four assertions, including both controls, proven
   red-then-green.
3. Q3's test proves both halves — the `invalid` code and the spawned-equals-validated file — proven
   red-then-green.
4. Q5 and Q6 each have a listener-count test, proven red-then-green.
5. No settled `HANDOFF.md` ruling is reopened.

**`npm run build` and the test projects are observations, not criteria** — report each command and its
**bare** exit code; a pipe masks it.

## Deviation contract

Stop and report if a repair needs a file you do not own, if closing Q4 would change the public error
shape in a way the guide contradicts, or if a settled ruling blocks a repair. The branding mechanism,
the snapshot's internal shape, and test naming are yours to decide and carry on from.

## Output

**Per numbered row: what changed and why**, **Files written**, **Red-then-green proofs** with exact
commands and both counts, **The controls and what each proved**, **Validation** (each gate, bare exit
code), **Spawn-dependent tests you could not run**, **Guide sentences that must move**, **Deviation**,
**Decisions**. No process diary.
