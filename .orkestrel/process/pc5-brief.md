# PC5 — close the five internal-quality rows, and dissolve the handoff

## Role and engine

`sol` (GPT-5.6 Sol), through `codex exec`. Perform the assignment directly and spawn nothing.

Nothing in this unit lives in a child process's stdio, so the bench limit recorded in
`.agents/orchestration.md` **Bench laws** rule 4 does not reach it. One row does need a real child;
its standing condition is below.

## Objective

Close rows Q15, Q16, Q17, Q19, and Q20 of `.orkestrel/process/readiness-grade.md`, and dissolve
`.orkestrel/process/HANDOFF.md` into the artifacts that own its parts.

## Context

Repository `/workspace/process`, package `@orkestrel/process` 0.0.4, unpublished; 0.0.3 is on the
registry. The tree is clean at `4b01d30`.

Read before editing: `AGENTS.md`; `.claude/rules/tests.md`, `.claude/rules/documentation.md`,
`.claude/rules/writing.md`, `.claude/rules/typescript.md`; `guides/process.md`; and
`.orkestrel/process/readiness-grade.md` rows Q15, Q16, Q17, Q19, Q20, whose `close condition` column
states each row's exact requirement. That column is the specification; this brief does not restate it.

Verified state, each measured in this checkout on 2026-08-20:

- **Q15 is open.** `tests/src/server/helpers.test.ts:659-671` has a `killProcess` describe block, but both cases drive a synthetic `kill` — one with `pid: undefined`, one with the unreachable pid `4194303`. Neither spawns a real non-detached child, which is what the row's close condition requires.
- **Q16 is open.** `guides/process.md:357` reads `SIGTERM to the process group, wait grace, then SIGKILL to the group.` The direct-child ESRCH fallback appears nowhere in that table.
- **Q19 is half open.** `tests/guides.test.ts:71` already lists `README.md` in `ROOT_FILES`, and `:471` asserts one sentence in it. The two parity assertions the row names do not reach it: `resolves every relative link` at `:326` runs per guide entry over `entry.spec`, and no test resolves `README.md`'s backticked APIs.
- **Q20 is open.** `tests/src/server/helpers.test.ts:724` and `:736` each arm one mechanism. No case arms a timeout and an abort together.
- **Q18 is closed already.** `guides/process.md:921-926` states which rows execute on every host and which execute on Windows only. Do not reopen it.

Measure Q17 yourself as your first step: count the value-bearing `@example` blocks among the package's
exports that appear in no guide fence, and state the number before you transcribe them. The grade says
twelve; confirm it rather than assuming it.

## What `HANDOFF.md` becomes

`.agents/orchestration.md` § Before you prune, check 4, rules that a cross-session orientation document
is not a category of its own. Dissolve this one and delete it. Its sections route as follows.

| Section | Disposition |
| ------- | ----------- |
| What 0.0.3 is; the 0.0.2 → 0.0.3 delta | Narrative and release history. The git log holds both. Drop. |
| The behavioral contract 0.0.3 established | Product truth. Each item already has a pinning test. Any statement `guides/process.md` does not already make, add. |
| Rulings a future audit must not re-litigate | Product truth where it states a boundary the consumer meets; the guide already carries the `%` refusal, Job Objects, `truncated` covering both streams, and `lines` single-consumer. Add only what is missing. The rationale stays in the commit that made each decision. |
| Look out for, items 1-9 and 11 | Rule on each: already in the guide, newly added to the guide, or dropped with the reason stated in your report. |
| Look out for, item 10 — adopter republish states | Live state. `.agents/orchestration.md` § Before you prune: a section recording live state prunes with no promotion. Drop it. |
| Verification map | Derivable from `package.json` scripts and the test tree. Drop. |
| Upstream adopters; post-republish recipe | Live state and a procedure that belongs to the publishing contract. Drop. |

Item 1 of "Look out for" is the Windows residue. It cannot close on this host. State it in your report
as an explicit drop with its exact settling command, so the Orchestrator can carry it into the release
record. Do not put a verification-host history into the guide; a consumer reads the guide for
behaviour.

## Standing conditions

- This host permits nested child creation. Q15 needs a real child; spawn one.
- `npm test` runs `src`, `policy`, `config`, `guides`, and `setup` projects. Run the narrowest project while iterating.
- `tests/setup.ts` exports `waitForCondition`. Use it rather than a fixed delay when waiting on another process, per `.claude/rules/tests.md`.
- Do not edit any file under `.agents/`, `.claude/`, or `configs/`. Those are vendored by `@orkestrel/scaffold` and `repair` reverts an edit there.

## Scope

**Owned:** `guides/process.md`, `README.md`, `tests/guides.test.ts`,
`tests/src/server/helpers.test.ts`, `src/server/types.ts`, `src/core/types.ts`,
`.orkestrel/process/HANDOFF.md` (deletion only).

**Off-limits:** everything else, including `package.json`, `vite.config.ts`, every vendored path, and
every other file in `.orkestrel/`.

**Tools:** read, write, and run commands inside `/workspace/process`. Do not commit, push, install a
dependency, or run a destructive command.

## Execution

Perform this assignment directly. Spawn nothing.

Insert a failing proof before each repair: record the exact command and its failing count, implement,
then record the same command green. A test that never ran red does not bind to the row it claims.

## Acceptance criteria

Ordered so an unreachable one cannot hide the gates behind it.

1. Q15: a POSIX-gated test spawns a real non-detached child, calls `killProcess`, and asserts the observed exit, with the pre-repair swallow recorded as its control.
2. Q16: the POSIX row of the termination table names both routes — the process group, and the child directly when no group owns its pid.
3. Q17: `tests/guides.test.ts` transcribes the value-bearing `@example` blocks you counted, so a changed return value fails the gate.
4. Q19: `README.md` gets the two assertions `guides/process.md` gets — resolvable backticked APIs, and existing relative links.
5. Q20: three cases with a timeout and an abort both armed — timeout first, abort first, same tick — each asserting exactly one of `expired` and `aborted`.
6. `HANDOFF.md` is deleted, and every statement worth keeping is in `guides/process.md`.
7. `npm run format:check` exits 0.
8. `npm run lint:check` exits 0.
9. `npm run check` exits 0.
10. `npm run build` exits 0.
11. `npm test` exits 0.

## Deviation contract

A conflict with the objective stops the unit: report expected, found, exact evidence, done or not
done, and at most one short hypothesis. Where a paragraph sits in the guide and which heading a
section takes are yours to decide and record.

## Output

- The repairs, one line each, with the `file:line` that carries each.
- The red-then-green command and both counts, per row.
- Your Q17 count, and how you took it.
- Your ruling on each "Look out for" item: in the guide already, added, or dropped with the reason.
- The gate table: command, bare exit code.
- Files changed.

No process diary.
