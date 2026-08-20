# PC-AUDIT3 — the successor round, before process 0.0.4 is published

## What this round decides

Whether `@orkestrel/process` is bumped to 0.0.4 and published as the first layer of a release wave
that `@orkestrel/mcp`, `@orkestrel/probe`, and `@orkestrel/scaffold` re-pin against. A defect that
survives this round reaches four packages and is spent along with the version number.

A finding is worth more than a clean pass. The alternative to finding it here is a consumer finding
it after publication.

## The chain

Each round with one line on what it claimed to close.

| Round | Tip | Claimed |
| ----- | --- | ------- |
| PC1 | `a71089a` | Cross-copy error identity, and validate-then-respawn |
| PC4 | `4b01d30` | A gate over the published artifact, and the prose that ships with it |
| PC5 | `e9d9cfc` | Executed proofs for four behaviours the guide only asserted |
| PC6 | `a13e4e9` | One shape per concept, and `HANDOFF.md` dissolved into the guide |
| PC-AUDIT2 | `254fa8b` / `e79ae0d` | 17 claims audited on Sol: 14 confirmed, findings 18, 19, 20 FAIL, all three closed |
| PC7 | `b004a67` | `run`/`runSync`/`Run*` renamed to `execute`/`executeSync`/`Execute*` |
| PC8 | `1668b62` | Two barrel-only test files deleted, two writing breaches, two derived-state comments |

Assume this chain has one more. Two of the seven rounds were provoked by a defect the previous round
believed closed.

## The subject

`/workspace/process` at `1668b62` on branch `main`. Not the last commit alone: PC7 and PC8 are the
newest surface, and PC-AUDIT2's own three closures are the least-examined. The whole working tree is
yours to read; the diff below is the new surface since PC-AUDIT2's subject.

## Already established — do not re-run

The orchestrator verified each of these directly against this tree, not from a writer's report.

- The parity gate detects an undocumented export, including a type-only one. Planting
  `export type PlantedGate = string` at the end of `src/server/helpers.ts` gave exit 1 with
  `Process > documents every barrel export` failing, `Tests 1 failed | 85 passed | 1 skipped (87)`.
  Removing it gave exit 0, `86 passed | 1 skipped (87)`.
- `vite.config.ts` derives no Vitest project from a test file's presence. `src:core` and `src:server`
  are directory globs at `vite.config.ts:44` and `:93`.
- `guides/process.md:723` used `once` in the temporal sense and now reads `after`. Every other
  `once` in the guide is the counting sense.
- The independent verifier's gate readings for the tip are in `.orkestrel/process/pc8-verification.md`.
  Do not re-run the gate suite to establish that it is green; attack what green does not prove.

PC-AUDIT2's 14 confirmed claims are established. Do not re-report them. Two of their evidence
pointers moved: claims 8 and 15 cited `tests/src/core/index.test.ts`, and those assertions now live
in `tests/src/core/errors.test.ts`. Verifying that the move preserved them is claim 6 below, not a
re-run.

## What changed in this brief

New claims 1 through 3 attack PC-AUDIT2's own three closures. New claims 4 and 5 attack PC7's
rename. Claims 6 and 7 attack PC8's deletions. Claims 8 through 11 attack the package as the thing
about to be published.

## Numbered claims

Attack each. `CONFIRMED` requires naming the attack you tried that failed. A claim you cannot decide
is `UNRESOLVED`, not `CONFIRMED` — say what would settle it. Do not hedge toward an imagined
consensus.

**1.** PC-AUDIT2 finding 18 is closed. The guide told a consumer to compare each captured string's
byte length with `limit` to tell which stream overflowed, and the shipped helper cannot support that:
a probe delivering 16 stdout bytes and 17 stderr bytes at limit 16 returned two 16-byte strings.
Claim: the guide now states the real limit, and no sentence anywhere in it still implies a consumer
can identify the overflowing stream from the result.

**2.** PC-AUDIT2 finding 19 is closed. `src/server/types.ts` said `ProcessChild` carries "the same
five members" and enumerated six. Claim: the count is now correct, and no other count-bearing
sentence in `src/` or `guides/` disagrees with what it counts. Enumerate the count-bearing sentences
yourself rather than trusting that this one was the only one.

**3.** PC-AUDIT2 finding 20 is closed. An audit record claimed eleven renamed tests where the diff
contained ten. Claim: no count in any retained `.orkestrel/process/` record still disagrees with the
artifact it describes.

**4.** PC7's rename is complete in the direction that matters. Claim: no identifier, string, comment,
guide sentence, or test name still says `run` where it means the one-shot execution primitive.
Enumerate the surface yourself — grep the whole tree for the word rather than trusting the unit's
list — and rule on every survivor as either correct or missed.

**5.** PC7's rename did not over-reach. Claim: no occurrence of `run` that means something else was
renamed. `.claude/rules/names.md` § Fixed lifecycle vocabulary reserves `execute` for "run primary
work to completion"; ordinary English uses of `run` — "a run", "the run stays pending", "run the
gates" — are not that meaning and must survive. Name any that did not.

**6.** PC8's deletion of `tests/src/core/index.test.ts` lost no coverage. Claim: every assertion the
deleted barrel-membership `it` made is made by something that still runs. Check the three moved
behavioural tests preserved their controls, especially the refusal control drawn from outside the
declared tuple.

**7.** PC8's deletion of `tests/src/server/index.test.ts` lost no coverage. Claim: the parity gate
asserts everything that file asserted about `@src/server`, and it asserts it against the guide rather
than against a duplicated literal. The plant evidence in **Already established** proves the gate
fails on an undocumented export; it does not prove the gate fails on a **missing** one. Attack that
second direction and rule on it.

**8.** No instrument in this package is vacuous. Claim: for every gate and every parity assertion
this package owns, a control exists that makes it fail. Pick the three you consider most likely to
be tautological — a test that re-derives its answer the way the source derives it, or asserts a
substring rather than a behaviour — and actually attack them. Say how many you attacked.

**9.** The guide is true, not merely plausible. Claim: every behavioural sentence in
`guides/process.md` that is not under an executed fence describes what the code does. Ask
specifically whether a false universal has been replaced by an **unfalsifiable** one, which is worse,
because it reads as rigour. Name the sentences you checked and the ones you could not.

**10.** The published surface is what the guide says it is. Claim: the barrel's real exports, the
guide's Surface and Methods tables, and `package.json`'s `exports` map name one set. Enumerate the
surface yourself rather than trusting the parity gate, which is the instrument under suspicion in
claim 8.

**11.** The package is coherent as a whole. Would you publish this? Claim: nothing in the accumulated
seven rounds has left a seam that no single diff shows — a vocabulary that drifted, an option that
two sections describe differently, a refusal that hardened past a legitimate caller. Name the
legitimate caller pattern that broke, if one did.

## Unknowns

- Whether any consumer outside this repository calls the renamed surface is not established here.
  `@orkestrel/scaffold` was measured to use `runSync` at one import and one call, and was updated.
  `@orkestrel/mcp` was measured to use none of the renamed surface. Report anything you find that
  contradicts either, and name what you could not check from this tree.
- Whether `tests/setup*.ts` helpers are themselves proven is not established. Rule on it if your
  attacks reach them; say so if they do not.

## Review evidence

Every path is relative to `/workspace/process`.

- `.orkestrel/process/pc-audit3-diff.txt` — the actual diff, `a13e4e9..1668b62`, which is everything
  since PC-AUDIT2's subject. 1523 lines. `.orkestrel/` is excluded from it because those are campaign
  records rather than package surface; read them directly where a claim needs one.
- `.orkestrel/process/pc-audit3-log.txt` — the actual `git log --oneline` for that range, followed by
  the actual `git status --short`.
- `.orkestrel/process/pc8-verification.md` — the independent verifier's gate report for the tip.
- `.orkestrel/process/pc-audit2-verdict.md` — the previous round's verdicts, which claims 1 through 3
  attack.
- `.orkestrel/process/pc7-report.md` and `pc8-report.md` — what those units say they did. Both are
  claims by the party least able to test them.

The working tree is the tip, so `src/`, `tests/`, `guides/`, and `package.json` read as published.

## Where a probe may live

Write every executable probe as `tmp/probe/<distinct-name>.test.ts` and run it with
`npm run test:probe`. That project exists for exactly this — `vite.config.ts:185-191` includes
`tmp/probe/**/*.test.ts`, `package.json:67` runs it, and the directory is git-ignored. A probe
written anywhere else is either not discovered at all or is discovered by a project it does not
belong to and fails a run nobody caused.

Name your files `objective-<subject>.test.ts` so they cannot collide with the other lane's. Delete
every probe you wrote before you return. Where a probe proves something worth keeping, say so in the
verdict and leave the promotion to the orchestrator; do not add it to the permanent suite yourself.

Do not run the whole gate suite. The verifier's readings are in **Already established**, and a
tree-wide run while this round is live sees the other lane's in-flight files.

## Your verdict

Return exactly the shape `.agents/skills/orkestrel-falsify/SKILL.md` § Verdict shape fixes: numbered
verdicts in this brief's order, each `CONFIRMED`, `BROKEN`, `UNRESOLVED`, or `NOT-EVIDENCED` with the
evidence that value requires; then any findings fitting no claim, each substantiated to the `BROKEN`
standard; then one terminal line and only one.

No process diary. No summary of what you read.
