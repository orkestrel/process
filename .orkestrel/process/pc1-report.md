Implemented Q3–Q6 within the owned scope.

## Numbered repairs

- Q4: Added a `Symbol.for('@orkestrel/process.error')` brand. The guard also checks the native `Error` base, subclass prototype, fixed name, and declared code, so property-only lookalikes fail.
- Q3: `Process`, `run`, `runSync`, and `detach` now copy `file`, arguments, environment, input, and isolation state once. Validation, formatting, environment merging, and spawning use that frozen snapshot.
- Q5: `Process.destroy()` removes the caller’s abort listener before awaiting termination.
- Q6: `waitForExit` removes its exit listener when the deadline wins. Capability detection preserves the existing `ProcessChild` contract.

## Files written

- [src/core/errors.ts](/workspace/process/src/core/errors.ts:26)
- [src/server/Process.ts](/workspace/process/src/server/Process.ts:96)
- [src/server/helpers.ts](/workspace/process/src/server/helpers.ts:591)
- [tests/src/core/index.test.ts](/workspace/process/tests/src/core/index.test.ts:33)
- [tests/src/server/Process.test.ts](/workspace/process/tests/src/server/Process.test.ts:392)
- [tests/src/server/helpers.test.ts](/workspace/process/tests/src/server/helpers.test.ts:408)

## Red-then-green proofs

- Q4 command: `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:core -t 'recognizes genuine errors across package copies and module formats'`
  - Red: 1 failed.
  - Green: 1 passed.

- Q3 command: `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:server -t 'spawns the same command file that it validated'`
  - Red: 4 failed.
  - After repair: `Process`, `run`, and `detach` passed; `runSync` was blocked by sandbox `spawnSync ... EPERM`.
  - Invalid control command passed: 1 passed.

- Q5 command: `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:server -t 'removes the caller abort listener when teardown begins before close'`
  - Red with the teardown removal disabled: 1 failed.
  - Green: 1 passed.

- Q6 command: `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:server -t 'removes every exit listener after repeated deadlines'`
  - Red: 1 failed, with 12 retained listeners.
  - Green: 1 passed, with 0 retained listeners.

## Controls

- A plain `Error` remains false, proving the guard does not accept every native error.
- A branded plain `Error` remains false, proving the symbol property alone is insufficient.
- Separate source module instances prove cross-copy recognition.
- The built ESM guard recognizes a built CommonJS error.
- A changing invalid command is read once and produces `ProcessError` code `invalid`.
- Q5 records zero exit events before its listener assertion, proving `close` had not arrived.

## Validation

| Command | Exit |
| --- | ---: |
| `npm run format:check` | 0 |
| `npm run lint:check` | 0 |
| `npm run check` | 0 |
| `npm run build` | 0 |
| `npm run test:src:core` | 0 — 3 passed |
| `npm test` | 1 — sandbox process-creation failures |

## Spawn-dependent tests not settled here

The sandbox rejected nested child creation. Run these unchanged on the host:

- `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:server -t 'spawns the same command file that it validated'`
- `npm test`

The first command’s only sandbox failure was the repaired `runSync` case, caused by `spawnSync ... EPERM`.

## Guide sentences that must move

A later guide unit must update [guides/process.md](/workspace/process/guides/process.md:127), [command resolution](/workspace/process/guides/process.md:380), [termination](/workspace/process/guides/process.md:325), and [errors](/workspace/process/guides/process.md:658) to state:

- all four entry points validate and spawn from one owned command snapshot;
- `destroy` removes its caller abort listener before waiting;
- `waitForExit` releases its registered exit listener when its deadline wins;
- `isProcessError` recognizes branded errors across package copies and ESM/CommonJS formats while rejecting property-only lookalikes.

## Deviation

None. No off-limits or report-only file was changed. No settled handoff ruling was reopened.