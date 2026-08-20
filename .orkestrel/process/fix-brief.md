# process readiness fix unit

## Role and engine

Sol `implementer`, GPT-5.6 Sol, inside `codex exec --sandbox workspace-write` at `/home/user/process`.

## Objective

Close every accepted readiness finding in the `tmp/readiness-matrix.md` file that names the process fix unit as carrier: PR1 through PR7, PR10, and PR11.

## Context

- Read before editing: the `AGENTS.md` file, `.claude/rules/names.md`, `.claude/rules/typescript.md`, `.claude/rules/architecture.md`, `.claude/rules/writing.md`, `.claude/rules/tests.md`, the `guides/process.md` guide, and the `tmp/readiness-matrix.md` file (the finding table with exact lines).
- The tree is committed and clean at dispatch. `node_modules` is installed. The gates are `npm run format:check`, `npm run lint:check`, `npm run check`, `npm run build`, `npm test`.
- Standing conditions of this sandbox: no network; a process spawned by a test may be denied `EPERM` one level down. If a scoped vitest run fails on `EPERM` or a spawn denial, record the exact command as an observation and continue; the Orchestrator takes that reading on the host after you exit. Do not diagnose the tree for a sandbox denial.
- The findings, restated with their prescriptions:
  - **PR1**: temporal `once` at guides/process.md:387, :937, src/server/helpers.ts:704. Rule each hit by sense; replace a temporal hit with `after`.
  - **PR2**: src/core/types.ts:401 and src/server/ProcessManager.ts:104 claim the `destroy` barrier settles before the protocol refusal; the reproduced interleaving and guides/process.md:749 state the opposite order. Correct the TSDoc to the actual order.
  - **PR3**: README.md:14 claims every tier has an emitter and cancellation; the one-shot and detached tiers have neither. Correct the sentence.
  - **PR4**: banned `guarantee` claim at guides/process.md:457. Replace with the checkable statement.
  - **PR5 + PR11 (one restructure)**: src/server/helpers.ts imports the `Retention` class (:34) and constructs it (:847); `execute` (:817), `executeSync` (:974), and `detach` (:1041) are imperative shell in the leaf `helpers.ts` file. Move the execution orchestration out of the leaf into the kind file `.claude/rules/architecture.md` prescribes for class-driving functions. The star-export barrel keeps every published name — verify no published name moves. Do not create a run entity or class. Record which kind file you chose and the rule line that prescribes it.
  - **PR6**: `execute()` spawns (:856) before reading `options.signal` (:929); a throwing getter rejects while the child lives. Read and retain every option, `signal` included, before spawning. Add the hostile-getter regression proof: a test whose `signal` getter throws must reject before any child exists. Write the proof first, run it red, then fix, then run it green; if the sandbox denies the run, record both commands as observations for the host.
  - **PR7**: platform-conditioned `skipIf` rows. For each, when the adjacent comment names the mechanism (not only the platform), leave it and record it as permitted; when only the platform is named, move the mechanism into the skip's reason.
  - **PR10**: guides/process.md:687-688 offers "the pid" from `Process`; `ProcessInterface` (src/core/types.ts:157) has no `pid` member. Strike "the pid" from the sentence. Add no getter.

## Unknowns

- The destination kind file for PR5/PR11 is yours to derive from `.claude/rules/architecture.md`; report the file and the rule line.
- Whether the scoped vitest proofs run inside this sandbox is unknown; report the outcome either way with exact commands.

## Scope

- Owned: `src/`, `tests/`, `guides/process.md`, `README.md`.
- Shared, report-only: none.
- Off-limits: `package.json`, `vite.config.ts`, `tsconfig.json`, `.claude/`, `.agents/`, `tests/setupPolicy.ts`, `tests/policy.test.ts` (vendored), `tmp/` except your own report file.
- Permission limits: no commit, no push, no install, no `git checkout`/`restore`/`stash`/`reset`/`clean`, no secrets.

## Execution

You perform this assignment directly and spawn no agent. Work file by file; validate scoped.

## Output

Write your report to the `tmp/fix-report.md` file: per finding, what changed with file:line, the red and green commands with their exact readings (or the sandbox-denial observation), the PR5/PR11 kind-file choice with its rule line, the PR7 per-site rulings, and any claim of your own you flag. End with the diffstat. No process diary.

## Deviation contract

A conflict with a finding's prescription — the prescription is impossible, or closing it requires an off-limits file — stops the unit: report expected, found, exact evidence, done or not done, one hypothesis at most. An ancillary choice (which sentence form, where a moved function sits inside its kind file) is yours to decide and record.

## Acceptance criteria (in order)

1. `npm run lint:check` exits 0.
2. `npm run check` exits 0.
3. `npm run format:check` exits 0 (run `npm run format` first if needed).
4. A sweep for each PR1/PR4 term over the named files returns no banned-sense hit; name the pattern and paths.
5. `rg -n "the pid" guides/process.md` returns no hit offering a pid from `Process`.
6. `rg -n "Retention" src/server/helpers.ts` returns no hit; `execute`, `executeSync`, `detach` no longer live in `helpers.ts`; the barrel still exports the same published names (`node -e` resolve check or scoped `check` is enough).
7. The hostile-getter proof exists and its red and green readings are recorded (or the sandbox denial is recorded with exact commands).
8. Scoped vitest runs over the files you touched pass, or their denial is recorded. Whole-suite and timing readings are observations, never criteria.

## Review evidence

Return the actual `git diff --stat` and `git status --short` output in the report. The full diff stays in the tree for the auditor.
