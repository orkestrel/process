# PC2 — cap the teardown drain, and correct the bound that hid it

## Role and engine

`sol` (GPT-5.6 Sol), direct `codex exec`. Perform the assignment directly and spawn nothing.

## The defect

Row Q1 of `.orkestrel/process/readiness-grade.md`, a release blocker. Read the grade first, then
`HANDOFF.md`, and do not reopen a settled ruling there.

`stop()` retains unbounded memory. Measured, one call, `backlog: 1024`, a SIGTERM-trapping flooding
child, one iterator that stopped draining:

```text
drained_lines=147869  drained_bytes=29721480
heap_before_stop=6352984  heap_after_stop=51403728  delta=45050744
```

The queue passed its 1 KiB mark by **29,000×** and the parent heap grew **45 MB** inside one `stop()`.

## The mechanism, and why the current behaviour is deliberate

```text
$ sed -n '314,321p' src/server/Process.ts
	async #kill(): Promise<boolean> {
		// A paused stdout holds the child's own write, and therefore its exit, so backpressure is
		// released before anything is signalled and never reapplied.
		this.#terminating = true
		this.#relieve()
```

and `#restrain` returns early once `#terminating` is set.

**That comment is correct and the design reason behind it stands.** Re-pausing during termination
would hold the child's write, and therefore its exit, and `exit` would never resolve. Do not "fix"
this by re-applying backpressure — you would trade a memory bound for a hang, which is worse.

The defect is that releasing the bound is unbounded. Retention must be **capped**, and bytes past the
cap **dropped**, without ever re-pausing the reader.

## The repairs

### Q1 — cap the drain

- Cap retained bytes during termination at a stated multiple of `backlog`.
- Past the cap, drop rather than retain. Dropping during a teardown the caller asked for is honest;
  growing without limit is not.
- The consumer must be able to tell truncation happened. Decide how — the package already has a
  `truncated` concept on `RunResult`; rule on whether this surfaces the same way or differently, and
  say why.
- State the cap as a **number** in `guides/process.md` and in the `backlog` TSDoc. A bound a consumer
  cannot read is not a bound.
- A test with `backlog: 1024` against a SIGTERM-trapping flooding child asserts drained bytes stay at
  or below the cap, and that `exit` still resolves. **Both halves** — the second is what proves you
  did not reintroduce the hang the comment warns about.

### Q1b — correct the bound `HANDOFF.md` states

`HANDOFF.md` contract item 3 gives the overshoot bound as "one delivered stream chunk plus one line".
The measurement falsifies that by four orders of magnitude. The audit's reconciler called the written
bound **itself a defect** — the kind of stale claim a later campaign reads as current.

Correct it to what the code will now do. This is the one `HANDOFF.md` edit this unit is authorized to
make, and it is authorized precisely because leaving it would mislead the next reader.

### Q7 — `runSync` timeout leaves descendants running

`RunSyncOptions.timeout` TSDoc and the guide's termination section must state that `runSync` ends the
root alone and name `run` or `Process` as the tree-terminating path. A test asserts a `runSync`
timeout leaves a grandchild live while the same shape under `run` does not.

### Q8 — `input` is documented as NUL-refused and never validated

Rule it either way and implement the ruling: validate `input` on both `ProcessCommand` and
`RunOptions` with a test proving the `invalid` refusal, **or** correct both remarks to say `input` is
stdin payload carrying no NUL restriction, with the parity fence updated. Say which you chose and why.

## Standing conditions

- Unit PC1 lands before you and owns `src/core/errors.ts`, `src/core/validators.ts`,
  `src/core/types.ts`, `src/server/helpers.ts`, and `src/server/Process.ts`. Take its state as given.
- This executor's sandbox denies **nested** child creation with `EPERM`. Q1's proof needs a flooding
  child, and Q7's needs a grandchild — both may be unrunnable here. Record what you could not run,
  name the exact command that settles it, and carry on. **Never substitute a weaker instrument for a
  proof.** The Orchestrator re-runs these on the host.

## Scope

Owned: `src/server/Process.ts`, `src/core/types.ts`, `src/server/helpers.ts`, `guides/process.md`,
`.orkestrel/process/HANDOFF.md` (contract item 3 only), `tests/guides.test.ts`, and the matching files
under `tests/src/`.

Off-limits: `package.json`, the rest of `.orkestrel/`, `tests/policy.test.ts`, `tests/config.test.ts`.

## Execution

Perform this assignment directly. Spawn nothing.

## Acceptance criteria

1. `npm run format:check`, `npm run lint:check`, and `npm run check` each exit 0.
2. The teardown drain is capped, the cap is a number stated in both the guide and the TSDoc, and a
   test asserts drained bytes stay at or below it — proven red-then-green.
3. The same test asserts `exit` still resolves. A cap that hangs the exit is a regression, not a fix.
4. `HANDOFF.md` contract item 3 states the real bound.
5. Q7 and Q8 close as specified, each with a test.
6. No settled `HANDOFF.md` ruling other than item 3's bound is changed.

**`npm run build` and the test projects are observations, not criteria.** Report every command's
**bare** exit code; a pipe masks it.

## Deviation contract

Stop and report if capping the drain cannot preserve `exit` resolution, if a repair needs a file you
do not own, or if Q8's ruling contradicts a settled item. The cap's multiple, how truncation surfaces,
and test naming are yours to decide and carry on from.

## Output

**Per numbered row: what changed and why**, **The cap you chose and why that number**, **How
truncation surfaces to a consumer**, **Files written**, **Red-then-green proofs** with exact commands
and both counts, **Validation** (each gate, bare exit code), **What you could not run and the command
that settles it**, **Deviation**, **Decisions**. No process diary.
