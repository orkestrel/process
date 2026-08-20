# PC8 — independent gate evidence

`verifier`, Sonnet, dispatched after PC8 exited and after the Orchestrator's one-word `once`
correction. Read-only apart from the gate commands, with every working-tree-discarding git command
prohibited by name.

| Gate                        | Exit |
| --------------------------- | ---- |
| `npm run format:check`      | 0    |
| `npm run lint:check`        | 0    |
| `npm run check`             | 0    |
| `npm run build`             | 0    |
| `npm test`                  | 0    |
| `npm run test:distribution` | 0    |
| `npx scaffold audit`        | 0    |

`scaffold audit`: 0 of 123 planned paths drifted; bytes compared at 110, existence at 4, nothing at 9.

Test counts as the runner printed them:

- `test:src` (`src:core`, `src:server`): 4 files, 114 passed, 7 skipped (121)
- `test:policy`: 1 file, 86 tests
- `test:config`: 1 file, 28 tests
- `test:guides`: 1 file, 86 passed, 1 skipped (87)
- `test:setup`: 1 file, 5 tests
- `test:distribution`: 1 file, 1 test

Read-only checks:

- `tests/src/core` holds `errors.test.ts` alone; `tests/src/server` holds `Process.test.ts`,
  `ProcessManager.test.ts`, `fixtures`, and `helpers.test.ts`. Neither holds an `index.test.ts`.
- `grep -n "\bjust\b" guides/process.md` reports no match.
- `grep -n "\bbelow\b" guides/process.md` reports `:144` and `:262`, both numeric comparisons.
- `grep -n "\bonce\b" guides/process.md` reports seven lines, every one the counting sense or the
  literal `once` method name. None is temporal.
- Both barrels contain only `export * from './module.js'` rows.

No re-runs were required.
