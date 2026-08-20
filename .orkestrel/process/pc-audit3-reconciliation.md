# PC-AUDIT3 — reconciliation

Two lanes, one brief, blind, clean contexts. Sol held the objective lane; an Opus reviewer held the
subjective lane and was told its own engine wrote PC7 and PC8 and to attack that half harder. Both
returned **VERDICT: FAIL**.

Sol: 6 confirmed, 4 broken, 1 unresolved, no findings outside the claims.
Opus: 4 confirmed, 6 broken, 1 finding outside the claims.

Every finding below was reproduced by the Orchestrator before it was carried.

## Where the lanes disagree, and why both are right

Claim 4 asked whether PC7's rename is complete. Sol answered **CONFIRMED**; Opus answered
**BROKEN**. They answered two different questions.

Sol asked whether any *identifier* still reads `run`. None does. Opus asked whether the word still
names this concept anywhere a reader meets it, and found `runner` and `runners` naming the two
renamed functions in eight shipped places — including the first sentence of `README.md`, which is
what npm renders, and two TSDoc blocks that ship in `dist/`.

PC7's instrument was a `\brun\b` pattern, so `runner` was outside its membership rule and was never
ruled on. The report then declared the sweep complete. That is the search-scope failure the dispatch
laws name: a search proves something about the population its pattern admits, and nothing about the
population it was drawn from.

## The Orchestrator's ruling on the noun

Rename the agent noun. Keep the English noun.

- `runner` and `runners`, naming the functions, go. A guide that rules "use the fixed lifecycle verb"
  at `guides/process.md:965` and then heads a section `### Runners` gives a reader two answers, and
  `AGENTS.md` § Design laws fixes one concept to one term.
- "a run", meaning one invocation — "the run stays pending", "a terminated run" — stays. It is
  ordinary English for the thing that happened, not a second name for the function. Sol's claim 5
  confirmed every one of those survivors is correct.
- The Vocabulary table gets a row ruling that split, so the next round does not reopen it.

## Findings carried

| # | Finding | Lane | Reproduced |
| - | ------- | ---- | ---------- |
| F1 | `guides/process.md:960` heads a five-row table with "Three names". PC7 rewrote the first row of that table and did not read the sentence above it. | Both | Yes |
| F2 | `.orkestrel/process/readiness-grade.md` Q17 says "the twelve exports that appear in no guide fence" and then "All sixteen claims are true". `tests/guides.test.ts:851` says sixteen. | Sol | Yes |
| F3 | `.orkestrel/process/pc7-report.md:9` reports `run` at 55 before and 44 after. The measured population is 45 occurrences on 41 lines. The "After" cell is 55 − 11, arithmetic on two other cells presented as a measurement. | Opus | Yes |
| F4 | `runner`/`runners` names the renamed functions at `README.md:8`, `guides/process.md:6`, `:51`, `:551`, `:599`, `:633`, `src/core/types.ts:14`, `:308`, `tests/guides.test.ts:768`, and `tests/src/server/helpers.test.ts:943`. | Opus | Yes |
| F5 | `tests/guides.test.ts:509-518`, named `documents the constant values its Surface table prints`, never reads the guide. It compares eight imported constants against eight literals in the test, so the guide's `Value` column is guarded by nothing. | Opus | Yes |
| F6 | `tests/guides.test.ts:467-468` claims "a later per-stream field breaks this test rather than leaving the sentence stale". The test asserts `truncated` and two byte lengths, so a per-stream field changes none of them. | Both | Yes |
| F7 | `guides/process.md:605-606` tells a consumer to "bound the two streams separately by running the command twice". `limit` is one number applied to both streams, so no number of runs bounds them separately. The technique that works is re-running with a `limit` high enough that `truncated` is false. | Opus | Yes |
| F8 | Five temporal `once` occurrences remain: `guides/process.md:279`, `src/core/types.ts:146`, `src/server/Process.ts:31`, `src/server/types.ts:43`, `src/server/helpers.ts:746`. The last states, with `once`, the same rule `src/core/types.ts:188` states with `after`. | Opus | Yes |
| F9 | `src/core/types.ts:8` introduces the tiers as "smallest to largest" and lists the eight-member `ProcessInterface` first and a single function second. `guides/process.md:38` uses the accurate axis, lifetime. | Opus | Yes |
| F10 | The rename lengthened tokens in place without rewrapping. `guides/process.md` and `README.md` carry a hand-wrap convention that no gate reads, because `oxfmt` does not format Markdown. | Opus | Yes |

## The escalation ruling

`.claude/rules/quality.md` says that after enough findings at one seam the ruling owed is on the
design rather than on the next defect. Two seams reached that point in this round.

**A count stated in prose beside the enumeration it counts.** PC-AUDIT2 finding 19 was
`src/server/types.ts:14` saying "the same five members" over six. PC-AUDIT3 F1 is
`guides/process.md:960` saying "Three names" over five rows. Same shape, two consecutive rounds,
each repaired only where it was pointed at. The rule owed: do not count the rows of an adjacent
enumeration. Opus enumerated nineteen other count-bearing sentences in this package and found every
one correct, so the rule must not ban a count of a fixed conceptual set — three tiers, two hosts,
two runners — which is stable prose. It bans the count that duplicates a list the reader is about to
read.

**A prose sweep run case-sensitively.** F8 exists because the `once` sweep — the Orchestrator's and
the verifier's alike — used `\bonce\b` against a file whose offending occurrences are all
sentence-initial `Once`. The Orchestrator then supplied "every other `once` in the guide is the
counting sense" to this round as established evidence, where its job was to stop a lane attacking
that ground. Opus attacked it anyway and refuted it. The rule owed: a word sweep for a prose rule is
case-insensitive, and an established-evidence statement names the exact instrument that produced it.

Both rules land in `.claude/rules/writing.md`, which reaches every package through the vendored host.

## Ruled, not repaired

- **Sol claim 9, the Windows residue.** `guides/process.md:978-981` records that current `killTree`
  through `taskkill.exe` and grandchild termination are proven on no host, and names the exact
  command that settles them. That is the documented-limit disposition and it stands. It is not
  reachable from this container.
- **Opus claim 6's boundary.** The core barrel's exact runtime membership is pinned by
  `tests/distribution.test.ts`, which runs from `test:distribution` rather than from `npm test`.
  Between publishes the membership is pinned statically by the parity gate. Opus called this a real
  narrowing rather than a loss, and `prepublishOnly` includes the distribution project. Recorded.
- **Opus claim 7's boundary.** The parity gate parses source text and never loads a barrel, so an
  ESM `export *` collision that makes a name absent at runtime is invisible to it. Every server
  export except `Process` and `ProcessManager` is imported by name somewhere in `tests/`. Opus
  declined to raise it as a finding. Recorded.
- **A Markdown line-length gate.** F10's convention drifts because nothing reads it. Adding a gate
  is new capability and would redden roughly thirty pre-existing lines, so it is a successor
  decision rather than part of this fix.

## Carried

F1 through F10 are carried by one fix unit, PC9. The two escalation rules are carried by a scaffold
commit. Nothing is dropped.
