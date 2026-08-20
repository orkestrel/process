PC6 complete. Twelve owned files changed; one deletion; two off-limits files returned as patches.

## Per row

**1. One command snapshot.** Extracted `snapshotCommand` at `/workspace/process/src/server/helpers.ts:112`, exported through the existing `export * from './helpers.js'` barrel row. Four verbatim copies replaced by one call: `helpers.ts:857` (`run`), `:1005` (`runSync`), `:1072` (`detach`), `/workspace/process/src/server/Process.ts:108`. Documented at `guides/process.md:92` (Command helpers table) and `:427` (Command resolution prose plus fence). Tested once at `tests/src/server/helpers.test.ts:72`.

No red proof: the extraction is behaviour-preserving and changes no gated statement. The instrument's control is the second assertion — `Object.keys(snapshot)` must equal `['file', 'arguments']`, which fails for any implementation that carries an absent optional as `undefined`.

**2. `waitForExit` reads an undeclared member.** `off` declared at `src/server/types.ts:47`, the `Pick` widened at `helpers.ts:726`, the machinery reduced to `child.off('exit', settled.resolve)` at `:732`, the "same four members" remark corrected at `src/server/types.ts:14`. New case at `tests/src/server/helpers.test.ts:479`.

Red: `npm run check` exit 2 — `TS2344: Type '"exitCode" | "signalCode" | "once" | "off"' does not satisfy the constraint 'keyof ProcessChild'`. Green after: exit 0. The runtime half proved by reverting the release call: `npm run test:src:server` → 2 failed / 109 passed / 7 skipped, exit 1; restored → 111 passed / 7 skipped, exit 0. The revert reddened two rows, not one: the pre-existing `EventEmitter` row and the new one. Both name the same behaviour, and the old one only ever passed on `EventEmitter`'s accidental `off`.

**3. The losslessness the cap removed.** Qualified at `guides/process.md:280` and `:900`, `src/core/types.ts:147`, `src/server/Process.ts:37`. `HANDOFF.md` no longer existed as a separate carrier — I deleted it under the dissolution section. Gated at `tests/guides.test.ts:410` (prose, extending the `twice \`backlog\`` row) and `:419` (executed: a requesting consumer still loses lines once termination begins).

Red: the executed row returned `expected false to be true` when its child died on `SIGTERM`; a child that traps `SIGTERM` and keeps writing makes it deterministic. `npm run test:guides` 3 consecutive runs, 84–85 passed / 1 skipped, exit 0.

**4.** Struck. Not touched.

**5. Tests section.** Both rows added at `guides/process.md:962` and `:966`. Gated at `tests/guides.test.ts:363` — membership of every `*.test.ts` in the tree against the section's links, with `tests/config.test.ts` and `tests/policy.test.ts` named unlisted and a second assertion that fails when a named file becomes listed.

**6. `tests/setup.test.ts`.** Imports merged at `:2`; the `typeof waitForCondition === 'function'` case and its `captureError` import deleted. No red proof: deleting a case and merging an import changes no behaviour and no gated statement. `npm run test:setup` 6 → 5 passed, exit 0.

**7. `ProcessErrorCode` re-listed by hand.** `PROCESS_ERROR_CODES` at `src/core/constants.ts:22`, union derived at `src/core/types.ts:445`, guard membership at `src/core/errors.ts:63`. Tested at `tests/src/core/index.test.ts:34` (admits every declared code; refuses `'stalled'`, drawn from outside the tuple) and `tests/guides.test.ts:395` (the guide's Code table lists exactly the tuple).

Red: with `'aborted'` added to the tuple and the guard still hand-written, `npm run test:src:core` → 1 failed / 3 passed, exit 1. After the guard repair, same command with the sixth code still present → 4 passed, exit 0, with no second edit. The control was then removed and the command re-run → 4 passed, exit 0.

**8. The brand `@remarks`.** Corrected at `src/core/errors.ts:38`. Boundary stated at `guides/process.md:726`. Gated at `tests/guides.test.ts:517` — the sentence, plus a branded error narrowing and an unbranded lookalike of the same shape, name, and declared code being refused.

**9. `truncated` on two surfaces.** Ruled one concept, two bounds, rather than renamed: both report that the surface omitted output, and a consumer reading both acts on the same fact. Ruling at `guides/process.md:927` (Vocabulary). Sentences made to say so at `src/core/types.ts:163`, `:214`, `:236`, and the two remarks at `:148` and `:211`. Gated at `tests/guides.test.ts:439` — the ruling, plus both surfaces driven to `true`. The `HANDOFF.md` per-stream limit landed at `guides/process.md:576`.

**10. Eleven test names.** All eleven renamed for their subject, applicability moved to a cited mechanism comment at the skip. `tests/src/server/helpers.test.ts:139`, `:167`, `:233`, `:254`, `:318`, `:344`, `:557`, `:738`; `tests/src/server/Process.test.ts:228`, `:316`, `:343`. Four skips gained the mechanism comment they lacked (`:231`, `:250`, `:338`, `:728` pre-rename). No red proof: a rename plus a comment changes no behaviour and no gated statement.

**11. Four PC1 contracts.** Stated at `guides/process.md:427` (snapshot), `:344` (both released listeners), `:726` (brand recognition and its 0.0.4 boundary). Each gated executably rather than by substring: `tests/guides.test.ts:466` (one property read, and the snapshot spawns), `:490` (both listeners released), `:517` (brand).

## `HANDOFF.md` rulings

| Section | Ruling |
| ------- | ------ |
| What 0.0.3 is; the delta | Dropped. Narrative and release history; `git log` holds both. |
| Behavioral contract 1–8 | Items 2–8 already in the guide. From item 1, `DEP0190` was missing — added at `guides/process.md:437`. |
| Rulings not to re-litigate | `run`/`runSync`, `process`/`processes`, `strict`, and the signal TOCTOU already in the guide. The `evidence`/`backlog`/`limit` byte-bound naming ruling was missing — added at `guides/process.md:926`. The `SystemRoot` `destroy`, the spawn-faulted `stop`, and the un-hoisted `signal.aborted` are rationale for internal decisions rather than boundaries a consumer meets; dropped, rationale stays in their commits. |
| Look out 2 | In the guide already (`guides/process.md:369`, job objects excluded). |
| Look out 3 | Added at `guides/process.md:576`. One flag, two streams, and how to tell them apart. |
| Look out 4 | Dropped. Test discipline, and `tests/guides.test.ts:1` already states it where it binds. |
| Look out 5 | Dropped. API Extractor's version notice is toolchain noise, not product truth. |
| Look out 6 | The safe-composition half is in the guide already (`guides/process.md:862`). The zero-fleet-consumers half is live state; dropped. |
| Look out 7 | Added at `guides/process.md:629`. `detach` returns nothing deliberately, and where to go for supervision. |
| Look out 8 | In the guide already (`guides/process.md:421`). |
| Look out 9 | In the guide already (`guides/process.md:271`). |
| Look out 11 | Dropped. Repository process, owned by the rules and commits. |
| Look out 1 | **Explicit drop.** Cannot close on this host. The unproven Windows residue is `killTree` through `taskkill.exe` and grandchild tree termination through a live root. Settling command on a Windows host: `npx vitest run --config vite.config.ts --no-cache --project src:server`. No verification-host history added; `guides/process.md:930` already carried what PC3 put there. |
| Look out 10 | Dropped. Live adopter state. |
| Verification map | Dropped. Derivable from `package.json` scripts and the test tree. |
| Upstream adopters; post-republish recipe | Dropped. Live state and a procedure the publishing contract owns. |

## Gate table

| Command | Exit |
| ------- | ---- |
| `npm run format:check` | 0 |
| `npm run lint:check` | 0 |
| `npm run check` | 0 |
| `npm run build` | 0 |
| `npm test` | **1** |
| `npm run test:distribution` | **1** |

Counts on the delivered tree: src 116 passed / 1 failed / 7 skipped, policy 86, config 28, guides 85 / 1 skipped, setup 5.

## Deviation: two unscoped files block the last two gates

Row 1 mandates a barrel export. That breaks two files the brief lists in neither owned nor off-limits, so both fall under "everything else" and are off-limits. I did not edit either. Both failures are exclusively these two files; every other gate is green.

I measured both with the patches applied and then restored both files to their committed bytes: with the patches, `npm test` exits **0** (src 117 passed / 7 skipped) and `npm run test:distribution` exits **0**.

Patch 1 — `/workspace/process/tests/src/server/index.test.ts`, insert one line after `'runSync',` at line 29:

```
			'snapshotCommand',
```

Patch 2 — `/workspace/process/tests/distribution.test.ts`, four counts, at lines 121–122 and 195–196:

```
-			{ entry: 'core', path: 'dist/src/core/index.d.ts', count: 13 },
-			{ entry: 'server', path: 'dist/src/server/index.d.ts', count: 33 },
+			{ entry: 'core', path: 'dist/src/core/index.d.ts', count: 14 },
+			{ entry: 'server', path: 'dist/src/server/index.d.ts', count: 34 },
```

```
-			expect(core).toHaveLength(13)
-			expect(server).toHaveLength(33)
+			expect(core).toHaveLength(14)
+			expect(server).toHaveLength(34)
```

Hypothesis: the brief granted `tests/src/core/index.test.ts` for row 7's symmetric barrel addition and omitted the two server-side and distribution counterparts.

## Recorded ancillary decisions

- **`snapshotCommand` in `helpers.ts`, not a new `cloners.ts`.** The architecture rule places owned snapshots in `cloners.ts`, but it also fixes `cloners.ts` above the leaf pair and says the leaf pair is never consumed by it. `run`, `runSync`, and `detach` live in `helpers.ts` and must consume this function, so a `cloners.ts` home would invert that layering. The brief's placement is the one the rule requires.
- **Row 9 ruled rather than renamed.** Both surfaces report one fact against different bounds; two names would tell a consumer the two facts are unrelated.
- **Row 10 count.** I found and repaired exactly eleven, matching the audit. The renames trace to commit `ed70ad2`, which also produced `'leaves an established grandchild running after a root-only timeout where run ends the tree'` — its trailing clause names a sibling behaviour the same test drives, not an applicability condition, so it stays.

## Files changed

`/workspace/process/src/core/constants.ts`, `/workspace/process/src/core/errors.ts`, `/workspace/process/src/core/types.ts`, `/workspace/process/src/server/types.ts`, `/workspace/process/src/server/helpers.ts`, `/workspace/process/src/server/Process.ts`, `/workspace/process/guides/process.md`, `/workspace/process/tests/guides.test.ts`, `/workspace/process/tests/setup.test.ts`, `/workspace/process/tests/src/core/index.test.ts`, `/workspace/process/tests/src/server/helpers.test.ts`, `/workspace/process/tests/src/server/Process.test.ts`; deleted `/workspace/process/.orkestrel/process/HANDOFF.md`. `src/server/index.ts` needed no edit — its `export * from './helpers.js'` row already carries `snapshotCommand`. Diffstat: 13 files, 445 insertions, 390 deletions. Nothing committed.