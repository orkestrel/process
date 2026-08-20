# PC8 — close the four conformance rows the process package still carries

## Role and engine

`implementer`, Opus 5. The unit turns on test-shape judgment, comment voice, and guide prose, which
is the subjective lane's work.

## Objective

Close conformance-audit rows 6, 8, 9, and row 4's process half in `/workspace/process`, so no row
the audit raised against this package remains open.

## Context

The audit is `/workspace/probe/.orkestrel/probe/canon-audit.md`; you do not need to read it, because
every row it raised against this package is restated in full here. Row 1 (`run` renamed to
`execute`) already landed as commit `b004a67`. Rows 6, 8, 9, and 4 are what remain.

Read before acting, in this order:

1. `/workspace/process/AGENTS.md`
2. `/workspace/process/.claude/rules/tests.md`, `.claude/rules/writing.md`,
   `.claude/rules/documentation.md`, `.claude/rules/typescript.md` — this package vendors all
   twelve rule files, so read the copies in its own tree
3. `/workspace/process/guides/process.md` — the governing guide, which you also edit

No skill applies to this unit.

Two facts the Orchestrator measured, so you do not have to:

- The parity gate `tests/guides.test.ts` detects an undocumented export, including a type-only one.
  Planting `export type PlantedGate = string` at the end of `src/server/helpers.ts` and running
  `npm run test:guides` gave exit 1 with `Process > documents every barrel export` failing,
  `Tests 1 failed | 85 passed | 1 skipped (87)`. Removing the plant gave exit 0,
  `Tests 86 passed | 1 skipped (87)`. The barrel-membership assertions this unit deletes are
  therefore already covered, against the guide, by a gate proven able to fail.
- `vite.config.ts` derives no project from a test file's presence. `src:core` and `src:server` are
  directory globs (`vite.config.ts:44`, `:93`). Deleting one file inside either directory changes
  no project, and both directories keep at least one test file after this unit. `vite.config.ts`
  therefore needs no edit and is off-limits.

Host: Linux container, bash, network available. `/workspace/process` is a clean git checkout at
`b004a67`. `node_modules` is installed.

## Unknowns

None material. Where the guide's Tests section wording for a renamed file needs a phrase this brief
does not dictate, write it in the guide's voice and record the choice in your report.

## Scope

Owned files, the only files you may write:

- `tests/src/core/index.test.ts` (delete, after moving its content)
- `tests/src/core/errors.test.ts` (create)
- `tests/src/server/index.test.ts` (delete)
- `guides/process.md`
- `src/server/ProcessManager.ts`
- `src/server/Process.ts`

Off-limits, do not write: every other file, and in particular `vite.config.ts`,
`tests/guides.test.ts`, `src/core/errors.ts`, and `src/core/types.ts`.

Tools: Read, Edit, Write, Grep, Glob, Bash. No commits, no pushes, no dependency installs, no
destructive command. Never run `git checkout`, `git restore`, `git stash`, or `git reset`.

## Execution

Perform this assignment yourself. Spawn nothing.

## Row 6 — two test files whose only subject is a barrel

`.claude/rules/tests.md:43`: "Do not create test files solely for `constants.ts`, barrels, error
definitions, or `types.ts`." `.claude/rules/tests.md:11` fixes the mirrored path
`tests/{src,app}/[environment]/[domain]/[module].test.ts`, so a test file's name states which module
it proves.

**`tests/src/server/index.test.ts`** — both `it` blocks assert only `@src/server` barrel membership
and `typeof` on the exported symbols, with no call into any of them. Delete the file.

**`tests/src/core/index.test.ts`** — its first `it`, `'exposes the process contract surface'`,
asserts the sorted key list of `@src/core` and is the same barrel-membership assertion. Its other
three `it` blocks prove real behaviour of `src/core/errors.ts`: the guard narrowing its own error and
refusing a plain `Error`, the guard's admitted set compared against the declared
`PROCESS_ERROR_CODES` tuple with a refusal control drawn from outside it, and recognition of an error
constructed by a second source copy of the module.

Move those three into a new `tests/src/core/errors.test.ts`, whose name states the module they
prove, and drop the barrel-membership `it` with the file. Rename the `describe` label from
`'src core entry'` to one naming the error surface. Keep the two explanatory comments that sit above
the third and fourth `it` blocks; they state why each assertion is not re-derived from its own
source. Where an import becomes unused after the move, drop it.

The sibling package made the same change, and its result is `/workspace/probe/tests/src/core/errors.test.ts`.
Read it for the shape only. Do not copy probe's assertions: this package's error surface is its own,
and it already has the three tests it needs.

## Row 8 — a cross-reference written as `below`

`.claude/rules/writing.md` § Code tokens, references, and links: "Point to other material with
`preceding`, `following`, `earlier`, or `later`, never with `above` or `below`."

`guides/process.md:550-551` reads "the bound below applies to a terminated run and cannot rescue one
that was never bounded." The bound it points at is the final paragraph of the later
`### Where the two runners differ` section, at `guides/process.md:649-653`, which states that after a
timeout or an abort `stopChild` runs and the outcome is awaited for one further
`PROCESS_CONFIRMATION`. Rewrite the clause to point at that section by name using a permitted word.

Leave `below` at `guides/process.md:144` and `:262` alone. Both are numeric comparisons — "below its
minimum", "a `backlog` below `1`" — and the rule governs pointing at material, not comparing values.

## Row 9 — a banned word

`.claude/rules/writing.md` § Substitutions: "`simply`, `easy`, `just` → Delete."

`guides/process.md:724` reads "the child it just spawned is destroyed". Recast to keep the temporal
fact without the banned word.

## Row 4 — a boolean beside the barrier it could be derived from

AGENTS.md § Design laws: "Derive state. Compute facts from existing fields. Do not store a second
flag or label that can drift."

Two class pairs in this package look like duplicated state and are not:

- `ProcessManager.ts:47-48` declares `#destroying` beside `#ending`, and `destroy()` at `:164-168`
  assigns `#destroying = true` on the line before `#ending = this.#teardown()`.
- `Process.ts:76,79` declares `#terminating` beside `#stopping`, and `#kill()` at `:342` assigns
  `#terminating = true` in its synchronous prefix, which runs while `stop()` at `:203-207` is still
  evaluating `this.#stopping = this.#kill()` and has not yet assigned `#stopping`.

The audit ruled: retain both flags and record the ordering reason once at each pair. Deriving the
boolean as `promise !== undefined` narrows every guard's coverage past a re-entrant window that
`ProcessManager.ts:114-121` documents as reachable, because the synchronous prefix of the teardown
runs before the barrier field is assigned.

Add one comment at each pair — at the field declarations, not at the assignment — stating that the
boolean is assigned before the barrier exists and that a guard reading it therefore covers the
synchronous prefix that `promise !== undefined` would miss. Two comments total. Change no behaviour,
no field, and no signature.

Write each comment as `.claude/rules/typescript.md` and `AGENTS.md` § Writing require: state the
rule, name the trigger, no history, no persuasion.

## Deviation contract

Stop and report — expected, found, exact evidence, done or not done, at most one hypothesis — when:

- a quoted line is not where this brief says it is, or does not read as quoted;
- deleting either test file reddens a gate, which would mean the assertion was not covered after all;
- closing a row needs a file this brief marks off-limits.

Decide and carry on, recording the choice in your report, on: the exact wording of the guide
sentences, the `describe` label, the guide's Tests-section bullet phrasing, and where each of the two
comments sits within its field block. Those are yours.

## Acceptance criteria

Run these in order, and report each bare exit code. The cheap gates come first deliberately; do not
reorder them.

1. `tests/src/server/index.test.ts` and `tests/src/core/index.test.ts` do not exist, and
   `tests/src/core/errors.test.ts` does, carrying exactly three `it` blocks.
2. `grep -n "just" guides/process.md` reports no line using it as the banned word, and
   `grep -n "below" guides/process.md` reports only the two numeric comparisons at the lines this
   brief names.
3. `guides/process.md`'s Tests section lists every `.test.ts` file this package has and no file it
   does not have. The parity gate proves this; criterion 7 is where it lands.
4. `npm run format` then `npm run format:check` exits 0.
5. `npm run lint:check` exits 0.
6. `npm run check` exits 0.
7. `npm run test:guides` exits 0.
8. `npm run test:src:core` exits 0.
9. `npm run test:src:server` exits 0. This project spawns real child processes and is
   timing-sensitive under load. Where it fails on a deadline rather than an assertion, re-run that
   one file alone once, report both readings labelled, and treat it as an observation rather than a
   stop — the Orchestrator takes the deciding reading after you exit. Where it fails on an
   assertion, stop and report.
10. `npm run test:policy` exits 0.

Do not run the whole suite, the distribution project, or `npm run build`. The Orchestrator takes
those readings from an independent verifier.

## Review evidence to return

Your report is an auditor's subject, so it states what you measured and what you could not close.

## Output

A report with:

- one row per acceptance criterion: the bare exit code and the evidence line;
- the test counts criteria 7 through 10 printed, as the runner printed them;
- the two comments you wrote, verbatim;
- the guide sentences you rewrote, before and after;
- the decisions you made under the deviation contract's second list;
- anything you could not close, named.

No process diary.
