Unit complete. All gates green; nothing committed.

## Repairs

| # | Repair | Carrier |
| - | ------ | ------- |
| A1 | `isolated: true` leaves no `PATH` on POSIX — now executed, host-gated | `/workspace/process/tests/guides.test.ts:519` |
| A2 | Spawn fault: negative errno for `run`, `null` for `runSync`, negative for `ProcessExit` | `/workspace/process/tests/src/server/helpers.test.ts:880`, `:1077`, `/workspace/process/tests/src/server/Process.test.ts:388` |
| A3 | Detached POSIX child survives the supervisor group's `SIGKILL` and never receives its `SIGINT` | `/workspace/process/tests/src/server/helpers.test.ts:1153` |
| A4 | `moduleResolution` floor compiled per named mode inside the installed consumer, `skipLibCheck: false` | `/workspace/process/tests/distribution.test.ts:228-296` |
| B5 | Termination proof's `run` half moved to a 200 ms root deadline and gated on the readiness marker | `/workspace/process/tests/src/server/helpers.test.ts:944`, `:953` |
| B6 | Standalone negative control deleted; the consumer-rooted control at `tests/distribution.test.ts:90` stands alone | `/workspace/process/tests/distribution.test.ts` (removed lines 18-21) |
| B7 | Extraction fallback gated on `import.meta.env.MODE !== 'release'` | `/workspace/process/tests/distribution.test.ts:66` |
| C8 | Built-artifact brand recognition moved out of `src:core` into the distribution proof | `/workspace/process/tests/distribution.test.ts:204-226`, `/workspace/process/tests/src/core/index.test.ts:32` |
| Q15 | Real non-detached child killed through `killProcess`, with the pre-repair ESRCH swallow as its in-test control; `ProcessChild` remarks name the direct fallback | `/workspace/process/tests/src/server/helpers.test.ts:683`, `/workspace/process/src/server/types.ts:19-22` |
| Q16 | POSIX termination row names both routes | `/workspace/process/guides/process.md:355` |
| Q17 | 16 unfenced TSDoc examples transcribed and asserted | `/workspace/process/tests/guides.test.ts:642` (table), `:697`, `:702`, `:714`, `:721` |
| Q19 | README backticked-name resolution and relative-link existence | `/workspace/process/tests/guides.test.ts:774`, `:785`, `:790` |
| Q20 | Three both-armed cases: timeout first, abort first, shared deadline | `/workspace/process/tests/src/server/helpers.test.ts:792`, `:812`, `:831` |
| — | `waitForCondition` TSDoc names the real bound (budget + one interval + one evaluation) | `/workspace/process/tests/setup.ts:3-24` |

## Red-then-green, per row

| Row | Command | Red | Green |
| --- | ------- | --- | ----- |
| A1 | `npm run test:guides` (control: `isolated: false`) | 1 failed \| 57 passed | 58 passed |
| A2 run/runSync | `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:server -t 'cannot be spawned'` (control: a command that really spawns) | 2 failed \| 114 skipped — `expected 3 to be less than 0`, `expected 3 to be null` | 2 passed \| 114 skipped |
| A2 `Process` | same runner, `-t 'emits the error cause on a spawn fault'` (control: `toBeGreaterThan(0)`) | 1 failed — `expected -2 to be greater than 0` | 1 passed |
| A3 SIGINT half | same runner, `-t 'detached child beating'` (control: wait on the detached child's `.sigint`) | 1 failed — `The condition did not hold within 3000ms` | 1 passed |
| A3 SIGKILL half | same command (control: roles swapped) | 1 failed — `expected 1787192527818.3 to be 1787192527414.3` | 1 passed |
| A4 | `npm run test:distribution` (control: import an absent export from the installed package) | 1 failed — `expected [] to deeply equal [ 'node16', 'nodenext', 'bundler' ]` | 1 passed |
| B5 | same runner, `-t 'leaves an established grandchild'`, at `timeout: 50` with the readiness wait | 1 failed × 3 runs — `The condition did not hold within 6000ms` | 1 passed × 3 runs at `timeout: 200` |
| B7 | `npm run test:distribution -- --mode release` with a denial-classified install failure forced | 1 failed — `npm install failed: npm error code ENOENT` | 1 passed (and the same forced failure passes in default mode through the extraction fallback) |
| C8 | `npm run test:src` with `dist/` moved away | 1 failed \| 112 passed \| 7 skipped — `built core entries did not load` | 113 passed \| 7 skipped, `dist/` absent (`ls dist` → no such file) |
| Q15 | same runner, `-t 'kills a real non-detached child'` (control: pre-repair swallowed group signal) | 1 failed — `expected null to be 'SIGKILL'` | 1 passed |
| Q17 | `npm run test:guides` (control: every claim perturbed) | 16 failed \| 61 passed | 77 passed |
| Q19 | `npm run test:guides` (control: `` `runFast` `` token and a broken link in README) | 2 failed \| 75 passed | 77 passed |
| Q20 | same runner, `-t 'armed'` and `-t 'share a deadline'` (control: opposite winner asserted) | 1 failed each, three cases | 1 passed each |

B6 has no red count: its defect is evidence, not behaviour. `createRequire(import.meta.url).resolve('@orkestrel/process')` from that file returned `/workspace/process/dist/src/core/index.cjs` — the repository's own manifest through self-reference — and `node_modules/@orkestrel/process` is `0.0.3`. Neither is the packed artifact, so the control was deleted rather than re-rooted.

## Which executed assertion binds each added item

1. `tests/guides.test.ts:530` — `expect(keys.includes('PATH')).toBe(false)` in a POSIX-gated case reading the real child's environment.
2. `tests/src/server/helpers.test.ts:889` — `expect(code).toBeLessThan(0)` on `run`; `:1085` — `expect(result.code).toBe(null)` on `runSync`; `tests/src/server/Process.test.ts:388` — `expect(code).toBeLessThan(0)` on `ProcessExit`. Measured value on this host: `-2`.
3. `tests/src/server/helpers.test.ts:1219-1221` — the detached child's heartbeat mtime advances after `process.kill(-supervisor, 'SIGKILL')` while the grouped child's is unchanged; `:1211-1213` — the grouped child writes its `.sigint` marker and the detached child never does. The `SIGINT` half is now proven, through a group-directed signal, which is what a terminal delivers to its foreground group.
4. `tests/distribution.test.ts:292-294` — `expect(compiled).toEqual(['node16','nodenext','bundler'])` over four real `ts.createProgram` runs inside the installed consumer, with `node10` as the permanent firing control. Its diagnostic is the README sentence compiled: `Cannot find module '@orkestrel/process/server' … could not be resolved under your current 'moduleResolution' setting. Consider updating to 'node16', 'nodenext', or 'bundler'.`
5. `tests/src/server/helpers.test.ts:953` — `await waitForCondition(() => existsSync(\`${streamedMarker}.ready\`), 6_000)` between the expiry assertion and the negative.
6. `tests/distribution.test.ts:90` — `expect(() => consumerRequire.resolve('@orkestrel/process/absent')).toThrow(/Package subpath/u)`, rooted in the temporary consumer, is now the only such control.
7. `tests/distribution.test.ts:66` — `if (!denied || import.meta.env.MODE === 'release') throw`.
8. `tests/distribution.test.ts:225-226` — `recognized` true and `plain` false from `brand.mjs`, which constructs through the installed CJS entry and guards through the installed ESM entry. `tests/src/core/index.test.ts` no longer touches `dist/`.

## Q17 count

16, not twelve. Every one is a `src/server` helper: `buildExecutableCandidates`, `buildPlatformSpawn`, `isFile`, `mergePlatformEnvironment`, `readPlatformVariable`, `readVariable`, `resolveExecutable`, `retainChunk`, `trimHead`, `trimTail`, and the six `validate*` helpers. Of their `@example` blocks, 9 claim a returned value in a trailing comment, 6 claim completion (`// returns`), and `buildExecutableCandidates` claims nothing at all. I bound all 16 rather than only the 9 strictly value-bearing ones; `buildExecutableCandidates` is now asserted against the ten-candidate list it actually returns.

How I took it: parsed the guide's `ts` fences with `createGuide`, took both faces' `surface()` through `createSource` from `@orkestrel/guide`, marked a name unfenced when no fence body matched it on a word boundary, then read each unfenced export's `@example` block out of `src/server/helpers.ts`. Both instruments were deleted with the rest of `tmp/`.

## Gates

| Command | Exit |
| ------- | ---- |
| `npm run format:check` | 0 |
| `npm run lint:check` | 0 |
| `npm run check` | 0 |
| `npm run build` | 0 |
| `npm test` | 0 (113 \| 7 skipped, 86, 28, 78 \| 1 skipped, 6) |
| `npm run test:distribution` | 0 (1 passed) |
| `npm run test:distribution -- --mode release` | 0 (1 passed) |

## Files changed

- `/workspace/process/tests/guides.test.ts` — PATH case, 16 TSDoc example transcriptions, README parity block (+202/-1).
- `/workspace/process/tests/src/server/helpers.test.ts` — real-child kill, three both-armed cases, two spawn-fault codes, detachment proof, repaired termination half (+227/-8).
- `/workspace/process/tests/distribution.test.ts` — control deleted, mode gate, cross-format brand, four resolution programs (+117/-11).
- `/workspace/process/tests/src/core/index.test.ts` — built-artifact assertion removed, project is hermetic (+3/-19).
- `/workspace/process/tests/src/server/Process.test.ts` — spawn-fault code asserted by sign (+6/-1).
- `/workspace/process/tests/setup.ts` — `waitForCondition` bound restated (+10/-3).
- `/workspace/process/guides/process.md` — POSIX termination row names both routes (+4/-4).
- `/workspace/process/src/server/types.ts` — `ProcessChild` remarks name the direct fallback (+4).

Diffstat: 8 files, 561 insertions, 35 deletions. `README.md` is owned and unchanged: Q19 needed test-side binding only.

## Recorded, no code changed

- **No respawn path, and `buildSpawn` does not validate.** Confirmed by reading all four entry points: `run` (`helpers.ts:834-875`), `runSync` (`:995-1018`), `detach` (`:1075-1087`), and the `Process` constructor (`Process.ts:114-137`) each freeze their own snapshot, call `validateCommand` on it, and pass that same object to `buildSpawn` and `spawn`. `buildSpawn` resolves and shapes only; its single throw is `buildPlatformSpawn`'s `%` refusal for a Windows batch target.
- **`waitForCondition` rejects at or after its budget, never inside it.** The deadline is read only after a failed poll. Its TSDoc now names the bound instead of inviting the wrong claim.

## Deviation state and residue

- No deviation stopped the unit. One conflict between my two governing documents, resolved in favour of the amendment: `pc-audit-reconciliation.md` lists Q16 under PC6, while `pc5-amendment.md` keeps the Q16 criterion in PC5's list. I implemented Q16 here. It carries no substring gate — the executed binding for that row is the Q15 test, which proves the direct fallback the row now names.
- Windows residue, unchanged and unprovable on this host: the `isolated: true` Windows half (libuv's injected set), the `resolveExecutable` absolute-path case (present at `tests/guides.test.ts:721`, skipped here), and `killTree` through `taskkill.exe`. Settle all of them with `npx vitest run --config vite.config.ts --no-cache --project src:server --project guides` on a Windows host.
- `HANDOFF.md`, its disposition table, and the "Look out for" rulings are struck from this unit per the amendment; PC6 owns them.
- Instruments deleted: `tmp/probe/` and `tmp/analysis/`. `dist/` is rebuilt and current. Nothing is committed; the rollback point `4b01d30` is intact.