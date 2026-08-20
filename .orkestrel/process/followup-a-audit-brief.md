# Audit of process follow-up unit A

## Role and engine

GPT-5.6 Sol `analyst`, read-only sandbox, at `/home/user/process`. Claude Opus 5 wrote the unit,
so this audit is the cross-engine lane.

## Objective

Per-claim verdicts on the follow-up unit at commit ce0ee20 (the HEAD commit; the diff is at
`tmp/followup-a-diff.patch`, the unit's report at `tmp/followup-a-report.md`, its brief at
`tmp/followup-a-brief.md`, the binding design reconciliation at `tmp/pid-reconciliation.md`).

## Context

Read first: AGENTS.md, .claude/rules/names.md, .claude/rules/typescript.md,
.claude/rules/patterns.md, .claude/rules/writing.md, .claude/rules/tests.md, and the guide
sections the diff touches. You may run read-only commands and scoped vitest runs; the host carries
concurrent load, so a timing reading is an observation. Never run a git state-mutating command.

## The claims

1. The landed `pid`, `code`, and `signal` members match the reconciliation exactly: required
   getters over the held child with no stored state, `pid` leading the data block, the TSDoc
   stating eager-spawn observability, the failed-spawn `undefined`, survival past exit, no
   liveness meaning, and the close-versus-exit distinction; the guide derives liveness instead of
   the surface storing it, and the parity rows, surface notes, and practices bullet all landed.
2. The proofs bind to their defects: each recorded red fails for the reason its name states on the
   pre-change code; the descendant-window proof genuinely holds the `exit` promise pending behind
   inherited stdio while `code` reads; the spawn-fault proof asserts the sign and the agreement
   with the `exit` value, never a platform errno number; nothing mocks or fakes project-owned
   behavior.
3. The F2 hoists are complete: no caller option is read more than once anywhere in `executeSync`
   or `detach`, the mutating-getter proofs would fail on the pre-fix code, and `execute` still
   holds its own discipline.
4. The prose corrections are true of the code and hold the writing canon: the restored
   simultaneity fact, the README cancellation enumeration (`launch` included), the
   `ExecuteOptions` read-once invariant in both homes, and the guide's restored pid offer.
5. The unit's report is honest: reds and greens as recorded, the flagged Linux-only caveat
   accurate, nothing material omitted.

## Execution

Perform this assignment directly. Spawn nothing. Edit nothing. State no count in prose you write;
never name a list item by its position.

## Output

The orkestrel-falsify verdict shape: numbered verdicts in claim order with file:line evidence,
findings outside the claims at the BROKEN standard only, one terminal VERDICT line.
