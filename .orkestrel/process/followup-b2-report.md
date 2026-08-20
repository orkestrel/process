# Process follow-up unit B2 — completed report, 2026-08-20

The function-domain move is complete. The non-spawning gates pass, the registered domain passes
policy, the published function set is unchanged, and the amended residue population has no
`handlers` match. The scoped `executeSync` run hit the stated sandbox denial. The scoped `execute`
run received no child output in the cases that require it. The scoped `detach` run passed.

## File map

- `src/server/handlers.ts` was deleted. Its `execute`, `executeSync`, and `detach` functions moved
  to `src/server/execution/execute.ts`, `src/server/execution/executeSync.ts`, and
  `src/server/execution/detach.ts`. Each module exports only the function named for its file, as the
  registered function-module rule requires.
- `src/server/index.ts` replaces the deleted barrel row with star exports for the execution
  modules. The barrel still publishes `execute`, `executeSync`, and `detach`.
- The matching describes from `tests/src/server/helpers.test.ts` and the proofs from
  `tests/src/server/handlers.test.ts` moved to the matching files under
  `tests/src/server/execution`. This placement follows the test-mirror rule. The old handlers suite
  was deleted.
- `tests/src/server/helpers.test.ts` retains the helper and termination suites. Its stale
  `childCommand` import and extra end-of-file blank line were removed.
- `guides/process.md` narrows the helper-suite inventory row and adds the matching execution-suite
  rows.
- The deleted source module contained no shared module-scope declaration beyond imports. Nothing
  needed extraction to `src/server/helpers.ts` or another kind file.

## Gate readings

The acceptance gates produced these final readings:

```text
npm run lint:check
exit 0

npm run check
exit 0
root, src:core, and src:server TypeScript checks passed

npm run format:check
exit 0
All matched files use the correct format.
```

`npm run format` ran after the initial format check named the execution modules and their mirrored
suites. The formatter exited `0` and touched no path outside the owned set or the already-dirty,
off-limits `package-lock.json` file.

The registered function domain produced this policy reading:

```text
npm run test:policy
exit 0
Test Files  1 passed (1)
Tests       86 passed (86)
```

`git diff --check` exits `0` with no output.

## Export-set comparison

This command compares the function exports from the baseline `handlers.ts` file with the exports
from the landed execution modules:

```text
diff -u <(git show HEAD:src/server/handlers.ts | rg -o --pcre2 '^export (?:async )?function \K\w+' | sort) <(rg -o --pcre2 '^export (?:async )?function \K\w+' src/server/execution/*.ts | sed 's/.*://' | sort)
```

The command exits `0` with no diff. The compared sets print as follows:

```text
HEAD                         landed
detach                       detach
execute                      execute
executeSync                  executeSync
```

## Residue sweep

The amended command produced no output and exited `1`, which is ripgrep's no-match status:

```text
rg -n "handlers" src/ tests/src/ guides/process.md
```

The off-limits generic policy fixtures are outside this amended population.

## Scoped suite readings

The asynchronous execution suite used this exact command:

```text
npx vitest run --config vite.config.ts --no-cache --project src:server tests/src/server/execution/execute.test.ts
```

It exited `1`: `12 passed` and `2 failed`. The child-output cases received empty stdout. The
successful-run proof expected `ran:0`, and the capture-bound proof observed `truncated: false`
because no child output reached the parent. The output carried no explicit `EPERM` line. This is the
stated sandbox child-stdio limitation, so this reading is an observation for the host rerun.

The blocking execution suite used this exact command:

```text
npx vitest run --config vite.config.ts --no-cache --project src:server tests/src/server/execution/executeSync.test.ts
```

It exited `1`: `7 passed` and `6 failed`. The failure output records the sandbox denial exactly as
`Error: spawnSync /opt/node22/bin/node EPERM`, with `errno: -1`, `code: 'EPERM'`, and `syscall:
'spawnSync /opt/node22/bin/node'`.

The detached execution suite used this exact command:

```text
npx vitest run --config vite.config.ts --no-cache --project src:server tests/src/server/execution/detach.test.ts
```

It exited `0`: `1` test file passed and `5` tests passed.

## Flagged claim

I flag the `execute` and `executeSync` behavioral pass claim for the Orchestrator's host reading.
This sandbox cannot produce authoritative child-output or nested synchronous-spawn evidence. The
file move itself is supported here by the unchanged export set, the typechecks, the policy proof,
the clean residue sweep, and the scoped cases that remained measurable.

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
 src/server/handlers.ts            | 312 ---------------------
 src/server/index.ts               |   4 +-
 tests/src/server/handlers.test.ts |  84 ------
 tests/src/server/helpers.test.ts  | 550 +-------------------------------------
 6 files changed, 23 insertions(+), 959 deletions(-)
```
