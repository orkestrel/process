# PC-AUDIT2 — falsify PC5 and PC6

## Role and engine

`analyst` (GPT-5.6 Sol), through `codex exec`. Perform the assignment directly and spawn nothing.

Claude Opus 5 wrote both units under audit, so Opus cannot audit them. This lane is Sol, and it is the
only lane this round: the subject is one engine's work and the cross-engine reading is what it needs.

## Objective

Return a per-claim verdict on the numbered claims below. A claim is CONFIRMED only with evidence a
reader can re-derive. Otherwise FAIL, with the contradiction at `file:line`. UNPROVEN where the
evidence cannot settle it — say what would.

## Context

`/workspace/process`, `@orkestrel/process` 0.0.4, unpublished. 0.0.3 is on the registry.

Review evidence:

- `.orkestrel/process/pc-audit2-diff.txt` — the complete diff `4b01d30..HEAD`, 7,288 lines.
- `.orkestrel/process/pc-audit2-log.txt` — both commit messages.
- `.orkestrel/process/pc-audit-reconciliation.md` — the round that produced these units, with the per-claim ruling behind each finding.

Read the working tree for anything the diff does not settle.

Governing files: `AGENTS.md`, then `.claude/rules/` — `names.md`, `typescript.md`, `architecture.md`,
`patterns.md`, `tests.md`, `documentation.md`, `writing.md` — then `guides/process.md`.

Gate evidence, run by an independent verifier on the host on 2026-08-20, all exit 0: `format:check`,
`lint:check`, `check`, `build`, `test`, `test:distribution`, and `test:distribution --mode release`.
Counts: source 117 passed and 7 skipped, policy 86, config 28, guides 85 and 1 skipped, setup 5.

## The claims

1. `isolated: true` leaving no `PATH` on POSIX is now bound by an assertion that fails if the behaviour changes, not by a substring check.
2. A spawn fault reports the host's negative errno for `run` and `null` for `runSync`, and both are asserted as values.
3. A detached POSIX child survives the supervisor's `SIGKILL` and never receives the terminal's `SIGINT`, both halves executed, with the grouped child as a control that does receive it.
4. The `moduleResolution` floor is proven by compiling a consumer inside the installed package under each named mode, with a firing control under `node10`.
5. The termination proof's `run` half now runs clear of Node's interpreter bootstrap and waits on a readiness marker before asserting.
6. The distribution proof's negative control resolves inside the temporary consumer rather than against this repository's own `node_modules`.
7. `tests/distribution.test.ts` reads `import.meta.env.MODE` and fails rather than extracting under `--mode release`.
8. `tests/src/core/index.test.ts` no longer loads `dist/`, and `npm run test:src` passes with no built output present.
9. Q15's ESRCH guard spawns a real non-detached child and asserts the observed exit, with the pre-repair swallow as its control.
10. Q17's transcribed `@example` blocks number 16 rather than the grade's 12, and the count was measured with the compiler rather than assumed.
11. Q19 gives `README.md` the two parity assertions `guides/process.md` gets.
12. Q20 arms a timeout and an abort together in three cases and asserts exactly one of `expired` and `aborted` in each.
13. Exactly one command-snapshot implementation exists, exported through the server barrel, and it appears in the built declarations.
14. `ProcessChild` declares every member the helpers read, and an object implementing exactly the declared contract releases its exit listener.
15. `ProcessErrorCode` is derived from a frozen tuple, and adding a code to the tuple makes the guard admit it with no second edit.
16. `truncated` carries one ruled meaning across both public surfaces, and both are driven to `true` by a test.
17. `HANDOFF.md` is deleted and every statement worth keeping reached the guide, a rule, or a commit message.

## The open lens

After the numbered claims, answer: **what did these two units change that no claim above covers, and
is it right?** Number these continuing from 18. A defect the claim set does not reach is the finding
worth most here.

Look hardest at three places, because they are where an Opus-written unit is least likely to have
audited itself: the eleven renamed tests, where a name can drift from what the body drives; the
guide's new prose, where a sentence can be written more confidently than the code earns; and the
`snapshotCommand` extraction, where four call sites collapsing into one can lose a difference that
mattered at one of them.

## Standing conditions

- A bench sandbox denies a grandchild process and a nested `npm install`. This package's suite needs both. Do not run the gates as verification; they are supplied above. If you need to execute something to settle a claim and the sandbox denies it, say so and name the exact settling command.
- Do not edit any file. This is a read-and-rule assignment.

## Scope

Read-only. You write no file except your own report through the output mechanism.

## Execution

Perform this assignment directly. Spawn nothing.

## Output

One section per claim, in number order:

```
### Claim N
Verdict: CONFIRMED | FAIL | UNPROVEN
Evidence: file:line, and what it shows
```

Then:

- `## Continuing findings` — numbered from 18, each a falsifiable claim with its `file:line`.
- One terminal line, exactly `VERDICT: PASS` or `VERDICT: FAIL`.

No process diary.

## Acceptance criteria

1. Every claim 1 through 17 has a verdict and a `file:line`.
2. Every FAIL cites the exact contradicting line.
3. The continuing-findings section is present, even if empty.
4. Exactly one terminal `VERDICT:` line, and it is the last line.
