# process follow-up unit B1 — bind the failed-spawn proof

## Role and engine

`builder`, native cheap tier. Fully specified; no design decision remains.

## Objective

Close the follow-up unit A audit's broken claims (`tmp/codex/followup-a-audit-last.md`): the
failed-spawn test's named assertions pass without the `pid` getter, so the proof does not bind to
the defect its title names, and the unit report presents it as binding.

## Context

The tree is committed and clean at ce0ee20. The test is
`tests/src/server/Process.test.ts`, the block titled
`reports no process id for a spawn that produced no child, and still settles exit`.

Make these edits and no others:

1. Immediately after the `const child = createProcess({ ... })` construction in that test, insert:

```ts
		// An absent member also reads undefined, so presence is pinned apart from the value: the
		// getters live on the class, and this line is false on a class that never declared them.
		expect('pid' in child && 'code' in child && 'signal' in child).toBe(true)
```

2. Retitle the test to name what it proves:
   `declares the pid, code, and signal members, reports no id and a null live pair for a spawn that produced no child, and settles exit with the fault code`

3. Append this section to the `tmp/followup-a-report.md` file, verbatim:

```markdown
## Correction, after the cross-engine audit

The failed-spawn proof's named assertions (`pid` undefined, `exit` settling) also pass on the
pre-change class, because an absent member reads `undefined`; only the unnamed `code` and `signal`
reads carried the red. The claim that every criterion closed bound was therefore overstated. The
repair pins member presence with an `in` check that is false on a class that never declared the
getters, and the title names the terminal-pair assertions it carries.
```

## Scope

- Owned: `tests/src/server/Process.test.ts` (the named test only), `tmp/followup-a-report.md`
  (append only).
- Off-limits: everything else.
- No commit, no push, no install, no git state-mutating command.

## Execution

You perform this assignment directly and spawn nothing.

## Output

Write the `tmp/followup-b-report.md` file: the exact inserted lines, the old and new title, and
the red-then-green readings from the criteria. No process diary.

## Deviation contract

Any mismatch between these instructions and the file state — the block absent, the title already
different — stops the unit with the standard report.

## Acceptance criteria (in order)

1. `npm run lint:check` exits 0.
2. `npm run format:check` exits 0 (run `npm run format` first if needed).
3. The binding proof: run
   `npx vitest run --config vite.config.ts --no-cache --project src:server tests/src/server/Process.test.ts -t "declares the pid"`
   and record it green; then temporarily comment out the three getter declarations in
   `src/server/Process.ts` (`pid`, `code`, `signal`), run the same command, record the red naming
   the presence pin, and restore the getters exactly (uncomment). `git diff src/server/Process.ts`
   must be empty afterward and the same command green again.
4. `npm run check` exits 0.
