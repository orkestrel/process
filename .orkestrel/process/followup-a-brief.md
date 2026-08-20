# Process follow-up unit A: the pid surface and the audit's independent findings

## Role and engine

Claude Opus 5 `implementer`, native, writing in the main checkout at `/home/user/process`.

## Objective

Land the owner-ruled pid surface per the `tmp/pid-reconciliation.md` file, and close the process
fix-unit audit findings that do not depend on the pending kind-file ruling.

## Context

- Read before editing: the `AGENTS.md` file, `.claude/rules/names.md`,
  `.claude/rules/typescript.md`, `.claude/rules/patterns.md`, `.claude/rules/writing.md`,
  `.claude/rules/tests.md`, the `guides/process.md` guide, the `tmp/pid-reconciliation.md` file
  (the adopted shape — binding), and the `tmp/pid-brief.md` file (the design brief behind it).
- The tree is committed and clean at 7010200. The gates are `npm run format:check`,
  `npm run lint:check`, `npm run check`, `npm run build`, `npm test`. You are on the host, not a
  sandbox: spawn-driving tests run normally, but the container carries concurrent load, so treat a
  timing-sensitive whole-suite reading as an observation and scoped runs as your criteria.
- The pid surface, per the reconciliation:
  - `pid: number | undefined` leads the `ProcessInterface` data block in src/core/types.ts — a
    required member, implemented as a getter over the held child in src/server/Process.ts. TSDoc:
    fixed when construction returns because the spawn is eager; `undefined` forever when the spawn
    produced none; survives exit; reports no liveness.
  - `code: number | null` and `signal: string | null` — getters mirroring the host child's
    `exitCode` and `signalCode`. TSDoc states the close-versus-exit distinction: these report the
    native exit while the `exit` promise settles on stdio close, which a descendant holding
    inherited stdio can keep open past native exit.
  - Liveness is derived, never stored: the guide documents
    `pid !== undefined && code === null && signal === null` beside the pid-reuse warning, the
    POSIX negated-id group note, and the host signal route (`process.kill`); no signal member, no
    `exited` flag, no further members — the reconciliation's refusal table is settled.
  - Guide parity: the `ProcessInterface` types row, the surface-notes enumeration, a practices
    bullet on checking liveness before addressing `pid`, and the offering sentence in the
    `Process` section (the earlier strike of "the pid" reverses truthfully now the member exists).
  - Proofs, red then green per member: `pid` is a number immediately after construction on the
    happy path; a spawn-fault child reports `pid` undefined with `code` and `signal` null while
    `exit` still settles with the documented fault shape; `code`/`signal` null while live and set
    after exit.
- The audit findings (the auditor's exact evidence is in the `tmp/fix-audit-verdict.md` file):
  - **PR1 correction** — "at once" at guides/process.md:387 and the killTree remark in
    src/server/helpers.ts was the permitted simultaneity sense and was deleted anyway, dropping
    the fact that the Windows path ends the whole tree in one call. Restore the simultaneity fact
    at both sites (any wording that keeps the canon), and leave the guide:937 `now` fix in place.
  - **PR3 correction** — README.md:14-15 under-claims cancellation: `launch` takes
    `ProcessOptions` whose `signal` member cancels a managed child. Name every consumer and every
    abstainer: `Process`, `launch`, and `execute` take an `AbortSignal`; `executeSync` and
    `detach` take none.
  - **F2** — `executeSync` and `detach` (src/server/handlers.ts:224-237, :291-292) read caller
    getters more than once, so the value validated is not the value spawned. Hoist each option
    into a local binding once, before any validation, exactly as `execute` does at :62-69. Red
    proof: a mutating getter has directory A validated and the child observed in directory B
    today; after the fix one read decides both.
  - **F3** — state the read-once ownership invariant on `ExecuteOptions` in src/core/types.ts and
    in the guide's one-shot section, in the same words the supervised tier already uses.
- Out of scope, carried by the next unit: the `handlers.ts` kind-file relocation and the
  behavioural-test moves that follow it (the fleet register gains the function domain first). Do
  not rename or move `handlers.ts`; edit inside it only where F2 names.

## Unknowns

- Whether Node reports `exitCode`/`signalCode` on the spawn-fault path is settled by your own
  red-run of the spawn-fault proof; report the observed shape.

## Scope

- Owned: `src/core/types.ts`, `src/server/Process.ts`, `src/server/handlers.ts` (F2 lines only),
  `src/server/helpers.ts` (the killTree remark only), `guides/process.md`, `README.md`,
  `tests/src/server/Process.test.ts`, `tests/src/server/handlers.test.ts`.
- Off-limits: everything else, including `package.json`, configs, vendored files, and `tmp/`
  except your own report file.
- Permission limits: no commit, no push, no install, no `git checkout`/`restore`/`stash`/`reset`/
  `clean`, no secrets.

## Execution

You perform this assignment directly and spawn no agent.

## Output

Write your report to the `tmp/followup-a-report.md` file: per item, what changed with file:line,
each red and green command with its exact reading, the spawn-fault observation, and any claim of
your own you flag. End with the diffstat. No process diary.

## Deviation contract

A conflict with the reconciliation or a finding's prescription stops the unit with the standard
report. An ancillary choice (wording, member placement after `pid` leads, test naming for what it
proves) is yours to decide and record.

## Acceptance criteria (in order)

1. `npm run lint:check` exits 0.
2. `npm run check` exits 0.
3. `npm run format:check` exits 0 (run `npm run format` first if needed).
4. The pid, spawn-fault, and code/signal proofs each carry a recorded red and green reading.
5. The F2 mutating-getter proof carries a recorded red and green reading.
6. `rg -n "at once" guides/process.md src/server/helpers.ts` finds the restored simultaneity fact
   at both sites.
7. Scoped vitest runs over the files you touched pass. Whole-suite readings are observations.

## Review evidence

Return the actual `git diff --stat` and `git status --short` output in the report. The full diff
stays in the tree for the auditor.
