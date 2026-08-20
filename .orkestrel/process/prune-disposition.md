# Disposition of every process row no unit carries

`pd-b-carry-check.md` covered four campaign folders and recorded 52 items with no carrier. This file
rules on the ones belonging to `@orkestrel/process`, so `.orkestrel/process/` can be pruned without
destroying an open item. `.agents/orchestration.md` § Before you prune, check 1: every item ends with a
commit that closed it, a live brief that owns it, or an explicit drop on the record.

Row numbers are `pd-b-carry-check.md`'s.

## Closed by a commit

| Rows | Subject | Commit |
| ---- | ------- | ------ |
| 27, 28, 29, 30, 31, 32 | Q9 `%1`, Q10 `isolated`, Q11 spawn-fault codes, Q12 detached survival, Q13 the distribution proof, Q14 the module-resolution floor | `4b01d30` |

The two-lane audit ruled Q10, Q11, Q12, and Q14 **UNPROVEN**: each closed with a substring assertion
rather than an executed one. PC5 carries the executed proofs. The rows are closed; the proofs are not.

## Carried into a live brief

| Rows | Subject | Brief |
| ---- | ------- | ----- |
| 33, 35, 36, 37 | Q15 ESRCH guard, Q17 unfenced `@example` blocks, Q19 README parity, Q20 first-wins | PC5 |
| 34 | Q16 the POSIX termination table | PC6 |
| 39 | PC1's four undocumented contracts | PC6, added by amendment |

## Dropped, with the reason

| Rows | Subject | Why it drops here |
| ---- | ------- | ----------------- |
| 25, 26, 38 | Windows `killTree` through `taskkill.exe`, grandchild termination through a live root, `stopChild`'s fallback, `killTree`'s cut-off, and `b392629`'s re-verification | No `win32` host exists in this session. The settling command is `npx vitest run --config vite.config.ts --no-cache --project src:server` on Windows, and it is stated in the release record rather than hidden. The decidable half — environment folding, `PATHEXT` order, batch routing, quoting, the percent refusal — executes on every host and is proven here. |
| 40 | API Extractor prints a version notice, bundled TypeScript 5.9.3 against project 6.0.3 | Non-fatal build noise from an upstream that has not shipped a 6.x engine. It recomputes on every build; a document recording it would be the ledger `.agents/orchestration.md` refuses. |
| 41 | `detach` returns `void`; a pid return was considered and dropped | A decision, in the commit that made it. `AGENTS.md` § Design laws: add a capability with its first real consumer. Reopen it when one exists. |

## Belongs to another package

Each is recorded in the orchestrator repository's `ROADMAP.md` against the package that owns the fix.

| Rows | Subject | Owner |
| ---- | ------- | ----- |
| 42 | `guides/mcp.md` near line 4187 still describes the pre-0.0.2 `node:child_process` transport | mcp |
| 43 | `SEAOptions` exposes no `timeout`, so `runShell` cannot bound a signing tool with stdio-inheriting descendants | sea |
| 46 | supervisor still pins mcp `^0.0.18` and sea `^0.0.8` | supervisor, user-owned |
| 47 | `@orkestrel/contract@0.0.12`'s `isContractError` fails across ESM and CJS the same way `isProcessError` did | contract |
| 59 | `@orkestrel/test` publishes no `waitForCondition` | test |
| 48-58 | Every probe row this sweep found | probe; `../../../probe/.orkestrel/probe/prune-disposition.md` rules on them |

## Closed by a mechanism rather than a fix

| Row | Subject | Mechanism |
| --- | ------- | --------- |
| 44 | scaffold's `guides/process.md` mirror documented the 0.0.2 surface | `scaffold catalog` refreshed it to 0.0.3 in the orchestrator repository, commit `2d026ec`. It goes stale again when 0.0.4 publishes, and the release wave's own `scaffold overwrite` step refreshes it. A mirror is fetched bytes; it is never repaired by hand. |

## Needs the user

| Row | Subject |
| --- | ------- |
| 45 | Publishing `process` 0.0.4 obliges `mcp` 0.0.20 and then `scaffold` 0.0.45, in layer order, in one window. The registry serves process 0.0.3, mcp 0.0.19, and scaffold 0.0.44 as of 2026-08-20. Publishing is the owner's decision and the owner's credential. |

## What this file owes the prune commit

Every dropped row must appear in the prune commit's message. Every row belonging to another package
must already be in `ROADMAP.md` before `.orkestrel/process/` is deleted. The user row is surfaced
before the prune, not after.
