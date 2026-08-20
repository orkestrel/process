# process follow-up unit B1 — report

## Inserted lines

In `tests/src/server/Process.test.ts`, immediately after the `const child = createProcess({ ... })`
construction in the named test:

```ts
		// An absent member also reads undefined, so presence is pinned apart from the value: the
		// getters live on the class, and this line is false on a class that never declared them.
		expect('pid' in child && 'code' in child && 'signal' in child).toBe(true)
```

## Title change

- Old: `reports no process id for a spawn that produced no child, and still settles exit`
- New: `declares the pid, code, and signal members, reports no id and a null live pair for a spawn
  that produced no child, and settles exit with the fault code`

## Red-then-green readings

Command: `npx vitest run --config vite.config.ts --no-cache --project src:server
tests/src/server/Process.test.ts -t "declares the pid"`

- Green, baseline: `Tests  1 passed | 35 skipped (36)`.
- Red, with the three getter declarations (`pid`, `code`, `signal`) commented out in
  `src/server/Process.ts`: `Tests  1 failed | 35 skipped (36)`, failing on
  `expect('pid' in child && 'code' in child && 'signal' in child).toBe(true)` with
  `AssertionError: expected false to be true`.
- Restore: the three getters uncommented exactly. `git diff src/server/Process.ts` returned empty.
- Green, after restore: `Tests  1 passed | 35 skipped (36)`.

## Gates

- `npm run lint:check` → exit 0.
- `npm run format:check` → exit 0, "All matched files use the correct format."
- `npm run check` → exit 0.

## Scope

`tests/src/server/Process.test.ts`: the named test only, edited as above.
`tmp/followup-a-report.md`: the `## Correction, after the cross-engine audit` section appended
verbatim, per the brief.

No commit, no push, no install.
