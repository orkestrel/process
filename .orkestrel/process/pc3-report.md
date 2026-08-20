## What was extracted

Added pure, platform-parameterized helpers for:

- Environment lookup and merging.
- `PATHEXT` candidate ordering.
- Batch routing, quoting, and percent-sign refusal.

`killTree`, `taskkill.exe`, and live grandchild termination remain I/O-bound and were not extracted.

## Platform-read count

`src/server/helpers.ts`: **7 before → 3 after**.

The 3 survivors drive process signalling, termination, or spawn options.

## Files written

- [helpers.ts](/workspace/process/src/server/helpers.ts)
- [helpers.test.ts](/workspace/process/tests/src/server/helpers.test.ts)
- [Process.test.ts](/workspace/process/tests/src/server/Process.test.ts)
- [index.test.ts](/workspace/process/tests/src/server/index.test.ts)
- [process.md](/workspace/process/guides/process.md)
- [HANDOFF.md](/workspace/process/.orkestrel/process/HANDOFF.md)

## Red-then-green proof

The same focused command produced:

- Mutated candidate decision: exit **1**, exactly 1 named test failed.
- Restored implementation: exit **0**, 5 tests passed.

## Residue

The exact unproven Windows residue is:

- `killTree` through `taskkill.exe`.
- Grandchild tree termination through a live root.

Settling command on Windows:

```text
npx vitest run --config vite.config.ts --no-cache --project src:server
```

The pure tests prove the decisions, not Windows end to end.

## Validation

| Command | Exit |
|---|---:|
| `npm run lint` | 0 |
| `npm run format` | 0 |
| `npm run format:check` | 0 |
| `npm run lint:check` | 0 |
| `npm run check` | 0 |
| `npm run build` | 0 |
| Focused pure decision tests | 0 |
| Server barrel tests | 0 |
| Targeted guide parity | 0 |
| `npm run test:policy` | 0 |
| `npm run test:setup` | 0 |
| `npm test` | 1 |
| `npm run test:config` | 1 |
| `npm run test:guides` | 1 |

## Deviation

This executor denies nested child creation with `EPERM`. Consequently:

- `npm test`: 84 passed, 22 process-driving failures, 7 skipped.
- Config: 27 passed, 1 `spawnSync` failure.
- Guides: 51 passed, 4 process-driving failures.

Run `npm test` in an executor that permits child creation to settle the existing-suite criterion.

## Decisions

Public host-aware helper signatures remain unchanged. The new pure leaves accept explicit platform inputs. All 11 surviving conditional skips now name the unavailable API or host mechanism. The Q7 test remains unchanged, including its 400 ms timeout and readiness waits.