# process follow-up unit B2 — home the execution functions in their registered domain

## Role and engine

Sol `implementer`, GPT-5.6 Sol, inside `codex exec --sandbox workspace-write` at
`/home/user/process`.

## Objective

Close the fix-unit audit's kind-file finding per the ruling in `tmp/fix-audit-verdict.md`: the
one-shot execution functions move from the unlawful `handlers.ts` kind file into the registered
`src/server/execution` function domain, with their suites and the guide following.

## Context

- Read before editing: the `AGENTS.md` file, `.claude/rules/architecture.md` (the function-module
  shape: one exported function named for its file, everything else extracted by kind),
  `.claude/rules/names.md`, `.claude/rules/tests.md`, `.claude/rules/writing.md`, the
  `guides/process.md` guide, and `tmp/fix-audit-verdict.md` (finding F1 and the claim-2 ruling).
- The tree is committed and clean at 182f72a. `FUNCTION_DOMAIN_FOLDERS` in `tests/setupPolicy.ts`
  carries `'src/server/execution'` (delivered by the scaffold repair at this commit) — the folder
  is registered; do not edit the register.
- Standing conditions: `package-lock.json` is expected dirty (the recorded scaffold tarball swap)
  — off-limits, ignore it. The sandbox denies nested child spawns: the moved suites spawn real
  processes, so scoped runs of them may fail on `EPERM`; record the exact commands as
  observations, and the Orchestrator takes the readings on the host. Non-spawning gates
  (`lint:check`, `check`, `format:check`) run reliably.
- The move:
  - `src/server/handlers.ts` holds `execute`, `executeSync`, and `detach`. Create
    `src/server/execution/execute.ts`, `src/server/execution/executeSync.ts`, and
    `src/server/execution/detach.ts`, each holding exactly its one exported function. A
    declaration the functions share that lives in `handlers.ts` moves to its kind file
    (`helpers.ts` for a pure leaf, per the extraction law), not into a function module.
  - Delete `src/server/handlers.ts`. The barrel `src/server/index.ts` exports the function
    modules so every published name stays; prove it with the export-set comparison against HEAD.
  - Move the behavioural suites to mirror the modules: the `execute`, `executeSync`, and `detach`
    describes from `tests/src/server/helpers.test.ts` and the proofs in
    `tests/src/server/handlers.test.ts` land in `tests/src/server/execution/execute.test.ts`,
    `executeSync.test.ts`, and `detach.test.ts`; delete `tests/src/server/handlers.test.ts`.
    Move tests verbatim wherever the content needs no change; a helper the suites share follows
    the tests' own extraction rules.
  - Rewrite the guide's test-inventory rows: the `helpers.test.ts` row describes what remains
    there, the new rows describe the execution suites, and the word `handlers` leaves the guide.
    Sweep `handlers` over `src/`, `tests/`, and `guides/process.md` to prove no residue.

## Unknowns

- Whether `handlers.ts` holds shared module-scope declarations beyond the trio is yours to read;
  report where each landed and under which rule.

## Scope

- Owned: `src/server/handlers.ts` (delete), `src/server/execution/` (create),
  `src/server/index.ts`, `src/server/helpers.ts` (only if a shared leaf lands there),
  `tests/src/server/helpers.test.ts`, `tests/src/server/handlers.test.ts` (delete),
  `tests/src/server/execution/` (create), `guides/process.md`.
- Off-limits: `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`,
  `tests/setupPolicy.ts`, `tests/policy.test.ts`, every other vendored file, `tmp/` except your
  own report file.
- Permission limits: no commit, no push, no install, no `git checkout`/`restore`/`stash`/`reset`/
  `clean`, no secrets.

## Execution

You perform this assignment directly and spawn no agent.

## Output

Write your report to the `tmp/followup-b2-report.md` file: the file map (what moved where and
under which rule), the export-set comparison output, the `handlers` residue sweep, the scoped-run
readings or their denials with exact commands, and any claim of your own you flag. End with the
diffstat. No process diary.

## Deviation contract

A conflict with the move's prescription — a declaration with no lawful home, a consumer the scope
does not own — stops the unit with the standard report. An ancillary choice (test-helper
placement, guide row wording) is yours to decide and record.

## Acceptance criteria (in order)

1. `npm run lint:check` exits 0.
2. `npm run check` exits 0.
3. `npm run format:check` exits 0 (run `npm run format` first if needed).
4. `npm run test:policy` exits 0 (the register accepts the new folder), or its denial is recorded
   with the exact command.
5. The export-set comparison against HEAD shows no published name moved.
6. `rg -n "handlers" src/ tests/ guides/process.md` returns no hit.
7. Scoped runs of the moved suites pass, or their spawn denial is recorded with exact commands.

## Review evidence

Return the actual `git diff --stat` and `git status --short` output in the report. The full diff
stays in the tree for the auditor.
