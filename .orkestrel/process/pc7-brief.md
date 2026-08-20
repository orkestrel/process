# PC7 — rename the execution primitive to the verb the canon reserves

## Role and engine

`sol` (GPT-5.6 Sol), through `codex exec`. Perform the assignment directly and spawn nothing.

The naming decision is made and is not yours to revisit. This unit is the mechanical, wide-reach,
zero-taste execution of it, which is Sol's work.

## The ruling

`.claude/rules/names.md` § Fixed lifecycle vocabulary reserves `execute` for "Run primary work to
completion" and closes with: *Never introduce synonyms such as `cancel`, `reset`, or `run` for these
meanings.* The section carries no scope qualifier.

This package's one-shot execution primitive is named `run`. A conformance audit raised it; the owner
ruled **strict conformance**. Rename it.

An earlier campaign ruled the opposite on a scope reading — that the table governs entity members and
these are standalone functions. That ruling lived only in a handoff file that this campaign deleted,
which is how it came to be re-litigated. It is now overruled on the record.

## What to rename

Enumerate before you edit and state the counts. Measured on 2026-08-20 across `src/`: `run` 55,
`RunResult` 23, `createRunError` 6, `runSync` 4, `buildRunResult` 4, `RunSyncOptions` 3, `RunOptions`
3, `RunInput` 3.

| From | To |
| ---- | -- |
| `run` | `execute` |
| `runSync` | `executeSync` |
| `RunResult` | `ExecuteResult` |
| `RunOptions` | `ExecuteOptions` |
| `RunSyncOptions` | `ExecuteSyncOptions` |
| `RunInput` | `ExecuteInput` |
| `createRunError` | `createExecuteError` |
| `buildRunResult` | `buildExecuteResult` |

Rename the concept, not the English. A sentence that says a command runs still says it runs; a
sentence naming the `run` function names `execute` now. `.claude/rules/writing.md` § Code tokens:
never inflate a code token into an English verb, so read each prose hit and decide which it is.

**`AGENTS.md`: no compatibility shims.** Do not leave an alias, a deprecated re-export, or a
transitional type. Update every consumer in the same change.

Watch for the `Runs` occurrences: check whether each is this concept or an unrelated English word
before touching it.

## Scope of the cascade, measured

`@orkestrel/mcp` declares `@orkestrel/process ^0.0.3` and uses **none** of the renamed surface — zero
hits across its `src/`. `@orkestrel/scaffold` uses `runSync` in one file, `src/bin/CLI.ts`, at the
import on line 36 and one call at line 943. Neither is yours: both live outside this repository and
the Orchestrator updates scaffold.

This package is at 0.0.4 and unpublished, and a caret pins one exact release in `0.0.x`, so nothing
on the registry receives this until it re-pins deliberately.

## Standing conditions

- The tree is clean at the commit the dispatch names, except `tmp/`, which is gitignored and expected dirty.
- Do not edit `.agents/`, `.claude/`, `configs/`, `vite.config.ts`, `tests/setupPolicy.ts`, `tests/policy.test.ts`, or `tests/config.test.ts`. Those are vendored and `repair` reverts an edit there.
- `.orkestrel/` is off-limits.
- A bench sandbox denies grandchild processes and nested installs, and this package's suite needs both. Run the gates, record the bare exit code, and treat `build`, `test`, and `test:distribution` as **observations**. The Orchestrator takes the authoritative run on the host.
- `tests/distribution.test.ts` asserts export counts against the compiler-parsed declarations. A rename does not change the count, but read it and confirm rather than assuming.

## Scope

**Owned:** everything under `src/`, `tests/`, `guides/process.md`, and `README.md`, except the vendored
paths named above.

**Off-limits:** everything else, including `package.json`.

## Execution

Perform this assignment directly. Spawn nothing.

A rename needs no red proof and you say so. What does need proof is that nothing was missed: after the
rename, `grep -rn "\brun\b\|\brunSync\b\|Run[A-Z]" src/ tests/ guides/ README.md` returns only genuine
English uses, and you paste that output.

## Acceptance criteria

Ordered so an unreachable criterion cannot hide the gates.

1. Every identifier in the table is renamed, with no alias, re-export, or transitional type left behind.
2. The grep above returns only genuine English uses, pasted in your report.
3. `guides/process.md` and `README.md` name `execute` wherever they name the function, and still read as English wherever they describe running.
4. `npm run format:check` exits 0.
5. `npm run lint:check` exits 0.
6. `npm run check` exits 0.
7. `npm run build`, `npm test`, and `npm run test:distribution`: run them, record the bare exit code, observation.

## Deviation contract

A conflict with the objective stops the unit: expected, found, exact evidence, done or not done, one
short hypothesis. A gate failing on `EPERM` or a denied nested operation is not a deviation.

## Output

- The counts you measured before editing, and after.
- The grep output proving nothing was missed.
- Which `Runs` occurrences you judged unrelated English, and why.
- The gate table: command, bare exit code, criterion or observation.
- Files changed.

No process diary.
