# PC9 — report

Unit: `implementer`, Opus 5. Brief: `pc9-brief.md`. Ten findings from PC-AUDIT3. The unit was told
its own engine wrote PC7 and PC8, and that six of the ten were defects it left.

## The findings

| # | What changed | What proves it |
| - | ------------ | -------------- |
| F1 | `guides/process.md:961` reads "Each name on this surface that reads against a house rule is settled here rather than rediscovered." The count is gone, not corrected to five. | `npm run test:guides` exit 0 |
| F2 | `readiness-grade.md` Q17: `twelve` → `sixteen`, one line. | single-line diff |
| F3 | `pc7-report.md` § Counts re-measured with the instrument named — `git grep -ohE "\b<token>\b" <revision> -- src/ \| wc -l`, `Before` at `b004a67~1`, `After` at `b004a67`. The `run` row's `After` reads `44` and the derivation is named as the defect it was. The prose states the pattern admits neither `runner` nor `runners`. | Every row held: `run` 55→44, `RunResult` 23→0, `createRunError` 6→0, `runSync` 4→0, `buildRunResult` 4→0, `RunSyncOptions`/`RunOptions`/`RunInput` 3→0. `run` reads 44 occurrences on 41 lines at three separate revisions. |
| F4 | Agent noun removed from nine sites. `### Runners` → `### Spawns`; `### Where the two runners differ` → ``### Where `execute` and `executeSync` differ``, anchor moved with it. New Vocabulary row rules the split. | enumeration below; `test:guides` exit 0 |
| F5 | The constants test now parses the guide's Constants table and compares each `Value` cell against the imported constant. | red 1 failed / 85 passed, green 86 passed |
| F6 | The overflow row pins `Object.keys(written).sort()` against the nine documented `ExecuteResult` members; the comment says the failure is a prompt to rule on the guide sentence. | red 1 failed / 85 passed, green 86 passed |
| F7 | `guides/process.md:606-608` replaces the unperformable advice with the re-run technique, and the same test drives it. | red 1 failed / 85 passed, green 86 passed |
| F8 | All five temporal `once` rewritten to `after`. `src/server/helpers.ts:746` now states the rule in the words `src/core/types.ts:188` uses. | enumeration below |
| F9 | `src/core/types.ts:8`: "smallest to largest" → "divided by lifetime", matching the guide's axis. | `npm run check` exit 0 |
| F10 | Every named line rewrapped, plus the lines the unit's own edits lengthened. Nothing else reflowed. | no touched prose line exceeds 100 in the guide or 80 in the README |

## A mechanical constraint the unit discovered

Inside `## Surface`, `@orkestrel/guide`'s `extractSurface` registers any H3 carrying a code span as a
`class` symbol. A heading naming the functions in backticks would have injected three phantom exports
into the parity gate. `### Spawns` carries no code span; the comparison heading sits outside
`## Surface`, so it takes the identifiers directly.

`### Spawns` was chosen because the section's own lead sentence already reads "The one-shot and
fire-and-forget spawns", and `spawn` is the domain word the guide uses throughout. `Executors`
reintroduces the agent noun the ruling removes; `One-shot spawns` excludes `detach`, which the table
lists; `Commands` collides with `### Command helpers`.

## F5's parse, measured before it was written

Seven of the eight Constants cells are backticked literals and compare under one normalization —
strip backticks, digit separators, and quotes, then compare against `String(constant)`. The eighth,
`PROCESS_ERROR_CODES`, is the prose cell "the five codes"; it is named in a `PROSE_CONSTANTS` list
rather than parsed, its codes are already gated by `tables exactly the error codes the tuple
declares`, and an assertion fails if that cell ever becomes a backticked literal, so the exclusion
cannot rot. All eight row names are still asserted against the imported set.

## Red then green

| Finding | Plant | Red | Green |
| ------- | ----- | --- | ----- |
| F5 | `PROCESS_EVIDENCE`'s `Value` cell `2_048` → `4_096`, restored by editing the cell back | 1 failed, 85 passed, exit 1 | 86 passed, exit 0 |
| F6 | `truncatedStdout` added to `ExecuteResult` and `buildExecuteResult`, removed by deleting exactly those two additions | 1 failed, 85 passed, exit 1 | 86 passed, exit 0 |
| F7 | the old "bound the two streams separately by running the command twice" sentence swapped back | 1 failed, 85 passed, exit 1 | 86 passed, exit 0 |

F7's red was taken twice: once before the sentence landed, and once again on the finished tree, so
the reading is against the tree as it ships.

## Vocabulary row

```
| `run` | Kept as the English noun for one invocation — a terminated run, a run that stays pending. It never names a function; `execute` and `executeSync` are named by their identifiers, so the concept carries one term. |
```

## `runner` survivors, each ruled

| Location | Ruling |
| -------- | ------ |
| `tests/src/server/helpers.test.ts:741` | Correct. Names the test process, not the API. |
| `guides/test.md:576`, `:634` | Correct. Vendored mirror of another package's guide; names Vitest. Not owned. |
| `guides/scaffold.md:518`, `:1154`, `:1155` | Correct. Vendored mirror; names Vitest and the conformance runner. Not owned. |

## `once`

All 32 remaining hits are the counting sense, the idiom "at once", the `once` method declaration and
its call sites, or the `once` code token. No temporal use remains.

## Carried to the Orchestrator

`.orkestrel/process/pc8-report.md:29` still quotes the old link text and anchor. That file is a
historical record of what PC8 wrote, so the quotation is correct as history, and it is the last place
in the tree where the word names these two functions.

## Boundaries held

Ten files touched, all owned. Diffstat 182 insertions, 104 deletions. No off-limits file was written.
The ~25 pre-existing 101-102 column lines are untouched, per the brief.
