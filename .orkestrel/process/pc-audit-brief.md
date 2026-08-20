# PC-AUDIT — Falsify the process 0.0.4 campaign

## Role and engine

Two lanes, both Claude Opus 5, each in its own clean context, blind to the other.

- **Subjective lane** (`reviewer`): shape, naming, ergonomics, guide voice, design fit, whether the
  API and its prose are what a consumer should meet.
- **Objective lane** (`reviewer`, holding the objective perspective): correctness, constraints, what
  the code and contracts actually permit.

GPT-5.6 Sol wrote every unit under audit, so Sol cannot audit it. Both lanes run on Opus. Record the
substitution.

## Objective

Return a per-claim verdict on the numbered claims below. A claim is CONFIRMED only with evidence a
reader can re-derive from the supplied diff and the repository. Otherwise it is FAIL, with the
contradiction cited at `file:line`.

## Context

Repository `/workspace/process`, package `@orkestrel/process` 0.0.4, unpublished. The published
release is 0.0.3.

Review evidence, both supplied because your role has no `Bash`:

- `/workspace/process/.orkestrel/process/pc-audit-diff.txt` — the complete campaign diff, `b392629..HEAD`, 4,119 lines across 22 files.
- `/workspace/process/.orkestrel/process/pc-audit-log.txt` — every campaign commit message, 16,610 bytes.

Read the working tree directly for anything the diff does not settle.

Governing files, read before ruling, in this order: `/workspace/process/AGENTS.md`, then the
`/workspace/process/.claude/rules/` files your lane touches — `names.md`, `typescript.md`,
`architecture.md`, `patterns.md`, `tests.md`, `documentation.md`, `writing.md` — then
`/workspace/process/guides/process.md`.

Gate evidence, run by the Orchestrator on the host on 2026-08-20, all exit 0: `format:check`,
`lint:check`, `check`, `build`, `test:distribution --mode release`, `test:config`, `test`. Source
tests report 106 passed and 7 skipped; the 7 are `it.skipIf(process.platform !== 'win32')` cases on a
POSIX host.

## The claims

1. A `ProcessError` crossing a package-copy boundary is recognized by its brand rather than by `instanceof`, and the brand cannot be forged by an ordinary object.
2. `buildSpawn` validates the command before the spawn, and the respawn path re-validates rather than reusing the first validation.
3. Teardown drain is capped, and the bound that previously hid the uncapped case is corrected.
4. A root `timeout` in the termination proof outlives the grandchild's interpreter startup, so the test measures termination rather than Node bootstrap.
5. A NUL byte in an `input` payload reaches the child and returns in `stdout` unaltered.
6. `waitForCondition` in `tests/setup.ts` measures with `performance.now()`, accepts a synchronous or asynchronous condition, and throws inside its budget.
7. The `setup` Vitest project exists because `tests/setup.test.ts` exists, and scaffold derives it rather than the repository declaring it by hand.
8. The seven failures from this package's first POSIX run were six test defects and one contract defect, and no product defect.
9. `quoteArgument('%1')` returns `"%1"`, and `buildSpawn` refuses `%` in an argument to a Windows batch target.
10. `isolated: true` leaves no `PATH` on POSIX, while Windows libuv injects a host environment set regardless.
11. A spawn fault reports the host's negative errno for `run` and `null` for `runSync`.
12. A detached POSIX child survives the supervisor's `SIGKILL` and never receives the terminal's `SIGINT`.
13. The distribution proof compares runtime export sets against compiler-parsed declaration exports and finds core 13/13 and server 33/33.
14. `README.md` states the `moduleResolution` values the package supports, and they are the values the built declarations actually work under.

## The open lens

After ruling on the numbered claims, answer one more question in its own section: **what did this
campaign change that no claim above covers, and is it right?** A defect the claim set does not reach
is the finding worth most here. Number these continuing from 15.

## Unknowns

Whether `guides/process.md` still describes any surface the package no longer has. The campaign
repaired four such statements; it did not survey the whole guide. Report what you find rather than
assuming the survey happened.

## Scope

Read-only. You write no file. Off-limits: every write. Allowed tools: Read, Grep, Glob.

## Execution

Perform this assignment directly. Spawn nothing.

## Output

One section per claim, in number order:

```
### Claim N
Verdict: CONFIRMED | FAIL | UNPROVEN
Evidence: file:line, and what it shows
```

`UNPROVEN` means the supplied evidence cannot settle it; say what would.

Then:

- `## Continuing findings` — the open-lens findings, numbered from 15, each stated as a falsifiable claim with its `file:line`.
- One terminal line, exactly `VERDICT: PASS` or `VERDICT: FAIL`. FAIL if any claim failed or any continuing finding is a defect.

No process diary.

## Deviation contract

A conflict with the objective stops the lane and returns a deviation report. Where a paragraph sits
or which heading a section takes is yours to decide and record.

## Acceptance criteria

1. Every claim 1 through 14 has a verdict and a `file:line`.
2. Every FAIL cites the exact contradicting line.
3. The continuing-findings section is present, even if empty.
4. Exactly one terminal `VERDICT:` line, and it is the last line.
