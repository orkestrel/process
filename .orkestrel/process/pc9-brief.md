# PC9 — close PC-AUDIT3's ten findings

## Role and engine

`implementer`, Opus 5. Six of the ten findings are prose, naming, and vocabulary; two are instrument
repairs; two are corrections to campaign records. The judgment load is subjective, which is this
engine's lane. The auditor of this unit will be GPT-5.6 Sol, which did not write it.

Read this before you start. **Your own engine wrote PC7 and PC8, and six of these ten findings are
defects it left.** Two of them — a stale count beside a table it had just edited, and a rename whose
instrument could not see the word it was renaming — are the kind a writer does not see in its own
work. Treat the surrounding code as suspect rather than as context you already understand.

## Objective

Close findings F1 through F10 from `.orkestrel/process/pc-audit3-reconciliation.md`, so
`@orkestrel/process` carries no open finding from the round that gates its publication.

## What this closes toward

`@orkestrel/process` 0.0.4 is the first layer of a release wave that `@orkestrel/scaffold`,
`@orkestrel/mcp`, and `@orkestrel/probe` re-pin against. Both audit lanes returned FAIL and the
subjective lane said plainly it would not publish this tip. This unit is what changes that answer.

## Context

Read before acting, in this order:

1. `/workspace/process/AGENTS.md`, in particular § Design laws "One concept, one term" and § Writing.
2. `/workspace/process/.claude/rules/writing.md`, `.claude/rules/documentation.md`,
   `.claude/rules/names.md`, `.claude/rules/quality.md`, `.claude/rules/tests.md`.
3. `/workspace/process/.orkestrel/process/pc-audit3-reconciliation.md` — the ten findings and the
   Orchestrator's rulings.
4. `/workspace/process/.orkestrel/process/pc-audit3-opus-verdict.md` and `pc-audit3-sol-verdict.md`
   — the two lanes, verbatim. Read the finding's own evidence before you change the line it names.
5. `/workspace/process/guides/process.md` — the governing guide, which you also edit.

No skill is named for this unit.

The Orchestrator reproduced every finding against this tree before carrying it. You do not need to
re-establish that they are real; you need to close them.

Host: Linux container, bash, network available. `/workspace/process` is a clean checkout at
`1668b62` except for four `.orkestrel/process/` files that are this round's own records — expect
`git status` to show them and do not treat that as damage.

## Unknowns

Two, named so you report on them rather than inventing an answer.

- **F4's replacement heading.** The guide's Surface headings are kind-names — `Factories`,
  `Entities`, `Guards`, `Error factories`, `Command helpers`, `Capture helpers`,
  `Termination helpers`, `Validators`, `Constants`, `Types`, `Server contracts`. `Runners` is that
  family's name for `execute`, `executeSync`, and `detach`. What replaces it is yours. Report the
  choice and why the alternatives lose.
- **F5's parse.** Whether the Constants table's `Value` cell can be compared against the imported
  constant without a second parser depends on how the table formats each value — `5_000` in the
  table against `5000` at runtime, and `PROCESS_ERROR_CODES` as a list. Measure the table first and
  say what you found. Where a value cannot be compared without inventing a parser, assert the ones
  that can and name the ones that cannot, rather than adding a parser this repository does not need.

## Scope

Owned files, the only files you may write:

- `README.md`
- `guides/process.md`
- `src/core/types.ts`
- `src/server/types.ts`, `src/server/Process.ts`, `src/server/helpers.ts`
- `tests/guides.test.ts`
- `tests/src/server/helpers.test.ts`
- `.orkestrel/process/readiness-grade.md`
- `.orkestrel/process/pc7-report.md`

Off-limits, do not write: `src/core/index.ts`, `src/server/index.ts`, `src/core/errors.ts`,
`src/core/constants.ts`, `src/server/ProcessManager.ts`, `src/server/factories.ts`,
`tests/src/core/`, `tests/src/server/Process.test.ts`, `tests/src/server/ProcessManager.test.ts`,
`tests/distribution.test.ts`, `tests/config.test.ts`, `tests/policy.test.ts`, `tests/setup*.ts`,
`vite.config.ts`, `package.json`, and every `.orkestrel/process/pc-audit3-*` file.

Tools: Read, Grep, Glob, Edit, Write, Bash. No commits, no pushes, no dependency installs, no
destructive command. Never run `git checkout`, `git restore`, `git stash`, `git reset`, or
`git clean`.

## Execution

Perform this assignment yourself. Spawn nothing.

## The ten findings

### F1 — a count over the table it introduces

`guides/process.md:960` reads "Three names on this surface read against a house rule, and each is
settled here rather than rediscovered." The table below it has five rows naming eight identifiers.

**Remove the count. Do not correct it to five.** A number introducing a list is a second copy of what
the list already shows, and it drifts the next time a row moves — which is exactly what happened
here, when PC7 added the `execute`/`executeSync` row. Write the sentence so the table is the count.

The same rule is landing in `.claude/rules/writing.md` in the same window. Do not restate it in the
guide.

### F2 — a record that contradicts itself in one sentence

`.orkestrel/process/readiness-grade.md`, the Q17 row, reads "the twelve exports that appear in no
guide fence" and then "All sixteen claims are true today". `tests/guides.test.ts:851` and the
`EXAMPLES` table establish sixteen: fourteen rows plus `retainChunk` and `resolveExecutable`.

Correct twelve to sixteen. Change nothing else in that file.

### F3 — a derived number presented as a measurement

`.orkestrel/process/pc7-report.md:9` reports `run` at 55 before and 44 after, measured across `src/`.
The measured population is 45 occurrences on 41 lines, and 44 is 55 − 11, which is arithmetic on the
two cells beside it rather than a reading of the tree.

Re-measure and state the instrument beside the number, or delete the derived cell. Report which you
chose. A count that is arithmetic on two other cells is not evidence about the tree.

### F4 — the rename missed the noun

PC7 renamed `run` to `execute` and `runSync` to `executeSync`. Its instrument was a `\brun\b`
pattern, so `runner` and `runners` were outside what the pattern admits and were never ruled on. The
word still names those two functions in ten places, two of which ship: `README.md:8` is the first
sentence npm renders, and `src/core/types.ts:14` and `:308` reach `dist/src/core/index.d.ts`.

The full list is in the subjective lane's verdict, claim 4. Take it as a starting point and
enumerate the tree yourself with a case-insensitive pattern, because the list was produced by one
lane's search and this finding exists because a search's membership rule was trusted.

**The Orchestrator's ruling, which you implement rather than re-decide:**

- The agent noun goes. `runner` and `runners`, naming the functions, are a second term for a concept
  the guide's own Vocabulary table already rules on at `guides/process.md:965`. A guide that rules
  "use the fixed lifecycle verb" and then heads a section `### Runners` gives a reader two answers,
  and `AGENTS.md` § Design laws fixes one concept to one term.
- The English noun stays. "a run", "the run stays pending", "a terminated run", `## One-shot runs`
  — these name the invocation that happened, not the function that did it. The objective lane
  confirmed every one of those survivors is correct. Do not touch them.
- `tests/src/server/helpers.test.ts:741` — "the runner's own process group" — names the test
  process. It stays.
- Add one Vocabulary table row ruling that split, so the next round does not reopen it.

One mechanical consequence to carry with the rename: the heading `### Where the two runners differ`
has an inbound anchor link at `guides/process.md:551`, which moves with it.

The Orchestrator measured that no test file references either heading by text —
`grep -rn "Runners" tests/` is empty — so the rename breaks no locator. Re-check that yourself before
you rely on it; the measurement is one command and this finding exists because a search's membership
rule was trusted.

### F5 — a test named for a guard it does not perform

`tests/guides.test.ts:509-518`, `documents the constant values its Surface table prints`, never reads
`files['guides/process.md']`. It compares eight imported constants against eight literals written in
the test. Editing the guide's `Value` column changes nothing it evaluates, and no other assertion in
the file reads that column.

Make the test do what its name says: parse the `Value` cell out of the guide's Constants table and
compare it against the imported constant. `tests/guides.test.ts:522-533` already does this correctly
for the error-code table — follow its shape rather than inventing a second one.

`.claude/rules/quality.md` calls an instrument certified only from the inside a defect in the
instrument. This is that.

### F6 — a comment claiming a binding its test does not have

`tests/guides.test.ts:467-468` claims "a later per-stream field breaks this test rather than leaving
the sentence stale". The test asserts `truncated` and two byte lengths. Adding `truncatedStdout` and
`truncatedStderr` to `ExecuteResult` changes none of them, so the test would pass while the guide
sentence it guards went stale.

Make the claim true rather than deleting it. The guide sentence is a real claim about the published
surface and deserves a gate: pin the result's exact member set, so any new `ExecuteResult` member
fails this test and forces a ruling on the sentence.

Bound the fix. Pinning the member set is a tripwire on the whole result shape, which is what makes it
work; say so in the comment, so a later reader knows the failure is a prompt to rule rather than a
number to update.

### F7 — advice the API cannot perform

`guides/process.md:605-606` tells a consumer to "bound the two streams separately by running the
command twice". `limit` is one number applied to both streams, so no number of runs bounds them
separately.

The technique that works is a re-run at a `limit` high enough that `truncated` is `false`, after
which each captured length can be compared against the original bound. The second clause — supervise
the child with `Process`, which bounds `lines` and `evidence` separately — is already sound.

This sentence is PC-AUDIT2's repair for its own finding 18: false advice was replaced by
unperformable advice in the same paragraph. Do not replace it with a third sentence nobody can check.
Add the executed assertion that would break if the new advice went false, in the same test that
already drives the overflow case.

### F8 — five temporal `once` occurrences, and the sweep that missed them

`.claude/rules/writing.md` § Substitutions maps temporal `once` to `after`. Five remain:

- `guides/process.md:279` — "Once an iterator has been requested…"
- `src/core/types.ts:146` — the same sentence, shipping in `dist/src/core/index.d.ts`
- `src/server/Process.ts:31` — the same sentence, third copy
- `src/server/types.ts:43` — "The listener invoked once the process exits", shipping in the `.d.ts`
- `src/server/helpers.ts:746` — "No signal is initiated once the native exit is observed", which is
  the same rule `src/core/types.ts:188` states with "after"

They survived because every sweep for them was case-sensitive and every occurrence is
sentence-initial. Run your own sweep case-insensitively across `guides/` and `src/`, and rule on
every hit. The counting sense — "read once", "iterate once", "at once" — stays, as does the `once`
method name and code token.

The last of the five is the sharper half of a second defect: one rule stated in two vocabularies
across two shipped files. State it once, the same way, in both.

### F9 — an ordering claim the list refutes

`src/core/types.ts:8` introduces the tiers as "Three tiers, smallest to largest" and then lists the
eight-member `ProcessInterface` first and a single function second. `guides/process.md:38` uses the
accurate axis: the tiers divide by lifetime.

Drop the false ordering. Use the guide's axis so the two say one thing.

### F10 — the rename lengthened lines nobody rewrapped

`guides/process.md` and `README.md` carry a hand-wrap convention that no gate reads, because `oxfmt`
does not format Markdown.

**Rewrap only the lines the rename lengthened**, which the subjective lane's verdict names:
`guides/process.md:5`, `:39`, `:357`, `:358`, `:406`, `:531`, `:608`, `:609`, `:635`, `:650`, `:772`,
`:790`, `:1004`, and `README.md:8`, `:59`, `:68`. Plus any line your own edits lengthen.

Do not reflow the guide. Roughly thirty other lines sit one or two columns over a convention that
predates this round, and a guide-wide reflow produces a diff that hides every other change in this
unit. The missing gate is a successor decision the Orchestrator holds.

## Not yours

- **The Windows residue.** `guides/process.md:978-981` records that current `killTree` through
  `taskkill.exe` and grandchild termination are proven on no host, and names the exact command that
  settles them. That is the honest disposition and it stands. Do not weaken it, do not strengthen it,
  and do not claim a proof this container cannot produce.
- **A Markdown line-length gate.** Out of scope, per F10.
- **The distribution project running outside `npm test`.** Recorded as a bounded narrowing, not a
  defect. Do not move it.
- **The parity gate parsing text rather than loading a barrel.** The subjective lane declined to
  raise it. Do not add module resolution to that gate.
- **Any count-in-prose the lanes confirmed correct.** Nineteen were enumerated and found true. Leave
  them. F1 is about a count that duplicates an adjacent enumeration, not about counts.

## Naming

Name every test for the behaviour it proves, never for this brief's finding label. `F4` and the rest
are this brief's control identifiers so its tables can be read; they are not vocabulary this package
has.

## Deviation contract

Stop and report — expected, found, exact evidence, done or not done, at most one hypothesis — when:

- a quoted line is not where this brief says it is, or does not read as quoted;
- a finding cannot close without writing an off-limits file;
- closing F4 would change a published identifier rather than prose. It must not: `execute`,
  `executeSync`, and `detach` keep their names, and no export moves.

Decide and carry on, recording the choice in your report: the replacement heading, the Vocabulary
row's wording, every rewritten sentence, the shape of the two test repairs, and how far each rewrap
reflows its paragraph.

## Acceptance criteria

Run these in order and report each bare exit code. The order is deliberate.

1. `grep -rniE "\brunners?\b" README.md guides/ src/ tests/` reports only occurrences you ruled
   correct, and your report lists each with its ruling.
2. `grep -rniE "\bonce\b" guides/process.md src/` reports only the counting sense, the `once` method
   name, the `once` code token, and the idiom "at once". Report every hit with its ruling.
3. `guides/process.md` contains no sentence stating a count of the rows of a list or table it
   introduces.
4. `npm run format` then `npm run format:check` exits 0.
5. `npm run lint:check` exits 0.
6. `npm run check` exits 0.
7. `npm run test:guides` exits 0.
8. F5's repaired test fails against a planted guide edit. Change one `Value` cell in the guide's
   Constants table, run `npm run test:guides`, record the failing count, restore exactly that cell by
   editing it back — never by reverting the file — and record the passing count.
9. F6's repaired test fails against a planted member. Add one member to the documented
   `ExecuteResult` field set the test pins, run `npm run test:guides`, record the failing count,
   remove exactly that member, and record the passing count.
10. F7's new assertion fails against the old advice. Record the command and both counts.
11. `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:server` exits 0.
    This project spawns real child processes and is timing-sensitive under load. Where it fails on a
    deadline rather than an assertion, re-run that one file alone once, report both readings
    labelled, and treat it as an observation rather than a stop — the Orchestrator takes the deciding
    reading after you exit. Where it fails on an assertion, stop and report.
12. `npm run test:policy` exits 0.

Do not run `npm test`, `npm run build`, or `npm run test:distribution`. An independent verifier takes
those readings.

## Output

A report with:

- one row per finding, F1 through F10, stating what changed and what proves it;
- the red-then-green command and counts for criteria 8, 9, and 10;
- one row per acceptance criterion with its bare exit code;
- the full `runner`/`runners` enumeration with your ruling on each survivor;
- the two **Unknowns** answered;
- the decisions you made under the deviation contract's second list;
- anything you could not close, named.

No process diary.
