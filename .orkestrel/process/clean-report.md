# CLEAN-PROCESS — report

Unit: `implementer`, Opus 5. Brief: `clean-brief.md`. The owner's ruling: no count in prose, anywhere.

## What changed

Twelve files, 80 insertions, 80 deletions. `README.md`, `guides/README.md`, `guides/process.md`,
`src/core/types.ts`, `src/server/Process.ts`, `src/server/helpers.ts`, `src/server/types.ts`,
`tests/guides.test.ts`, `tests/distribution.test.ts`, `tests/src/core/errors.test.ts`,
`tests/src/server/Process.test.ts`, `tests/src/server/helpers.test.ts`.

No vendored file was modified.

## The shape of the recasts

A count almost never deletes cleanly; the sentence has to be recast, and that is the work.

- "A typed child-process toolkit in three tiers" became "in tiers".
- "The two hosts terminate differently, and only one of them has a cooperative phase" became
  "POSIX and Windows terminate differently, and only POSIX has a cooperative phase" — naming the
  members rather than counting them.
- "reports the outcome through four booleans, and the other three each report one thing" became
  "reports the outcome through booleans, and `expired`, `aborted`, and `truncated` each report".
- "`stop` is a three-overload terminator" became "an overloaded terminator".
- "so two iterators over the same child split" became "so concurrent iterators over the same child
  split" — the arity was never the point, the concurrency was.
- A test titled "collapses a double stop and a concurrent abort" became "collapses repeated stops",
  and the count in the old title was already wrong: the test issues three.

## What the unit kept, and why

`one` as a contract's arity — "supervises one child", "one-shot", "the one path that builds a
command line" — states cardinality rather than tallying a growable set.

Thresholds and multipliers that govern behaviour: `twice backlog`, `resumes at half of it`, `at most
limit bytes`. Durations, sizes, versions, dates, and exit codes. Measurements reported with the host
that produced them: "Node bootstraps in 45.7 to 49.9 ms on this host".

Frequency rather than set size: `once`, `read exactly once`, `polls at least twice`.

Runtime and algorithmic order rather than a list position: `tried first`, `whichever comes first`,
`the final kill`, `destroy the emitter last`.

`both`, where the two members are named in the same sentence or the one before — "Both `Process` and
`ProcessManager`", "never both true" after `expired` and `aborted`. A determiner pointing at two
named things cannot go stale: adding a third makes the sentence wrong in a way a reader sees.

Every numeral inside a fenced block, an `@example` body, an array index, a string literal, or an
identifier. The ban is on prose.

## The guide-and-gate pair

One existed and it did not redden. The `PROCESS_ERROR_CODES` `Value` cell in the guide's Constants
table is named in `tests/guides.test.ts`'s `PROSE_CONSTANTS` doc. The executing assertion is
structural — it requires only that the cell stay prose — and "the code tuple" does. The doc comment
moved with the cell so the two cannot drift.

The parity gate asserts three guide substrings carrying `both` or `one`. All three were ruled values
and left untouched, so no assertion moved.

## Two items the unit ruled on and referred up

**The brief's scope list was wider than the vendored set.** It granted `configs/`, `scripts/`, and
`tests/` wholesale. `@orkestrel/scaffold` 0.0.44's host manifest vendors `configs/helpers.ts`,
`configs/policy.ts`, every `scripts/*.sh`, `tests/config.test.ts`, `tests/policy.test.ts`, and
`tests/setupPolicy.ts` into this tree. The unit treated them as vendored and did not edit them, on
the standing law that a vendored file inside a target is restored by `repair` and reports as drift in
`scaffold audit`. **Correct call.** Their counts belong to the scaffold source and are swept there.

**`AGENTS.md` in this checkout does not yet carry the ban.** The rule landed in
`@orkestrel/scaffold` and arrives here through `repair` after that package publishes. The unit worked
from the brief's copy of the text and said so.

## Gate evidence

Eight acceptance criteria, all exit 0, at the unit's own reading: `format:check`, `lint:check`,
`check`, `test:guides` (86 passed, 1 skipped), `test:policy` (86), `src:core` (3), `test:config`
(28). The authoritative reading is the verifier's.

The unit did not run `src:server`: it is timing-sensitive, the unit's own exec is load, and the only
change under it is one test title. The Orchestrator takes that reading.

## Independent gate evidence

`verifier`, Sonnet, read-only. Every gate exits 0: `format:check`, `lint:check`, `check`, `build`,
`test`, `test:distribution`, `scaffold audit` (0 of 123 planned paths drifted).

Test counts as the runner printed them: `test:src` 4 files, 114 passed, 7 skipped (121);
`test:policy` 86; `test:config` 28; `test:guides` 86 passed, 1 skipped (87); `test:setup` 5;
`test:distribution` 1.

The verifier re-ran the sweep independently over authored prose. Every remaining cardinal or ordinal
hit is `one` as a pronoun or adjective, or `first` as runtime order — no decorative count survives.
The single hit inside a fenced block is `// stop after ten seconds` beside a `10_000` timeout, which
is a duration in code.

No off-limits file changed. Both barrels are pure `export * from './module.js'`.
