# Process fix-unit audit verdict — Opus 5 reviewer (cross-engine), 2026-08-20

Subject: the Sol fix unit at commit 7010200. Captured verbatim from the reviewer's return; the
terminal line and per-claim structure are the auditor's own.

## Claim 1 — prose corrections: BROKEN

PR2 CONFIRMED (the corrected destroy/refusal order holds under every constructible interleaving;
ProcessManager.ts:113-130 vs :168-173, :208). PR4 CONFIRMED (no `guarantee` hit remains). PR10
CONFIRMED (no pid offer; surviving `pid` mentions describe `ProcessChild` and `killTree`).

PR1 BROKEN: guides/process.md:387 and src/server/helpers.ts:704 carried "at once" in the permitted
simultaneity sense — "`taskkill /F /T` on the whole tree at once" and "Windows ends the tree at
once through `killTree`" — and the phrase was deleted anyway, dropping the fact that the Windows
path ends the whole tree in one call. The third site's actual banned word was `now` at
guides/process.md:936-937 ("reaches whatever holds that pid now"), repaired but reported under the
wrong finding. Correct the record; restore the simultaneity fact at both sites or record the drop
deliberately.

PR3 BROKEN: README.md:14-15 now under-claims — `ProcessManagerInterface.launch` takes
`ProcessOptions` whose `signal` member (src/core/types.ts:136) cancels a managed child, and the
sentence reads as an enumeration that excludes it. Name every consumer and abstainer.

## Claim 2 — the restructure: BROKEN on the kind-file choice

`handlers.ts` is not a lawful kind file: `.claude/rules/architecture.md:31` assigns `*/handlers.ts`
to request handlers, `:92-95` fixes the meaning (paired with `routes.ts`), and this package has no
request and no route. The rule citation in the unit's report is the evidence against the choice.
The lawful homes: a registered function-domain folder (`FUNCTION_DOMAIN_FOLDERS`, fleet-canon
registration, no workspace-local path), or the leaf if the class construction were removed —
refused, because PR11's accepted ruling moved the imperative shell out. Class-free leaf CONFIRMED;
no published name moved CONFIRMED; no hidden helper CONFIRMED.

## Claim 3 — pre-spawn option ownership in `execute`: CONFIRMED

Every `ExecuteOptions` member binds at handlers.ts:62-69 before validation and spawn; no later
`options` read; the proof binds to the pre-image defect.

## Claim 4 — skipIf rulings: CONFIRMED

The enumeration is complete and every row cites its mechanism.

## Claim 5 — report honesty: BROKEN

The PR1 misruling, the unflagged kind mismatch presented as rule-derived, and the unreported
test/guide displacement (F1). Exit codes and counts not verifiable from a read-only seat.

## Findings outside the claims

- F1: the behavioural suites for `execute`, `executeSync`, and `detach` stayed in
  tests/src/server/helpers.test.ts (:765, :962, :1160) while the functions moved; the guide's
  inventory rows (guides/process.md:1033-1036) point at the old home and import the word
  `handlers` undefined. Move the suites with the module the claim-2 ruling settles on; rewrite
  both rows.
- F2: `executeSync` and `detach` read caller getters more than once (handlers.ts:224-237,
  :291-292), so the value validated is not the value spawned — the same class PR6 closed for
  `execute`. Hoist each option once before validation.
- F3: the read-once invariant PR6 established is pinned by a test and stated in no contract. State
  it on `ExecuteOptions` and in the guide's one-shot section.

VERDICT: FAIL — 3 broken, 0 unresolved, 1 not-evidenced, 3 findings outside the claims

## Orchestrator rulings on this verdict

- PR1, PR3, F2, F3 → the follow-up unit A (tmp/followup-a-brief.md).
- The kind-file ruling: register `src/server/execution` in `FUNCTION_DOMAIN_FOLDERS` through the
  fleet-canon path (the scaffold host inventory owns the register), then move `execute.ts`,
  `executeSync.ts`, and `detach.ts` there as single-function modules, delete `handlers.ts`, and
  move the behavioural suites to mirror — follow-up unit B, after the scaffold release ships the
  registration (`run` is a banned synonym, so the domain takes the noun `execution`).
