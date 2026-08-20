# Process follow-up unit B2 report — stopped on scope conflict

## Deviation

Expected: `rg -n "handlers" src/ tests/ guides/process.md` returns no hit.

Found: the command reaches required generic handler-kind policy coverage in the off-limits
`tests/setupPolicy.ts` and `tests/policy.test.ts` files:

```text
tests/setupPolicy.ts:132:	'handlers.ts',
tests/setupPolicy.ts:155:	'handlers.ts',
tests/setupPolicy.ts:1535:		label: 'rejects data in handlers.ts',
tests/setupPolicy.ts:1538:		files: [{ path: 'app/edge/handlers.ts', content: "export const STATUS = 'ready'\n" }],
tests/setupPolicy.ts:2139:	{ path: 'app/browser/handlers.ts', content: 'export function open(): void {}\n' },
tests/setupPolicy.ts:2143:			"import { open } from './handlers.js'\nexport const ROUTES = Object.freeze([{ method: 'GET', path: '/', handler: open }])\n",
tests/policy.test.ts:43:	it('keeps handlers in the function set and routes out', () => {
tests/policy.test.ts:44:		expect(FUNCTION_SOURCE_FILES).toContain('handlers.ts')
exit 0
```

The unit stopped under the deviation contract. Meeting the exact criterion requires edits outside
the owned scope and would remove policy coverage of the lawful request-handler kind. One hypothesis:
the residue criterion intended to exclude the generic policy fixtures.

## File map

- `src/server/handlers.ts` was deleted after its `execute`, `executeSync`, and `detach`
  functions moved to matching modules under the registered `src/server/execution` function
  domain. This placement follows the function-module rule: each file contains its matching exported
  function.
- `src/server/index.ts` replaces the deleted barrel row with rows for the matching execution
  modules.
- The matching describes from `tests/src/server/helpers.test.ts` and the proofs from
  `tests/src/server/handlers.test.ts` moved to the matching files under
  `tests/src/server/execution`. The old handlers suite was deleted.
- `tests/src/server/helpers.test.ts` retains the helper and termination suites.
- `guides/process.md` carries the execution-suite inventory rows and narrows the helper-suite row
  to the behavior left there.
- The deleted source file contained no shared module-scope declaration beyond imports. No
  declaration moved to `src/server/helpers.ts`.

## Export-set comparison

Not run because the deviation contract stopped the unit before acceptance checks.

## Residue sweep

Command:

```text
rg -n "handlers" src/ tests/ guides/process.md
```

The exact output appears under Deviation. The command exits `0` because the off-limits policy
fixtures match.

## Scoped and gate readings

The deviation stopped the unit before these commands ran:

```text
npm run lint:check
npm run check
npm run format:check
npm run test:policy
npx vitest run --config vite.config.ts --no-cache --project src:server tests/src/server/execution/execute.test.ts
npx vitest run --config vite.config.ts --no-cache --project src:server tests/src/server/execution/executeSync.test.ts
npx vitest run --config vite.config.ts --no-cache --project src:server tests/src/server/execution/detach.test.ts
```

`git diff --check` ran before the deviation and reported:

```text
tests/src/server/helpers.test.ts:760: new blank line at EOF.
```

## Flagged claim

I flag the partial file move as unverified. The acceptance gates, export-set comparison, and scoped
suites did not run, and the blank-line finding remains.

## Status

```text
 M guides/process.md
 M package-lock.json
 D src/server/handlers.ts
 M src/server/index.ts
 D tests/src/server/handlers.test.ts
 M tests/src/server/helpers.test.ts
?? src/server/execution/
?? tests/src/server/execution/
```

The `package-lock.json` modification predates this unit and remains off-limits.

## Diffstat

```text
 guides/process.md                 |  18 +-
 package-lock.json                 |  14 +-
 src/server/handlers.ts            | 312 ----------------------
 src/server/index.ts               |   4 +-
 tests/src/server/handlers.test.ts |  84 ------
 tests/src/server/helpers.test.ts  | 545 --------------------------------------
 6 files changed, 22 insertions(+), 955 deletions(-)
```
