# PROCESS-AUDIT4: narrow readiness audit before @orkestrel/process 0.0.4 publishes

## Role and engine

Role `analyst`. Engine GPT-5.6 Sol, high effort, sandbox `read-only`, rooted at `/workspace/process`.
You are the objective lane.

## Objective

This is a **narrow** audit, not a fourth full round. Three prior adversarial rounds ran on this
package and their reconciliations are on disk. Rule only on the claims below. Do not reopen a
finding those rounds settled; `AGENTS.md` § Work process forbids another pass over a closed surface.

`@orkestrel/process` 0.0.4 is the first layer of a publish wave, and `@orkestrel/mcp` and
`@orkestrel/scaffold` both carry it as a runtime dependency. A defect here blocks three packages.

## Read first, in this order

1. `AGENTS.md` — in full, and its `Writing` section especially
2. `.claude/rules/quality.md` — the Falsification law owns the method and the evidence each verdict
   carries
3. `.claude/rules/writing.md`
4. `.agents/skills/orkestrel-falsify/SKILL.md` — it fixes the verdict shape, the value set, and the
   single terminal line. Follow it exactly.
5. `guides/process.md`

## Context

- Registry serves `0.0.3`. The manifest here says `0.0.4`. The bump is staged and unpublished.
- The change from `0.0.3` is `git diff <the 0.0.3 tag or commit>..HEAD`; find the boundary yourself
  from `git log` — the commit whose message is exactly `0.0.3` is it.
- The renamed public surface in this release: `run` to `execute`, `runSync` to `executeSync`,
  `RunResult` to `ExecuteResult`, `RunInput` to `ExecuteInput`, `RunSyncOptions` to
  `ExecuteSyncOptions`. `Process`, `ProcessManager`, and `PROCESS_GRACE` did not move.
- Prior rounds are recorded under `.orkestrel/process/`. Read `pc-audit3-reconciliation.md` and
  `pc-audit2-verdict.md` before ruling, so you do not re-raise a settled item. Items those rounds
  explicitly ruled rather than repaired — the Windows `killTree` residue, the core barrel's runtime
  membership boundary, the parity gate's blindness to an `export *` collision, and the absent
  Markdown line-length gate — are closed. Do not re-raise them.
- The tree is committed and clean at dispatch. Untracked `tmp/` files are the expected state.
- Gates ran green before this dispatch. Do not re-run the suite; another agent may be using the tree.
- The sandbox is read-only and the network is unshared. You cannot write a probe file, install, or
  fetch. Where a claim needs an executed reading you cannot take, say so and name the exact command
  that would take it. Do not guess the reading.
- Vendored files are off-limits as subjects: `AGENTS.md`, `CLAUDE.md`, `.agents/`, `.claude/`,
  `.codex/`, `.cursor/`, `configs/helpers.ts`, `scripts/*.sh`, `tests/config.test.ts`,
  `tests/policy.test.ts`, `tests/setupPolicy.ts`. Report a defect in one as a scaffold finding.
- `guides/*.md` other than `guides/process.md` and `guides/README.md` are refetched mirrors. Out of
  scope.

## The claims

Rule on each. Number your verdicts to match.

**Claim 1.** The rename is complete and consistent. No occurrence of the old vocabulary survives
anywhere a consumer or a reader can reach it: not in `src/`, not in a TSDoc, not in an error message,
not in `guides/process.md`, not in `README.md`, not in a test name, not in an exported type name, and
not in a `dist/` artifact built from this tree. Name the pattern and the paths behind your result
including a clean one. Sweep case-insensitively and across inflections: `run`, `runs`, `running`,
`ran`, `Run`, `RunResult`, `runSync`.

**Claim 2.** The rename left no half-renamed concept. `AGENTS.md` § Design laws requires one concept
and one term. Rule on whether `execute`, `executeSync`, and the supervised `Process` now divide the
execution space by a rule a reader can state, and whether any name still carries the old axis.

**Claim 3.** No prose this package owns states a count of a set the package can add to, or names a
list item by its position. Scope: `README.md`, `guides/process.md`, `guides/README.md`, and every
TSDoc and comment under `src/` and `tests/`. Excluded: the guide mirrors, and `.orkestrel/`. An
external identifier is not a count: a version, a date, an exit code, a signal number, a limit, a
duration, and a size all stay. Sweep case-insensitively and across inflections including spelled-out
numbers, and name the pattern and the paths behind your result including a clean one.

**Claim 4.** `0.0.4` is a correct version for what moved. Rule on whether the published surface
changed in a way `0.0.x` can carry, and whether anything in the diff obliges a consumer to change
source rather than only re-pin. `@orkestrel/mcp` imports `Process` and `PROCESS_GRACE` and nothing
else; state whether that import set is unaffected.

**Claim5 is intentionally absent.**

**Claim 6.** The packed artifact is correct: `npm pack --dry-run` lists everything the two entry
points need at runtime and nothing that leaks source, tests, or campaign artifacts. `.orkestrel/` and
`tmp/` must not be in it. State the exact command and read its output.

**Claim 7.** `guides/process.md` and `src/` are in parity in both directions, and no statement in the
guide asserts that a suite executes a check the suite does not execute. State which direction
`test:guides` already proves and rule only on the gap.

## Unknowns

- Whether any consumer outside this repository reaches a renamed symbol. I cannot see the fleet from
  here and neither can you. Report only what this tree shows.

## Scope

Read-only. Own nothing. Edit nothing. Spawn nothing. Perform this assignment directly.

## Output

The verdict shape `.agents/skills/orkestrel-falsify/SKILL.md` fixes, and nothing else. Per-claim
verdicts with executed evidence, findings numbered in one sequence, and the single terminal line the
skill specifies. No process diary.
