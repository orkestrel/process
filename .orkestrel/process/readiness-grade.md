# Production-readiness grade, 2026-08-19

Six blind audit lanes, three per package, each required to end every row IMPLEMENT, REPAIR,
RETAIN, EXCLUDE, or UNPROVEN with executed evidence and a concrete closing condition. Graded on
coverage per `.claude/rules/quality.md`, never on polish.

The lane reports follow the grade.

---

# @orkestrel/process

## 1. Verdict

**Not production-ready as it stands. Four defects must close before the 0.0.4 window.**

This package is in a different class from `probe`. Its published surface is executed end to end and holds: both entries load and run in both module formats, under npm and pnpm, on the declared Node floor with a firing Node 20 control; export parity is exact in both directions; 18 of 19 guide fences typecheck against the shipped declarations; every documented example runs; the tarball is clean and reproducible. What stops it:

- **`stop()` retains unbounded memory.** With `backlog: 1024`, a SIGTERM-trapping flooding child, and one iterator that stopped draining, a single `stop()` drained 29,721,480 bytes and grew the parent heap 45 MB. `HANDOFF.md` states the overshoot bound as "one delivered stream chunk plus one line". That is falsified by 29,000×.
- **Every caller-supplied command string is validated on one read and spawned from another.** A getter that answers differently on the second read defeats `validateCommand` in all four entry points, the thrown error is a host `TypeError` rather than the `ProcessError` coded `invalid` that every `@throws` tag promises, and a validated `file` is not necessarily the spawned file. For a library whose only job is spawning processes, that is not an ergonomics gap.
- **`isProcessError` returns `false` for a genuine `ProcessError`** thrown by a different installed copy, and across this single tarball's own ESM/CJS boundary. Two copies already coexist in this repository's tree, and the 0.0.4 cascade deliberately widens that window across `mcp`, `scaffold`, `probe`, and `supervisor`.
- **Windows has no executed evidence.** Nine tests covering `PATHEXT` resolution, `cmd.exe` routing, percent-sign refusal, `killTree`, and grandchild tree-kill skip on Linux; that code ships in the tarball; and commit `b392629` changed the flooding fixtures on the strength of a difference in stdout blocking between the two platforms without re-running the platform it changed them for.

## 2. Capability/defect matrix

| # | Row | Seam | State | Severity | Closes when |
|---|---|---|---|---|---|
| Q1 | Backlog bound released without limit during termination | resources, concurrency under cancellation | REPAIR | blocks-release | `Process` caps retained bytes during termination at a stated multiple of `backlog` and drops beyond it without re-pausing the reader; `guides/process.md` and the `backlog` TSDoc state that cap as a number; and a test with `backlog: 1024` against a SIGTERM-trapping flooding child asserts drained bytes stay at or below it. |
| Q2 | Windows-only shipped code is never executed, and the POSIX repair commit is unverified there | platform | UNPROVEN | blocks-release | `npm run format:check`, `lint:check`, `check`, `build`, and `npm test` each run on a `win32` host and read by exit code, with `test:src` reporting 99 passed and 0 skipped, recorded in `.orkestrel/process/`. |
| Q3 | Command strings validated on one read and spawned from another | hostile input | REPAIR | blocks-release *(elevated from the lane's degrades-consumers)* | Each entry point snapshots `file`, `arguments`, `environment`, `input`, and `isolated` into locals once, validates the snapshot, and passes it to `buildSpawn`, `mergeEnvironment`, and `formatCommand`; a test using a getter that changes on the second read asserts a `ProcessError` coded `invalid` and that the spawned file equals the validated one. |
| Q4 | Cross-copy `isProcessError` fails on a real `ProcessError` | cross-instance identity of the published error contract | REPAIR | blocks-release for the 0.0.4 cascade *(elevated)* | `isProcessError` returns `true` for a `ProcessError` from a different installed copy and across the ESM/CJS boundary, and `false` for a plain `Error` and a shape-only lookalike — for example a `Symbol.for('@orkestrel/process.error')` own property set in the constructor — proven by a test loading two copies in one process with both controls. |
| Q5 | `destroy` leaves the caller's AbortSignal listener attached | lifecycle, handle retention | REPAIR | degrades-consumers | `#teardown` removes the abort listener as `#close` does, and a test asserts `getEventListeners(signal, 'abort').length === 0` after `destroy()` on a child whose `close` has not arrived. Measured: 1, 2, 3, 4, 5 across five instances. |
| Q6 | `waitForExit` retains an exit listener when its deadline wins | handle leak on a public composition helper | REPAIR | degrades-consumers | `waitForExit` removes its `exit` listener on the deadline path, and a test asserts `listenerCount('exit') === 0` after twelve deadline-expiring calls. Node printed `MaxListenersExceededWarning` during the probe. |
| Q7 | `runSync` timeout leaves descendants running | leaked children | REPAIR | degrades-consumers | `RunSyncOptions.timeout` TSDoc and the guide's termination section state that `runSync` ends the root alone, name `run` or `Process` as the tree-terminating path, and a test asserts a `runSync` timeout leaves a grandchild live while the same shape under `run` does not. |
| Q8 | `input` documented as NUL-refused and never validated | hostile input | REPAIR | degrades-consumers | Either `input` is validated on both `ProcessCommand` and `RunOptions` with a test proving the `invalid` refusal, or both remarks state that `input` is stdin payload carrying no NUL restriction, with the parity fence updated. |
| Q9 | `quoteArgument` `%1` claim is false | published prose contradicts behaviour | REPAIR | degrades-consumers | `guides/process.md:396` and `src/server/helpers.ts:252-253` state that `%` is in the quoted set, and `tests/guides.test.ts` asserts `quoteArgument('%1') === '"%1"'` beside the existing `a&b` row. |
| Q10 | `ProcessCommand.isolated` TSDoc omits the POSIX `PATH` constraint and misstates Windows | the option's own declaration | REPAIR | degrades-consumers | `src/core/types.ts:38` states both host qualifications — POSIX `isolated: true` leaves no `PATH`, so pass an absolute file or include `PATH`; Windows injects a host set regardless — and `ProcessCommand`'s `@remarks` carries the same. A consumer hovering the option in an editor reads the declaration, never the guide. |
| Q11 | A spawn fault's exit code is undocumented and the runners disagree | result contract | REPAIR | degrades-consumers | `ProcessExit.code` and the `RunResult` prose state that a spawn fault yields the host's negative errno on `Process` and `run` and `null` on `runSync`; the "Where the two runners differ" table gains that row; and `tests/guides.test.ts` transcribes both codes. |
| Q12 | A supervised child survives the supervisor's abrupt death | leaked children | IMPLEMENT | degrades-consumers | The guide and the `ProcessOptions` remarks state that POSIX detachment is what makes group termination possible, that a child therefore survives the parent's SIGKILL and does not receive the terminal's SIGINT, and that the consumer must call `stop` or `destroy` on shutdown; the parity test covers that statement. |
| Q13 | No proof runs against the built artifact | generated output gate | IMPLEMENT | degrades-consumers | `tests/distribution.test.ts` exists with the exact `test:distribution` script `tests/config.test.ts:412-419` already asserts, `prepublishOnly` includes it, and it packs, installs outside the repo, and asserts every `exports` target exists, both formats load for both entries, each entry's runtime export set equals its `.d.ts` value-declaration set (13 core, 29 server), and one real call per entry returns the documented value. |
| Q14 | `/server` subpath has no types under `moduleResolution: node10` | declaration alignment | IMPLEMENT | degrades-consumers | `README.md` § Requirements states the supported `moduleResolution` floor (`node16`, `nodenext`, or `bundler`) and the parity gate asserts that statement. Adding `typesVersions` is the alternative and is not recommended: the mode is deprecated in TypeScript 6 and removed in 7. |
| Q15 | The ESRCH fallback has no committed regression guard | proof of a same-day repair to a published helper | REPAIR | internal-quality | `tests/src/server/helpers.test.ts` carries a POSIX-gated test spawning a non-detached child, calling `killProcess(child, 'SIGKILL')`, asserting the observed exit, with the pre-repair swallow as its recorded control; `ProcessChild` `@remarks` names the direct fallback beside the process group. |
| Q16 | Termination table still describes the group-only POSIX sequence | guide prose stale after the repair | REPAIR | internal-quality | The POSIX table row names both routes — the process group, or the child directly when no group owns its pid. |
| Q17 | TSDoc `@example` satisfies the example gate without executing | documentation gate coverage | REPAIR | internal-quality | `tests/guides.test.ts` transcribes the value-bearing `@example` blocks of the twelve exports that appear in no guide fence, so a changed return value fails the gate. All sixteen claims are true today and none is bound. |
| Q18 | The guide's Tests section claims coverage that only runs on Windows | documentation honesty about proof | REPAIR | internal-quality | The Tests section states that the Windows resolution, batch-path, and tree-termination rows execute on Windows only, and names the host each half of the suite was last proven on. |
| Q19 | `README.md` ships to consumers under no gate | published documentation parity | IMPLEMENT | internal-quality | `README.md` joins `ROOT_FILES` in `tests/guides.test.ts` and gets the same two assertions `guides/process.md` gets: resolvable backticked APIs and existing relative links. Correct today, unbound tomorrow. |
| Q20 | Timeout and abort first-wins is never tested with both armed | concurrency ordering | IMPLEMENT | internal-quality | `helpers.test.ts` carries three cases with both armed — timeout first, abort first, same-tick — each asserting exactly one of `expired` and `aborted`. Behaviour is correct today under probe. |
| Q21 | Windows `stopChild` fallback and `killTree` cut-off are proven on neither host | platform, lifecycle | UNPROVEN | degrades-consumers | On a `win32` host, `npx vitest run --config vite.config.ts --no-cache --project src:server` passes with two added tests: `stopChild` over a live pid whose `killTree` reports false, asserting the direct `SIGKILL` fallback; and `killTree` against a tree whose `taskkill` outlives the `timeout`, asserting `false`. |
| Q22 | Proven seams: export parity in both directions (13 core, 29 server, zero phantoms, control fired); 18 of 19 guide fences typecheck against the shipped declarations; all eleven transcribed fences plus six untranscribed fences plus seven unfenced prose claims execute as documented; both entries in both formats under npm and pnpm with `skipLibCheck: false`; `exports`/`files`/declaration alignment across 15 shipped files; tarball hygiene with a reproducible shasum and no host path or secret; the Node 22.12.0 floor honest with a firing Node 20 control; no phantom runtime dependency; the 0.0.3→0.0.4 material dist diff that obliges the bump; both README fences run against the installed tarball; idempotent stop and destroy; manager reservation, eviction, and destroy races; stdin and spawn faults with no listener | multiple | RETAIN | internal-quality | Each is proven by hand and bound by nothing. Q13 is what converts them into standing coverage. |
| Q23 | Guides absent from the tarball; the two `TS2304` identifiers in the Observing fence | published contents, fence type truth | EXCLUDE | internal-quality | Excluded on evidence: `files: ["dist/src","README.md"]` is the fleet convention that `@orkestrel/contract@0.0.12` also follows, and `log` and `metrics` are named placeholders for a consumer's own logger and metrics sink. |

## 3. BLOCKERS, in close order

1. **Q4 — cross-copy `isProcessError`.** Close it *in* 0.0.4, not after. The defect is pre-existing in 0.0.3, but 0.0.4 is what opens the multi-version window across `mcp`, `scaffold`, `probe`, and `supervisor`, and across that window the guard silently returns `false` for failures this package itself threw. Publishing 0.0.4 without it spends an approval window to create the exact condition the defect needs. The mechanism owner `@orkestrel/contract@0.0.12` has the same defect and gets the same fix.
2. **Q3 — validate-then-respawn double read.** A spawn library that does not spawn the string it validated has no input contract, and the documented `ProcessError` coded `invalid` does not appear. Snapshot once in all four entry points.
3. **Q1 — unbounded teardown drain.** Cap it and state the cap as a number. The current documented bound is off by four orders of magnitude and no test measures the path.
4. **Q2 — Windows verification.** Either run the five gates on a `win32` host and record the result, or drop the Windows claims from the guide and the `engines`/support statement in the same change. Shipping documented Windows behaviour, Windows-only branches in the tarball, and a fixture commit reasoned from a platform difference it never re-ran on is not coverage.

Q13 follows immediately after, not because it is severe on its own — the artifact was executed by hand and passed — but because it is the only thing that keeps the Q22 block proven.

## 4. ACCEPTED LIMITS

- **Windows Job Objects are out of scope.** Stated at `guides/process.md:349-351` as a deliberate limit, not a gap.
- **One `limit` covers both streams.** Documented as a single flag with `truncated` meaning "either stream exceeded `limit`". Per-stream truncation is a different feature, not a defect in this one.
- **`lines` has one consumer and no fan-out.** Stated twice in the guide. A consumer needing fan-out composes it.
- **`guides/process.md` is not in the tarball, and `README.md` links it relatively.** Fleet convention; npm renders the README against the declared `repository` field. This becomes a defect only if the link must resolve from `node_modules`, and the fix then is an absolute URL, not a `files` change.
- **`engines` is advisory.** A Node 20 install succeeds and fails at the first `run` call with `TypeError: Promise.withResolvers is not a function`. That is npm's behaviour without `engine-strict`, and the floor is declared honestly and verified against the real binaries.
- **`resolveExecutable` returns `undefined` on POSIX.** The documented contract at `src/server/helpers.ts:210-211`: a POSIX host resolves the file itself.
- **Sourcemaps ship with full `sourcesContent`** (167 kB of 407 kB) with relative sources, no `sourceRoot`, and no absolute path. Same fleet posture as `@orkestrel/contract`.

## 5. UNPROVEN

| Seam | Command that settles it |
|---|---|
| Windows `stopChild` direct-`SIGKILL` fallback when `killTree` reports false, and `killTree`'s `timeout` cut-off | On `win32`: `npx vitest run --config vite.config.ts --no-cache --project src:server` with a test driving `stopChild` over a live pid whose `killTree` reports false, and a test driving `killTree` against a tree whose `taskkill` outlives the `timeout`. Both branches are unreachable from POSIX because `process.platform` is read inline at `helpers.ts:527` and `:628` rather than injected. |
| Windows re-verification of commit `b392629` — the `killProcess` ESRCH fallback, and the fixture change removing `process.exit(0)` from the `chatty` and `empty` children | On `win32`: `npm run format:check`, `npm run lint:check`, `npm run check`, `npm run build`, `npm test`, each read by direct exit code, with `test:src` reporting 99 passed and 0 skipped. The commit message itself records that Node makes a child's stdout blocking on Windows and non-blocking on Linux, which is exactly what the removed `process.exit(0)` interacted with. |

---

# 6. CONFLICTS

**C1. The `probe` MCP server advertises two different protocol versions.** The contract lane drove `dist/bin/main.js` from the repository workspace and got `"protocolVersion":"2025-11-25"`. The consumption lane drove `node_modules/.bin/probe` from an installed tarball and got `"protocolVersion":"2025-06-18"`. Both used a real JSON-RPC client and both read the value off the wire, so neither is wrong. **The consumption reading is the one that matters** because it is what a consumer's client negotiates against, and the disagreement is itself the finding: the advertised protocol version is whatever `@orkestrel/mcp` resolves to at install time, `probe` never asserts it, and no gate observes it. Add the `initialize` response to the distribution test (P10) with the version pinned.

**C2. The extent of the CommonJS breakage.** The lifecycle lane reports "`Overlay` alone survives"; the consumption lane executed `new LintStage(cwd).inspect(subject)` under CJS and got `{"stage":"lint","elapsed":70,"findings":[]}`. **The consumption evidence is stronger** — it ran the inspection and printed a result, where the lifecycle reading generalized from two crashing constructors. The correction narrows the defect to `TypeStage` and `RuntimeStage` and does not change P3's severity.

**C3. `probe`'s type stage: healthy or dead.** The contract lane RETAINs "every barrelled class is constructible and drivable" and "dual-mode type resolution for a real consumer", with `new TypeStage(ws).inspect` returning a clean check. The consumption lane reports the same call throwing `TypeError: Cannot read properties of undefined (reading 'readFile')`. Not a contradiction of fact: the contract lane linked the package into a workspace carrying the repository's own `typescript@^6.0.3` devDependency, and the consumption lane installed into an empty directory where npm resolved `typescript@7.0.2`. **The consumption condition governs the publish decision** because a first-time consumer gets TypeScript 7 by default. The contract lane's RETAIN rows are true and are conditional on a TypeScript 6 workspace that nothing in the package requires.

**C4. `moduleResolution: node10` — EXCLUDE or defect.** The `probe` consumption lane EXCLUDEs it: TypeScript 6 emits `TS5107` deprecating the mode and TypeScript 7 removes it. The `process` consumption lane files the same seam as an IMPLEMENT row because the `/server` subpath fails there while the root entry resolves. **The `probe` reasoning is stronger about the mode's future**, and the `process` close condition's second branch is right either way. Ruling for both packages: state the supported `moduleResolution` floor in the README and gate that statement. Do not add `typesVersions` to either.

**C5. Severity of unexecuted Windows code in `process`.** The lifecycle lane grades the unverified Windows surface blocks-release; the consumption lane grades the same surface degrades-consumers. **Ruling: blocks-release.** The tarball contains the `cmd.exe /d /s /c` and `taskkill` branches, the guide documents Windows behaviour as covered, and the last commit changed the fixtures those tests depend on on the strength of a platform difference it did not re-measure. A supported platform with zero executed evidence after a change reasoned from that platform's own behaviour is an unproven seam, not a known limit.

**C6. `HANDOFF.md` versus the measurement on the `process` teardown drain.** The record states the overshoot bound as "one delivered stream chunk plus one line". The probe measured 29,721,480 drained bytes and 45 MB of heap growth in one `stop()`. **The measurement wins**, and the written bound is itself a defect: it is the kind of stale claim a later campaign reads as current.

**C7. Two lanes disagree with themselves about what "no receipt" means for `probe`.** The contract lane found that repairing the known byte-identical `control` defect still yields `no receipt`, so P13 does not close P9. Recorded here so the two are not treated as one fix.

---

# 7. WHAT THE GATES DO NOT SEE

Every defect in both packages passed `format:check`, `lint:check`, `check`, `build`, and `npm test`. These are the specific holes.

## Neither package runs a gate against the artifact a consumer receives

`prepublishOnly` runs the same suite the developer runs, resolved through `@src` aliases. `tests/guides.test.ts:38,49` in `process` imports from `@src/core` and `@src/server`, so guide parity is measured against source that never went through the bundler. `probe` has no guide gate at all. The consequence is not abstract:

- `probe`'s **CommonJS `{}.resolve` crash** is an emit artifact. The source says `import.meta.resolve`, which typechecks; the bundler rewrites it; the build *prints the warning naming both lines* — `[EMPTY_IMPORT_META]` at `RuntimeStage.ts:150` and `TypeStage.ts:121` — and exits 0 with no `onwarn` handler. Then the failure is swallowed at construction by `void this.#typescript.catch(() => {})` and surfaces at the first `prove` as a bare `TypeError`.
- `probe`'s **npm 10 install crash** and **TypeScript 7 resolution** are both install-time. The gate runs inside a tree npm already built with a pinned `typescript@^6.0.3`. Nothing in the gate ever performs the install a consumer performs.
- `process` ships 15 files no automated check loads, while `tests/config.test.ts:114` and `:412-419` already reserve the `distribution` project label and assert the exact script string it would need. The slot is pre-wired and empty.

## A skipped test reads as coverage in the prose

`process` runs 90 passed and 9 skipped on Linux. `guides/process.md:875-878` describes those nine — `PATHEXT` resolution, extension-bearing names, workspace-before-PATH, `cmd.exe` routing, two percent-sign refusals, spaced batch directories, `killTree` on an unowned pid, grandchild tree-kill — as covered by the test file. A reader who runs the suite on Linux is told those behaviours are proven and gets nothing. Two of them (`stopChild`'s fallback, `killTree`'s deadline) have never executed on any host, because the only two `stopChild` tests pass structural stubs and one uses `pid: undefined` so it skips `killTree` even on Windows.

## The parity gate binds fence values, and false claims live in prose

`test:guides` passes 51/51 over `guides/process.md:396`, which states that "a batch script still receives `%1` without added quotes" while `quoteArgument("%1")` returns `"\"%1\""`. `%1` appears only in prose, never as a fence value. Same mechanism at `guides/process.md:345`, where the POSIX termination table row still describes the group-only sequence the repair replaced, with the correcting paragraph eight lines below the row a reader scans. And `tests/guides.test.ts:265` lets a TSDoc `@example` alone discharge the example requirement, so twelve exports — `trimHead`, `trimTail`, `retainChunk`, `resolveExecutable`, `isFile`, `readVariable`, and the six `validate*` functions — satisfy the gate without anything executing them.

## Published surface that is in no gate's file inventory

`process` ships `README.md` in `files`, and `tests/guides.test.ts:88-92` builds its inventory from `src`, `guides`, `tests`, plus `ROOT_FILES = ['AGENTS.md']`. The README gets no backticked-API check, no link check, no fence-import check. It is correct today by hand inspection and unbound tomorrow.

`probe` ships a 98-byte README whose whole body is "The @orkestrel/probe package." plus two npm commands, and a `package.json` carrying `{"description":"The @orkestrel/probe package.","keywords":[]}` as its registry listing. The package installs a `probe` binary on PATH and an MCP stdio server, neither mentioned anywhere a consumer can read. `guides/README.md` prints "Not created. Create this file when the workspace has a public surface: `guides/probe.md`" three times while the workspace has one, and no gate reads that file.

## TSDoc that does not compile, shipped in the declarations

One of `probe`'s 48 `@example` blocks fails to compile against the package's own `strict` settings — both `formatFinding` calls omit the required `origin` — and it ships inside `dist/src/core/index.d.ts`, where a consumer's editor renders it as the usage guidance. Nothing compiles or executes an `@example` in either package's gate chain.

## A test that actively conceals the defect it covers

`probe`'s own suite hedges the teardown hang: `tests/src/server/Probe.test.ts:356` wraps the call as `Promise.race([probe.destroy(), waitForDelay(5_000)])`. The suite passes because it declines to wait for `destroy()` to settle. The published `StageInterface.destroy` documents that it "settles after the resident tool releases its resources", and against a language server that answers `shutdown` and ignores `exit` it never does. This is the single clearest example of a green gate hiding a blocks-release defect, and the fix must delete the race in the same change.

## Defects whose damage lands in the consumer's repository, not in ours

`probe`'s `RuntimeStage` writes `*.probe-*` specification files as siblings of the target test directory, and nothing sweeps them at boot. `src/bin/main.ts` is three lines with no `SIGINT` or `SIGTERM` handler — `grep -rn "process.on\|SIGINT\|SIGTERM\|beforeExit\|unref" src/` returns nothing — so the way an MCP client stops a stdio server leaves them behind. One orphan then fails the *target workspace's* `format:check` and `lint:check`, and it is a `.ts` file under `tests/` so the root `tsc` project compiles it too. Our gates run against a tree nobody signalled, so they never see it.

Also in this class: `probe`'s false type findings from the declared-versus-resolved path spelling carry `origin: 'code'`, the origin `computeReceipt` counts, so an instrument defect is reported to the consumer as a defect in the consumer's source. Same shape as the `Case.files` failure, which surfaces as `Cannot find module '../../../src/core/greeting.js'` with `origin: 'code'` when the true cause is that the runtime stage serves no candidates.

## Behaviours no test asks about at all

- **Receipt provenance.** No test proves that two projects over one claim produce different receipts, because the receipt does not record the project. An honest receipt and one minted under a caller-supplied `strict: false` config are byte-shaped identical, and nothing downstream can separate them.
- **Recovery after an expiry.** `probe`'s suite covers "destroys idempotently" for all three stages and never covers "serves a claim after an expiry", so the missing `#recycle` for two of three stages passes cleanly. Likewise a boot failure: the suite records that a boot timeout "carries the identical message a stage timeout carries" as an observation rather than a defect, and the shipped server answers every later tool call with that stale message in 0 ms.
- **Listener counts and retained bytes.** Nothing in `process` counts listeners after `destroy()` or after a `waitForExit` deadline. Node's own `MaxListenersExceededWarning` fired during the probe and would never fire inside the suite. Nothing measures drained bytes during `stop()`.
- **Descendant liveness after a `runSync` timeout.** The guide's termination table presents tree termination without exempting `runSync`, and no test reads a grandchild's `/proc` state.
- **A getter that answers twice.** Nothing in `process` passes a mutating object into `run`, `runSync`, `detach`, or `Process`, so the split between the validated read and the spawned read has never been questioned.
- **Two copies in one process.** Every `process` test loads exactly one copy. The two-copy state exists in this repository's own tree right now: `npm ls @orkestrel/process --all` reports `0.0.4` at the root and `scaffold@0.0.44 -> process@0.0.3` nested.

---

# Lane reports

ROW: CommonJS server entry — TypeStage and RuntimeStage
SEAM: package consumption / generated output
STATE: REPAIR (known; confirmed and extent established)
EVIDENCE: `grep -on "{}\.[a-zA-Z]*" dist/src/server/index.cjs dist/src/core/index.cjs` → exactly two sites, `index.cjs:681` and `index.cjs:1061`; core CJS has zero. Driven from an installed tarball in `/tmp/c_ts6` (npm 11, typescript 6.0.3): `require('@orkestrel/probe/server')` then `createProbe().prove(claim)` → `CJS FAIL: TypeError | {}.resolve is not a function`. Extent, all executed against the installed package: module load succeeds in both systems (ESM 19 keys, CJS 19 keys, identical); `new LintStage(cwd).inspect(subject)` under CJS returns `{"stage":"lint","elapsed":70,"findings":[]}`; `new TypeStage(...)`/`new RuntimeStage(...)` under CJS both throw the same TypeError; core CJS is fully functional (22 exports, `formatCheck` returns `type: 0 findings (1 ms)`). The failure is never at load — it is swallowed at construction by `void this.#typescript.catch(() => {})` (src/server/stages/TypeStage.ts:60) and surfaces only at the first `prove`.
CLOSES WHEN: `require('@orkestrel/probe/server')` from an installed tarball, calling `createProbe({workspace}).prove(claim)` against a workspace with typescript 6 and a `probe` Vitest project, returns a verdict rather than throwing; and `grep -c "{}\." dist/src/server/index.cjs` reports 0.
SEVERITY: blocks-release

ROW: npm 10 cannot install the package at all
SEAM: package consumption
STATE: IMPLEMENT
EVIDENCE: `npm install /workspace/probe/tmp/probe/orkestrel-probe-0.0.1.tgz` under npm 10.9.7 (the npm bundled with Node 22.22.2) → `npm error Cannot read properties of null (reading 'edgesOut')`, exit 1, stack at `arborist/build-ideal-tree.js:1289 #loadPeerSet`. Reproduces with a clean cache (`--cache /tmp/npmcache_clean`). Controls: `npm install "vitest@>=4.1.0"` alone under the same npm → exit 0; `npm install <tarball> --legacy-peer-deps` → exit 0, 14 packages; `npx npm@11 install <tarball>` → exit 0. Isolated with a synthetic package carrying only probe's `peerDependencies` and no code: three-peer set crashes; each peer alone passes; pairs `typescript+vitest` and `oxlint+typescript` pass; pair `oxlint+vitest` crashes. Caret-bounding alone does not fix it (`{"oxlint":"^1.77.0","typescript":"^6.0.0","vitest":"^4.1.0"}` still crashes npm 10). Adding `peerDependenciesMeta` optional for all three fixes it: verified npm 10 exit 0 and npm 11 exit 0 on the same synthetic manifest. The package's own `engines` is `>=22.12.0`, so it advertises support for exactly the Node line whose bundled npm cannot install it.
CLOSES WHEN: `npm install <tarball>` exits 0 under npm 10.9.7 in an empty directory. Verified path: add `peerDependenciesMeta` marking `oxlint`, `typescript`, and `vitest` optional (correct on its own terms — the code resolves all three from the *target workspace* through `resolveWorkspaceModule`, never from probe's own tree, src/server/helpers.ts:44).
SEVERITY: blocks-release

ROW: typescript peer range admits TypeScript 7, which has no compiler API
SEAM: package consumption / supported runtime targets
STATE: REPAIR
EVIDENCE: `peerDependencies.typescript` is `">=6.0.0"`; `npm view typescript version` → `7.0.2`. A fresh `npx npm@11 install <tarball>` in an empty directory resolved and installed typescript@7.0.2 automatically. TypeScript 7's manifest exports `"." : "./lib/version.cjs"` only — `node --input-type=module -e "const ns = await import('typescript'); ..."` prints `sys: undefined, readConfigFile: undefined, default.sys: undefined`; under 6.0.3 the same probe prints `sys: object, readConfigFile: function`. Single-variable control: `/tmp/c_ts6` (typescript 6.0.3) → `ESM OK ... checks=[{"stage":"type",...}]`, a real verdict; `cp -r` of that identical workspace with only `npm install typescript@7.0.2` applied → `ESM FAIL: TypeError | Cannot read properties of undefined (reading 'readFile')`, from `typescript.sys.readFile` at src/server/stages/TypeStage.ts:194. The installation guard at TypeStage.ts:148 compares resolved paths only, so it passes under TS 7 and does not name the fault. The repo's own devDependency is `^6.0.3`, so no local gate ever sees TS 7. `vitest` (`>=4.1.0`) and `oxlint` (`>=1.77.0`) are unbounded the same way; no newer major exists today (`npm view vitest versions` majors 0–4, `oxlint` 0–1), so neither is presently broken.
CLOSES WHEN: `peerDependencies` reads `"typescript": "^6.0.0"`, `"vitest": "^4.1.0"`, `"oxlint": "^1.77.0"`; and a workspace whose installed TypeScript major is outside that range makes `prove` reject with a named error stating the supported range, not a `TypeError`. The version is already read at construction (`this.#version('typescript')`, src/server/Probe.ts:72), so the guard needs no new resolution.
SEVERITY: blocks-release

ROW: ESM entries, end to end from the tarball
SEAM: package consumption
STATE: RETAIN
EVIDENCE: `npm pack` → `orkestrel-probe-0.0.1.tgz`, installed into `/tmp/c_ts6` outside the repo. `import('@orkestrel/probe')` → 22 exports; `import('@orkestrel/probe/server')` → 19 exports. `createProbe({workspace: cwd}).prove(claim)` against a workspace with tsconfig.json, a `probe` Vitest project, and typescript 6.0.3 returned a full verdict: `checks=[{"stage":"type","elapsed":36,"findings":[]},{"stage":"lint",...},{"stage":"runtime",...}]`. Both `#warm` installation guards passed in the real installed layout.
CLOSES WHEN: already closed; kept closed by the distribution test named in the row below.
SEVERITY: internal-quality

ROW: Published bin driven by a foreign MCP client
SEAM: package consumption / integration
STATE: RETAIN
EVIDENCE: `node_modules/.bin/probe` links to `../@orkestrel/probe/dist/bin/main.js`, mode `-rwxr-xr-x`, shebang `#!/usr/bin/env node` present. A separate Node process spawned it and spoke newline-delimited JSON-RPC over stdio: `initialize` → `{"result":{"capabilities":{"tools":{}},"protocolVersion":"2025-06-18","serverInfo":{"name":"probe","version":"0.0.1"}}}`; `tools/list` → the `prove` tool with its compiled input schema; `tools/call prove` → a formatted verdict including `toolchain typescript 6.0.3, oxlint 1.79.0, vitest 4.1.10` and `control type: 1 finding (24 ms) src/sum.ts:1 Type 'number' is not assignable to type 'string'.` The version in `serverInfo` proves the manifest version is inlined at build (`//#region package.json` in dist), so no runtime JSON import ships.
CLOSES WHEN: already closed.
SEVERITY: internal-quality

ROW: Declarations resolve and typecheck in both module systems
SEAM: generated output
STATE: RETAIN
EVIDENCE: consumer at `/tmp/c_types` with typescript 6.0.3 and the tarball installed. `tsc` with `module/moduleResolution: nodenext`, `skipLibCheck: false`, over an ESM `.ts` and a CJS `.cts` both importing `@orkestrel/probe` and `@orkestrel/probe/server` → exit 0, no diagnostics. Negative control: appending `export const bad: number = createProbe({workspace:'.'})` → `esm/a.ts(7,14): error TS2322 ... exit 2`, so the instrument fails when it should. `moduleResolution: bundler` → exit 0. The `.d.cts` files are byte copies of the `.d.ts` and resolve correctly under the require condition, including the self-referential `@orkestrel/probe` import that `configs/src/vite.server.config.ts` rewrites into the server declaration.
CLOSES WHEN: already closed.
SEVERITY: internal-quality

ROW: Manifest, files, and tarball contents alignment
SEAM: package consumption
STATE: RETAIN
EVIDENCE: `npm pack` reports 17 files, 127.7 kB. Extracted tarball checked programmatically: every `./`-prefixed target in `exports`, `main`, `module`, and `bin` exists in the tarball (`missing targets: NONE`); no file outside `dist/`, `README.md`, `LICENSE`, `package.json`. `grep -rlE "/workspace/|/home/|AKIA|BEGIN .*PRIVATE KEY|npm_[A-Za-z0-9]{20}|CURSOR_API_KEY" package/` → no matches. All bare specifiers in the built output (`@orkestrel/contract`, `emitter`, `mcp`, `mcp/server`, `queue`, `timeout`, `tool`, plus `node:` builtins) are declared runtime dependencies; `typescript` and `vitest/node` remain dynamic `import()` in both formats and resolve from the target workspace.
CLOSES WHEN: already closed.
SEVERITY: internal-quality

ROW: Published sourcemaps
SEAM: generated output
STATE: RETAIN
EVIDENCE: maps name unpublished sources (`../../../src/server/helpers.ts`), but every map carries complete `sourcesContent` with zero nulls (server ESM 8/8, core 4/4, bin 1/1, server CJS 8/8), so they resolve standalone in a consumer's debugger. No absolute build paths appear in any map.
CLOSES WHEN: already closed. Note this publishes full TypeScript source text inside the maps; that is a disclosure choice, not a defect.
SEVERITY: internal-quality

ROW: Dual-package hazard
SEAM: package consumption
STATE: RETAIN
EVIDENCE: loading core through both graphs in one process — `import * as esm from '@orkestrel/probe'` plus `createRequire(...)('@orkestrel/probe')` — gives `same object: false` and `PROBE_STAGES same ref: false`, as expected, but `esm.isClaim(value)` and `cjs.isClaim(value)` both return `true` on the same value. `grep -n "instanceof\|Symbol("` over `src/core/*.ts` returns nothing; the only `instanceof` in the package is `value instanceof Error` (src/server/helpers.ts:186). No branded identity crosses the two graphs.
CLOSES WHEN: already closed.
SEVERITY: internal-quality

ROW: engines versus the installed dependency graph
SEAM: package consumption / supported runtime targets
STATE: RETAIN
EVIDENCE: enumerating `engines.node` across the installed consumer tree: every `@orkestrel/*` package declares `>=22.12.0`; the strictest transitive constraints are `vite@8.2.1` and `oxlint@1.79.0` at `^20.19.0 || >=22.12.0`. Built output uses no syntax later than optional chaining on a regex result (`dist/src/server/index.js:161`); node builtins used are `crypto`, `fs`, `module`, `path`, `stream`, `url`, `child_process`. One inconsistency, non-blocking: probe's `>=22.12.0` admits Node 23, which `vitest@4.1.10`'s `^20.0.0 || ^22.0.0 || >=24.0.0` excludes.
CLOSES WHEN: already closed for the declared floor. The Node 23 gap closes when `engines.node` reads `^22.12.0 || >=24.0.0`, matching the strictest peer.
SEVERITY: internal-quality

ROW: node10 resolution and the absent top-level types field
SEAM: package consumption
STATE: EXCLUDE
EVIDENCE: `package.json` has `main` and `module` but no top-level `types`; the subpath `./server` has no `typesVersions` fallback. Attempting the check: `tsc` with `moduleResolution: node` under typescript 6.0.3 → `error TS5107: Option 'moduleResolution=node10' is deprecated and will stop functioning in TypeScript 7.0`. The resolution mode this row protects is removed from the toolchain the package peers on.
CLOSES WHEN: excluded — no supported consumer configuration reaches it. Re-open only if a consumer class pinned below TypeScript 6 is added to the support statement.
SEVERITY: internal-quality

ROW: No gate holds the published artifact
SEAM: package consumption / "stays proven"
STATE: IMPLEMENT
EVIDENCE: `npm run build` prints two `[EMPTY_IMPORT_META]` warnings naming `src/server/stages/RuntimeStage.ts:150` and `src/server/stages/TypeStage.ts:121`, then exits 0 (`BUILD_EXIT=0`). `prepublishOnly` is `format:check → lint:check → check → build → test`; nothing in it installs a tarball or requires a published entry. `find tests -name 'distribution*'` → nothing, confirming the known item. The vendored config test already anticipates the project: `tests/config.test.ts:406` branches on `registered.has('distribution')` and asserts the matching `test:distribution` script, and probe registers no such project (`vite.config.ts:195` lists `srcCore, srcServer, srcBin, policy, config, probe`). Every defect in this report was invisible to the current gates and reachable in under a minute from a packed tarball.
CLOSES WHEN: a `distribution` Vitest project and `tests/distribution.test.ts` exist, registered in `vite.config.ts` with the `test:distribution` script the config test requires, that packs the tarball, installs it into a temporary directory outside the repo, and asserts: every `exports` entry loads under both `import` and `require`; `createProbe(...).prove(claim)` returns a verdict under both conditions; and `dist/src/server/index.cjs` contains no `{}.` artifact. The build additionally fails on `EMPTY_IMPORT_META` through an `onwarn` handler in `configs/src/vite.server.config.ts`.
SEVERITY: blocks-release

ROW: Consumption prerequisites are undocumented
SEAM: documentation of the consumed surface
STATE: IMPLEMENT
EVIDENCE: confirming the known "no guides/probe.md" item, and adding the concrete prerequisites discovered by executing against a clean workspace. In order, each surfaced only as a runtime failure: the target workspace must register a Vitest project literally named `probe` (`ESM FAIL: Error | The probe boot control did not begin clean ... The runtime stage found no configured Vitest project named probe`); that project must include `tmp/probe/**/*.test.ts`; the workspace `tsconfig.json` must resolve at least one input (`No inputs were found in config file`); the workspace's own `typescript`, `oxlint`, and `vitest` installations must be the same resolved files probe itself resolves, or `#warm` throws `The type stage does not share the workspace TypeScript installation`. The published `README.md` is 98 bytes and says only `npm install` and `npm test`.
CLOSES WHEN: `guides/probe.md` states each of those four prerequisites, `README.md` links it, and `tests/guides.test.ts` enforces parity between the guide and the public exports.
SEVERITY: degrades-consumers

BLOCKERS: npm 10 cannot install the package at all (`edgesOut` crash from the three-peer set); the `typescript: ">=6.0.0"` peer range installs TypeScript 7 by default and the type stage dies on it with an unnamed `TypeError`; the CommonJS server entry's TypeStage and RuntimeStage crash on `{}.resolve`; and no gate holds the published artifact, which is why all three shipped.

---

Probes are deleted (`tmp/probe/` removed), no stray children remain, `git status` is clean, and the full gate suite is green on this host: `npm run test:src` → 90 passed | 9 skipped (99), `test:policy` 86, `test:config` 28, `test:guides` 51.

Known-item confirmations, one line each: Windows Job Objects, single-flag truncation, and single-consumer `lines` are all still stated as accepted limits in `guides/process.md` and `HANDOFF.md`; there is no `tests/distribution.test.ts` (`ls tests/` shows only `config`, `guides`, `policy`, `setup*`, `src/`); and commit `b392629` repaired the seven POSIX failures with gate evidence taken on Linux alone, so every changed test and fixture is Windows-unverified.

ROW: Backlog bound released without limit during termination
SEAM: resources / concurrency under cancellation
STATE: REPAIR
EVIDENCE: `src/server/Process.ts:243-247` (`#restrain` returns early once `#terminating`) and `:316-321` (`#kill` sets `#terminating` then `#relieve()`). Probe: a child that traps SIGTERM and floods stdout, `backlog: 1024`, `grace: 1500`, one attached iterator that stops draining, then `stop()`. Output: `drained_lines=147869 drained_bytes=29721480`, `heap_before_stop=6352984 heap_after_stop=51403728 delta=45050744`. The queue passed the 1 KiB mark by 29,000× and the parent heap grew 45 MB inside one `stop()`. `guides/process.md:278-281` says only "the teardown drain can pass the mark again" with no magnitude; `HANDOFF.md` item 3 states the overshoot bound as "one delivered stream chunk plus one line", which this falsifies. No test measures the teardown drain.
CLOSES WHEN: `Process` caps retained bytes during termination at a stated multiple of `backlog` and drops beyond it without re-pausing the reader, `guides/process.md` and the `backlog` TSDoc state that cap as a number, and a test with `backlog: 1024` against a SIGTERM-trapping flooding child asserts drained bytes stay at or below the stated cap.
SEVERITY: blocks-release

ROW: destroy leaves the caller's AbortSignal listener attached
SEAM: lifecycle / resources (handle and object retention)
STATE: REPAIR
EVIDENCE: `src/server/Process.ts:136-138` adds `this.#abort = this.#terminate.bind(this)` to `options.signal`; `:301-303` removes it only inside `#close`; `#teardown` (`:324-327`) never removes it. Probe: five `Process` instances over the `orphan` fixture sharing one `AbortController`, each `destroy()`ed while a descendant still holds stdio (the case `types.ts:171-175` documents as expected). `getEventListeners(controller.signal, 'abort').length` after each destroy: `1, 2, 3, 4, 5`. Each retained listener is a bound method holding the whole `Process`, its line queue, and its stderr tail.
CLOSES WHEN: `#teardown` removes the abort listener as `#close` does, and a test asserting `getEventListeners(signal, 'abort').length === 0` after `destroy()` on a child whose `close` has not arrived passes.
SEVERITY: degrades-consumers

ROW: Command strings are validated on one read and spawned from another
SEAM: hostile input / validation of every spawn-bound string
STATE: REPAIR
EVIDENCE: `validateCommand(command)` and `buildSpawn(command, …)` each read the caller's object independently — `helpers.ts:721`/`:739` (`run`), `:866`/`:882` (`runSync`), `:932`/`:936` (`detach`), `Process.ts:102`/`:117`. `formatCommand` at `:732`/`:875` is a third read. Probe with `{ get file() { return read === 1 ? execPath : execPath + '\0evil' } }` and the same for `arguments` and `environment`: all three reported `reads > 1` and the thrown error's `name` was `TypeError` (host `ERR_INVALID_ARG_VALUE`), not the `ProcessError` that `ProcessCommand`'s `@remarks` and every `@throws` tag promise. The same split lets a validated `node` be substituted for a different executable at spawn time.
CLOSES WHEN: each entry point snapshots `file`, `arguments`, `environment`, `input`, and `isolated` into locals once, validates the snapshot, and passes the snapshot to `buildSpawn`, `mergeEnvironment`, and `formatCommand`; a test using a getter that changes its answer on the second read asserts a `ProcessError` coded `invalid` and that the spawned file equals the validated one.
SEVERITY: degrades-consumers

ROW: input is documented as refused for NUL and is never validated
SEAM: hostile input
STATE: REPAIR
EVIDENCE: `src/core/types.ts:32-34` — "Every string here is spawn-bound: an empty `file`, or a NUL character anywhere, is refused with a {@link ProcessError} coded `invalid`" — covers `ProcessCommand.input`. `validateCommand` (`helpers.ts:423-427`) validates `file`, each argument, and `environment` only. Probe: `run({ file, arguments, input: 'a\0b' }, { strict: false })` resolved with `failed=false`. `RunOptions.input` is likewise unvalidated.
CLOSES WHEN: either `input` is validated with `validateText(value, 'command input', false)` on both `ProcessCommand` and `RunOptions` and a test proves the `invalid` refusal, or the `ProcessCommand` and `RunOptions` remarks state that `input` is stdin payload rather than a spawn-bound string and carries no NUL restriction, with the guides parity fence updated to match.
SEVERITY: degrades-consumers

ROW: waitForExit retains an exit listener when its deadline wins
SEAM: resources (handle leak) on a public composition helper
STATE: REPAIR
EVIDENCE: `helpers.ts:589-604` — the `child.once('exit', …)` registration is never removed when `setTimeout(settled.resolve, timeout)` fires first. Probe: twelve `await waitForExit(child, 1)` calls against one live child left `child.listenerCount('exit') === 12` and Node printed `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 exit listeners added to [ChildProcess]`. `HANDOFF.md` item 6 states `waitForExit` is exported so a consumer can compose a custom bounded stop, which is exactly the polling shape that reaches this.
CLOSES WHEN: `waitForExit` removes its `exit` listener on the deadline path (`child.off`, or a single listener cleared in both branches), and a test asserting `listenerCount('exit') === 0` after twelve deadline-expiring calls passes.
SEVERITY: degrades-consumers

ROW: runSync timeout leaves descendants running
SEAM: lifecycle / leaked children
STATE: REPAIR
EVIDENCE: Probe over a child that spawns one grandchild, liveness read from `/proc/<pid>/stat` state with controls (`control_live=alive`, `control_gone=gone`; `process.kill(pid, 0)` was rejected as an instrument because it reports a zombie as alive). Result: `run_timeout_grandchild=zombie` (the async runner's group kill reached it) but `runSync_timeout_grandchild=alive`. `helpers.ts:882-895` passes `timeout` to `spawnSync` without `detached`, so the host kills only the root. `RunSyncOptions.timeout` (`types.ts`) says "Milliseconds before the host kills the child", and the guide's termination table (`guides/process.md:342-343`) presents tree termination without exempting `runSync`.
CLOSES WHEN: `RunSyncOptions.timeout` TSDoc and the guide's termination section state that `runSync` ends the root process alone and leaves descendants running, name `run` or `Process` as the tree-terminating path, and a test asserts a `runSync` timeout leaves a grandchild live while the same shape under `run` does not.
SEVERITY: degrades-consumers

ROW: A supervised child survives the supervisor's abrupt death
SEAM: lifecycle / leaked children
STATE: IMPLEMENT
EVIDENCE: `Process.ts:118-125` spawns with `detached: process.platform !== 'win32'`, so the child leads its own group. Probe: a parent holding one `createProcess` child, killed with SIGKILL — `ps` showed the child at pid 25821 with pgid 25821 (its own group); after the parent died, `parent=gone supervised_child=alive`. `guides/process.md` has no occurrence of `SIGINT`, "orphan", or a statement about parent death; grep of the guide for those terms returns nothing outside the `detach` rows.
CLOSES WHEN: `guides/process.md` and the `ProcessOptions` remarks state that POSIX detachment is what makes group termination possible and that a child therefore survives the parent's SIGKILL and does not receive the terminal's SIGINT, naming the consumer obligation (an explicit `stop`/`destroy` on shutdown), and the guides parity test covers that statement.
SEVERITY: degrades-consumers

ROW: Timeout and abort first-wins is never tested with both armed
SEAM: concurrency (first-wins ordering)
STATE: IMPLEMENT
EVIDENCE: `helpers.test.ts:654` arms `timeout` with no `signal`; `:666` arms `signal` with no `timeout`. No test arms both, so `RunResult`'s claim that "only the first of them observed is recorded" (`types.ts`) has no falsifying case. Probe confirms the behaviour is correct today: timeout at 120 ms with an abort at 300 ms gave `expired=true aborted=false`; timeout at 3000 ms with an abort at 120 ms gave `expired=false aborted=true elapsed=123`; both scheduled at 100 ms gave `expired=true aborted=false`.
CLOSES WHEN: `helpers.test.ts` carries three cases with both `timeout` and `signal` armed — timeout first, abort first, and same-tick — each asserting exactly one of `expired` and `aborted`.
SEVERITY: internal-quality

ROW: Platform coverage enumeration
SEAM: platform
STATE: RETAIN
EVIDENCE: 14 conditionally skipped tests; on this Linux host `npm run test:src` reports 90 passed | 9 skipped (99). Proven on THIS host (the five POSIX-gated, all of which ran here today, four of them for the first time anywhere): `Process.test.ts:226` SIGKILL escalation past a trapped SIGTERM; `:317` grandchild killed through the process group; `helpers.test.ts:170` POSIX resolver passthrough; `:223` batch-named target spawned directly with a literal percent sign; `:613` `killProcess` ESRCH fallback to the direct child. Proven only on WINDOWS (the nine skipped here): `helpers.test.ts:107` PATH/PATHEXT resolution, `:133` extension-bearing name tried literally first, `:157` workspace searched before PATH, `:186` batch routed through a quoted `cmd.exe` line, `:207` and `:249` percent-sign refusals for a batch target, `:273` batch script under a spaced directory, `:451` `killTree` failure for an unowned pid, `Process.test.ts:290` grandchild killed through the tree.
CLOSES WHEN: no action; this row is the enumeration the two rows that follow depend on.
SEVERITY: internal-quality

ROW: Windows stopChild fallback and killTree cut-off are proven on NEITHER host
SEAM: platform / lifecycle
STATE: UNPROVEN
EVIDENCE: `helpers.ts:630-631` — `const killed = child.pid === undefined ? false : await killTree(child.pid, confirm); if (!killed && !isExited(child)) killProcess(child, 'SIGKILL')`. The only two `stopChild` unit tests (`helpers.test.ts:409`, `:428`) pass structural stubs; `:428` uses `pid: undefined`, so even on Windows it skips `killTree` entirely and no test drives a live pid whose `killTree` reports failure. `helpers.ts:576` gives `killTree` a `timeout` that kills the utility, and `helpers.test.ts:451` only covers an unowned pid, which fails fast rather than reaching the deadline. Both branches are unreachable from a POSIX host because `process.platform` is read inline at `helpers.ts:527` and `:628` rather than injected. I cannot execute these here.
CLOSES WHEN: on a Windows host, `npx vitest run --config vite.config.ts --no-cache --project src:server` passes with two added tests — one driving `stopChild` over a live pid whose `killTree` reports false and asserting the direct `SIGKILL` fallback ran, one driving `killTree` against a tree whose `taskkill` outlives the `timeout` and asserting `false`.
SEVERITY: degrades-consumers

ROW: Windows re-verification of the POSIX repair commit
SEAM: platform
STATE: UNPROVEN
EVIDENCE: Commit `b392629` changed `src/server/helpers.ts` (the `killProcess` ESRCH fallback), `tests/src/server/fixtures/child.mjs` (`chatty` and `empty` no longer call `process.exit(0)`; `trap` now announces readiness), `Process.test.ts`, `ProcessManager.test.ts`, `helpers.test.ts`, and `guides.test.ts`. Its recorded gates are POSIX only. The fixture change is the risk: the commit message itself records that Node makes a child's stdout blocking on Windows and non-blocking here, so removing `process.exit(0)` changes when the flooding fixtures terminate on the host that was never re-run.
CLOSES WHEN: `npm run format:check`, `npm run lint:check`, `npm run check`, `npm run build`, and `npm test` are each run on a Windows host and read by direct exit code, with `test:src` reporting 94 passed | 5 skipped.
SEVERITY: blocks-release

ROW: Repeated stop and destroy collapse onto one termination
SEAM: lifecycle (idempotence)
STATE: RETAIN
EVIDENCE: `Process.ts:196-199` and `:210-213` memoize `#stopping` and `#ending`. Probe: `child.stop() === child.stop()` and `child.destroy() === child.destroy()` both `true`; both stop results `true`; `stop()` after `destroy()` returned `true` with no second signal. `Process.test.ts:186` pins the double-stop-plus-abort collapse and `ProcessManager.test.ts:310` pins the shared registry barrier.
CLOSES WHEN: no action.
SEVERITY: internal-quality

ROW: Manager reservation, eviction, and destroy races
SEAM: concurrency / lifecycle
STATE: RETAIN
EVIDENCE: `ProcessManager.test.ts:97` forged-exit rejection, `:114` reservation released on a construction throw, `:134` launch after destroy, `:150` launch whose own option getter destroyed the registry, `:206` no child stranded when a getter destroys then throws — all pass here. Probe: 25 children launched, `count=25`, then a concurrent `stop()` and `destroy()`; `count_after=0`, `emitter_destroyed=true`, and a later `launch` threw code `protocol`. A separate probe confirmed the group kill reaches descendants (`run_timeout_grandchild=zombie`, meaning it died and had not yet been reaped).
CLOSES WHEN: no action.
SEVERITY: internal-quality

ROW: Stdin faults and spawn faults without a listener
SEAM: hostile input / lifecycle
STATE: RETAIN
EVIDENCE: Probe with an `uncaughtException` trap installed: a `Process` constructed against `/nonexistent-workspace-probe` with no `error` listener registered did not crash and resolved `exit` as `{"code":-2,"signal":null}`. A live-then-dead peer gave `send_before_exit=true send_after_exit=false`, matching the `ProcessInterface.send` contract. `Process.ts:127` swallows stdin errors and `Process.test.ts:170` pins that a pending write settles at teardown.
CLOSES WHEN: no action.
SEVERITY: internal-quality

BLOCKERS: Backlog bound released without limit during termination; Windows re-verification of the POSIX repair commit.

---

Probes removed; `git status --porcelain` is empty (no tracked file touched).

ROW: Cross-copy error guard fails on a real ProcessError
SEAM: package consumption — cross-instance identity of the published error contract
STATE: REPAIR
EVIDENCE: `isProcessError` is `holds(() => value instanceof ProcessError)` (`/workspace/process/src/core/errors.ts:43-45`). Two copies of this package coexist in an ordinary npm tree right now — `npm ls @orkestrel/process --all` in `/workspace/process` reports `@orkestrel/process@0.0.4` at the root and `@orkestrel/scaffold@0.0.44 -> @orkestrel/process@0.0.3` nested. Reproduced against the installed tarball with controls (`node twocopy.mjs`, scratch consumer with `process3@npm:@orkestrel/process@0.0.3`):
```
POS  same-copy   : true (expect true)
NEG  plain Error : false (expect false)
NEG  lookalike   : false (expect false)
SUBJ other-copy  : false | it is a real ProcessError: ProcessError invalid
SUBJ thrown by 0.0.3 run(): false | name: ProcessError | code: spawn
```
Same failure across the ESM/CJS boundary of this single tarball (`node dual.mjs`): `same core class? false`, `ESM isProcessError(cjs error): false`, `instanceof ESM ProcessError: false`. Both vectors use only this package's own published entry points. The mechanism owner has the same defect: `node contractdual.mjs` gives `SUBJECT cross-format isContractError: false` for a genuine `ContractError` (`@orkestrel/contract@0.0.12` uses a per-class `#brand` field, `node_modules/@orkestrel/contract/dist/src/core/index.js:453`). The 0.0.4 cascade recorded in `.orkestrel/process/0.0.4-release-sequencing.md` deliberately creates the two-copy window across `mcp`, `scaffold`, `probe`, and `supervisor`.
CLOSES WHEN: `isProcessError` returns `true` for a `ProcessError` constructed by a different installed copy of the package and `false` for a plain `Error` and for a shape-only lookalike — for example a `Symbol.for('@orkestrel/process.error')` own property set in the constructor and read by the guard — proven by a test that loads two distinct copies (`dist/src/core/index.js` and `dist/src/core/index.cjs`, plus a second installed version) in one process and asserts all three results, with the plain-`Error` and lookalike controls in the same test.
SEVERITY: degrades-consumers

ROW: No proof runs against the built artifact
SEAM: package consumption — generated output gate
STATE: IMPLEMENT
EVIDENCE: `ls /workspace/process/tests` lists no `distribution.test.ts`. Every existing proof resolves through source aliases: `tests/guides.test.ts:38,49` import from `@src/core` and `@src/server`, so guide parity is measured against `src/`, never against `dist/`. The host already reserves the slot — `tests/config.test.ts:114` includes `'distribution'` in the auto-registered project labels, and `tests/config.test.ts:412-419` asserts that when the project is registered, `scripts["test:distribution"]` is exactly `vitest run --config vite.config.ts --no-cache --reporter=dot --project distribution`, that `test` does **not** call it, and that `prepublishOnly` **does**. Today `npm pack` produces a 15-file tarball no automated check ever loads.
CLOSES WHEN: `tests/distribution.test.ts` exists, `package.json` carries `test:distribution` with that exact command, `prepublishOnly` includes `npm run test:distribution`, and the test builds, packs, installs the tarball into a scratch directory outside the repo, and asserts: every `exports`/`main`/`module` target file exists; `import` and `require` of both `@orkestrel/process` and `@orkestrel/process/server` succeed; the runtime export name set of each entry equals its `.d.ts` value-declaration set (13 for core, 29 for server today); and one real call per entry returns the documented value.
SEVERITY: degrades-consumers

ROW: `/server` subpath has no types under legacy resolution
SEAM: package consumption — declaration alignment
STATE: IMPLEMENT
EVIDENCE: Executed against the installed tarball with TypeScript 6.0.3, exit codes read bare:
```
moduleResolution=node16   exit=0
moduleResolution=nodenext exit=0
moduleResolution=bundler  exit=0
moduleResolution=node10   exit=2
  use.ts(3,43): error TS2307: Cannot find module '@orkestrel/process/server' or its
  corresponding type declarations. There are types at '.../dist/src/server/index.d.ts',
  but this result could not be resolved under your current 'moduleResolution' setting.
```
The root entry resolves under node10; only the subpath fails. `package.json` declares no top-level `types` and no `typesVersions` (probe output: `top-level types field: ABSENT`). Single-entry siblings avoid this by declaring `types` (`@orkestrel/contract` and `@orkestrel/emitter` both set `./dist/src/core/index.d.ts`).
CLOSES WHEN: either `typesVersions` maps `server` to `dist/src/server/index.d.ts` and the node10 typecheck above exits 0, or `README.md` § Requirements states the supported `moduleResolution` floor (`node16`, `nodenext`, or `bundler`) and the guide-parity gate asserts that statement.
SEVERITY: degrades-consumers

ROW: Both entries execute in both module formats
SEAM: package consumption
STATE: RETAIN
EVIDENCE: Tarball installed in a scratch directory outside the repo. `node use.mjs` and `node use.cjs` both print identical results and exit 0:
```
core: invalid true true 5000
runSync: 0 "sync-ok"      run: 0 "async-ok"
formatCommand: node -e process.stdout.write("sync-ok")
process lines: ["line1"]  manager count: 1
```
Real functions called per entry: core `createInvalidError`/`isProcessError`/`PROCESS_GRACE`; server `runSync`, `run`, `formatCommand`, `resolveExecutable`, `createProcess` (framed line read), `createProcessManager` (`launch` + `destroy`). Export name sets are byte-identical between formats (13 core, 29 server). `resolveExecutable('node') === undefined` on POSIX is the documented contract (`src/server/helpers.ts:210-211`: "A POSIX host resolves the file itself, so the answer there is always `undefined`"). Confirming the known probe defect does not apply here: no `import.meta` appears in `src/` (only `configs/helpers.ts:29`), and the CJS server entry ran clean.
CLOSES WHEN: covered by the distribution-proof row; this row records the executed state as of 0.0.4.
SEVERITY: internal-quality

ROW: Strict-layout and bundler consumption
SEAM: package consumption
STATE: RETAIN
EVIDENCE: `pnpm@10.33.0 add <tarball>` into a fresh project, then `node use.mjs` exit 0 and `node use.cjs` exit 0; `tsc -p tsconfig.node16.json` exit 0 and `tsc -p tsconfig.cjs16.json` exit 0 under the isolated layout, with `skipLibCheck` left at its default `false`. `esbuild --bundle --platform=node --format=esm` exits 0 with no warnings and the bundle runs to `ESM ALL OK`. `--traceResolution` confirms the CJS condition selects the copied declarations: `@orkestrel/process` → `dist/src/core/index.d.cts`, `@orkestrel/process/server` → `dist/src/server/index.d.cts`.
CLOSES WHEN: covered by the distribution-proof row.
SEVERITY: internal-quality

ROW: exports / files / declaration target alignment
SEAM: generated output
STATE: RETAIN
EVIDENCE: Every `exports`, `main`, and `module` target resolves inside the installed tarball — 9 targets checked, `missing targets: 0`. `files: ["dist/src","README.md"]` covers all of them. `npm pack` ships exactly 15 files: 4 bundles, 4 declaration files (`.d.ts` + byte-copied `.d.cts` per entry), 4 maps, `package.json`, `README.md`, `LICENSE`. Built `.d.ts` value declarations equal runtime exports per entry (core 13/13, server 29/29). Bundle-internal linkage is format-consistent: `dist/src/server/index.js` imports `../core/index.js`, `index.cjs` requires `../core/index.cjs`, so root and server share one core instance within a format.
CLOSES WHEN: covered by the distribution-proof row.
SEVERITY: internal-quality

ROW: Tarball hygiene
SEAM: package consumption — hostile boundary
STATE: RETAIN
EVIDENCE: Extracted tarball scanned. `grep -roE "/(workspace|home|Users|root)/[A-Za-z0-9._/-]{3,}"` returns nothing — no build-host paths leak, including inside the maps. `grep -rniE "api[_-]?key|secret|password|token|BEGIN .*PRIVATE KEY|npm_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}"` matches only the English word "token" in TSDoc and the `TOKEN` example environment key. No `tmp/`, `.orkestrel/`, `tests/`, `src/`, `.env`, or `.npmrc` ships. `git ls-files dist` is empty and `.gitignore:12` ignores `dist`, so no stale build artifact is tracked. `npm pack` run twice produced the same shasum `9b407c0d127d2ac9a7c02540400a2151dac11291`.
CLOSES WHEN: covered by the distribution-proof row.
SEVERITY: internal-quality

ROW: engines floor is honest and load-bearing
SEAM: package consumption — supported runtime targets
STATE: RETAIN
EVIDENCE: Downloaded real Node binaries and ran the installed tarball on each. On `v22.12.0` (the declared floor) both `use.mjs` and `use.cjs` exit 0 with full output. Negative control on `v20.18.1` exits 1: `TypeError: Promise.withResolvers is not a function at run (.../dist/src/server/index.js:649:26)`. `Promise.withResolvers` (Node 22.0.0) is the highest-versioned API in either bundle; the only other modern construct found is `Array.prototype.at`. Both runtime dependencies declare the same floor (`contract` and `emitter`: `>=22.12.0`). Note for consumers: npm's `engines` is advisory without `engine-strict`, so a Node 20 install succeeds and fails at first `run` call with the message above.
CLOSES WHEN: the distribution proof runs its entry-point imports on the declared floor version, not only on the developer's Node.
SEVERITY: internal-quality

ROW: No phantom runtime dependency
SEAM: package consumption — dependency declaration
STATE: RETAIN
EVIDENCE: External specifiers in all four shipped bundles are exactly `@orkestrel/contract`, `@orkestrel/emitter`, `node:buffer`, `node:child_process`, `node:fs`, `node:path`, `node:readline`, `node:string_decoder`, plus the intra-package relative core import. Both `@orkestrel/*` names are in `dependencies`. Shipped `.d.ts` files import only `node:buffer`, `@orkestrel/emitter`, and the self-referencing `@orkestrel/process` subpaths — all resolvable from a consumer install, proven by the `skipLibCheck: false` typechecks passing under npm and pnpm. Installing the tarball alone pulls 3 packages and nothing else.
CLOSES WHEN: covered by the distribution-proof row.
SEVERITY: internal-quality

ROW: Published surface moved 0.0.3 → 0.0.4
SEAM: generated output versus the published artifact
STATE: RETAIN
EVIDENCE: Fetched `npm pack @orkestrel/process@0.0.3` from the registry and compared against the 0.0.4 build. Identical file set. `dist/src/core/*` byte-identical. `dist/src/server/index.js`, `index.cjs`, and `index.d.ts` differ materially — `killProcess` gained an ESRCH fallback:
```
<     } catch {}
---
>     } catch (error) {
>         if (error instanceof Error && "code" in error && error.code === "ESRCH") {
>             holds(() => child.kill(signal));
>             return;
>         }
>     }
```
plus the matching `@remarks` change on `killProcess` and `stopChild`. Instrument controls: mutated-copy comparison reports DIFF, self-comparison reports SAME. The runtime dependency set is unchanged against the packument (`npm view @orkestrel/process@0.0.3 dependencies` returns the same two ranges), and the only manifest change besides `version` is the `@orkestrel/scaffold` devDependency `^0.0.43` → `^0.0.44`. Per the publishing law the material dist diff alone obliges the bump, and the cascade is already sequenced in `.orkestrel/process/0.0.4-release-sequencing.md`.
CLOSES WHEN: 0.0.4 is on the registry and `mcp`, `scaffold`, and `probe` re-pin to `^0.0.4` in the recorded layer order.
SEVERITY: internal-quality

ROW: README examples run against the published artifact
SEAM: package consumption — documentation truth
STATE: RETAIN
EVIDENCE: Both `README.md` usage fences transcribed verbatim and run against the installed tarball. Example 1 (`run` with no options argument, exercising the `workspace?` default at `src/core/types.ts:266`) prints `README EX1 OK: v22.22.2`, exit 0. Example 2 (`createProcess`, `for await (const line of child.lines)`, `await child.exit`, `await child.destroy()`) prints `LINE: a`, `LINE: b`, `EXIT: {"code":0,"signal":null}`, exit 0. The stated requirement "Node.js >= 22.12.0 / ESM and CommonJS builds" matches the executed engines and format results.
CLOSES WHEN: the distribution proof transcribes both README fences and asserts their printed values, so a fence edit that the artifact contradicts fails a gate.
SEVERITY: internal-quality

ROW: Source maps and full source embedded in the tarball
SEAM: generated output
STATE: RETAIN
EVIDENCE: The 4 map files are 167 kB of the 407 kB unpacked size and carry complete `sourcesContent` for every `src/` file, although `files` excludes `src/`. `sources` entries are relative (`"../../../src/server/helpers.ts"`) with no `sourceRoot` and no absolute path, so a debugger reads the embedded content. `@orkestrel/contract@0.0.12` ships maps the same way; `@orkestrel/emitter@0.0.7` does not. No secret or host path is exposed (see the tarball-hygiene row).
CLOSES WHEN: the shipped map set is a stated decision — either the distribution proof asserts the four maps are present with `sourcesContent` populated and no absolute path, or `files`/the build config stops emitting them and the proof asserts their absence.
SEVERITY: internal-quality

ROW: Windows-only shipped code is never executed
SEAM: package consumption — supported runtime targets
STATE: UNPROVEN
EVIDENCE: `npm publish --dry-run` ran the full `prepublishOnly` chain green on Linux: `format:check`, `lint:check`, `check`, `build`, then `Tests 90 passed | 9 skipped (99)` for `src`, 86 policy, 28 config, 51 guides. All 9 skips are `it.skipIf(process.platform !== 'win32')` (`tests/src/server/helpers.test.ts:107,133,157,186,207,249,273,451`; `tests/src/server/Process.test.ts:290`) covering `resolveExecutable` PATHEXT lookup, `buildSpawn` `cmd.exe` routing and percent-sign refusal, `killTree`, and tree-kill of a grandchild. That code ships in the tarball (`dist/src/server/index.js` contains the `cmd.exe /d /s /c` and `taskkill` paths) and no run on this host executes it. This confirms the known item that Windows behaviour of the repaired tests and fixtures is unverified.
CLOSES WHEN: `npm test` runs on a `win32` host and reports 99 passed with 0 skipped, and that run's output is recorded in `.orkestrel/process/`.
SEVERITY: degrades-consumers

ROW: Guides and campaign record excluded from the tarball
SEAM: package consumption — published contents
STATE: EXCLUDE
EVIDENCE: `README.md` links `guides/process.md`, which the tarball does not contain (15-file listing). This is the fleet convention, not a drift: `@orkestrel/contract@0.0.12` also declares `files: ["dist/src","README.md"]` and ships no guides. `.orkestrel/` and `tmp/` are likewise absent, which is required. No consumer-visible failure was measured; the link is a repository-relative link in a README npm renders against the declared `repository` field.
CLOSES WHEN: n/a — excluded on the convention evidence above. If the link is later required to resolve from `node_modules`, it becomes an absolute GitHub URL rather than a `files` change.
SEVERITY: internal-quality

BLOCKERS: Cross-copy error guard fails on a real ProcessError. It is the one row I would fix before spending the 0.0.4 approval window. The defect is pre-existing in 0.0.3, so 0.0.4 does not introduce it — but 0.0.4 is what opens the multi-version window across `mcp`, `scaffold`, `probe`, and `supervisor` that the sequencing record already anticipates, and across that window `isProcessError` silently returns `false` for genuine failures the package itself threw. The other two open rows (no distribution proof, `/server` types under node10) are degrades-consumers and can follow the publish.
---

# Addendum, 2026-08-20 — Q7's claim is a race, measured

Q7 landed as documentation plus a test asserting that a `runSync` timeout leaves a grandchild running
while the same shape under `run` ends the tree. The test is **nondeterministic**, and the cause is the
product's behaviour rather than the test's instrument.

Measured directly against the built artifact, six trials, polling for the marker every 10 ms with a
12-second budget:

```text
trial 0: expired=true marker appeared at 296ms
trial 1: expired=true marker appeared at 295ms
trial 2: expired=true marker appeared at NEVER (>12s)
trial 3: expired=true marker appeared at NEVER (>12s)
trial 4: expired=true marker appeared at NEVER (>12s)
trial 5: expired=true marker appeared at 294ms
```

Three of six survive and write; three never write at all.

## Why

`runSync` is given `timeout: 50`. The `tree-write` fixture spawns its grandchild and the grandchild
must reach its own `setTimeout` registration before the root is killed. The audit already measured
Node's bootstrap on this host at **45.7–49.9 ms** (`ProcessManager` row, `tmp/probe/bootstrap.test.ts`).
The grandchild is therefore racing its own interpreter startup against the root's 50 ms deadline, and
loses about half the time.

On POSIX the fixture spawns the grandchild with `detached: process.platform === 'win32'`, so on Linux
it is **not** detached and shares the root's process group.

## What this changes

The guide sentence Q7 added — that a `runSync` timeout ends the root alone and leaves descendants
running — is true only for a descendant that finished starting first. As written it states a guarantee
the package does not provide.

Two things are owed, and they are a design decision rather than a flake repair:

1. **The fixture must signal readiness**, the way `trap` does after installing its handler, so the
   test waits for an established grandchild before asserting survival. That removes the bootstrap race
   and lets the test measure the termination behaviour it names.
2. **The guide must qualify the claim** to what the package actually guarantees: `runSync` signals the
   root alone, so a descendant that is already running survives; a descendant still starting may not.

A repair attempt that only polls for the marker is not enough and was reverted. Polling converts a
fast failure into a five-second timeout without touching the race, and a budget equal to the test's own
timeout can never fail gracefully.

**Routed to PC3**, which owns these fixtures and test files.

## An ecosystem gap this exposes

`@orkestrel/test` publishes `waitForDelay` and no "wait until a condition holds" helper:

```text
$ grep -oE 'export declare (function|const) [a-zA-Z]+' node_modules/@orkestrel/test/dist/src/*/index.d.ts
… captureError collect collectStream createHostileValues createLoopback createRecorder createScratch
  createTeardown isExcluded matchesIdentity readInventory removeTree requireValue resolveContained
  resolveRoot roundTripJSON waitForDelay
```

Two packages have now independently written a fixed-sleep race for want of it: probe's arming test
(`tests/src/bin/main.test.ts`, repaired 2026-08-19) and this one. The absent helper is the shared root
cause of a defect class, and it belongs in `@orkestrel/test` rather than being re-solved per package.
