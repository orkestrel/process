Implemented PC2 directly without delegation.

### Rows closed

- Q1: Teardown retains at most 2 × `backlog`, drops excess lines without pausing stdout, and exposes omissions through `Process.truncated`. See [Process.ts](/workspace/process/src/server/Process.ts:177) and [types.ts](/workspace/process/src/core/types.ts:109).
- Q1b: Corrected the stale overshoot claim in [HANDOFF.md](/workspace/process/.orkestrel/process/HANDOFF.md:77).
- Q7: Documented that `runSync` timeouts end only the root process. `run` and `Process` remain the tree-terminating paths. See [process.md](/workspace/process/guides/process.md:341).
- Q8: Ruled that `input` is stdin payload and accepts NUL. `runSync` now converts string input to bytes, avoiding its prior `Unknown encoding: buffer` failure. See [helpers.ts](/workspace/process/src/server/helpers.ts:927).

The 2 × cap reserves one ordinary backlog budget and one teardown-drain budget. Existing excess is trimmed before stdout resumes. Later lines are dropped. The reader is never paused again.

### Files written

- [types.ts](/workspace/process/src/core/types.ts)
- [Process.ts](/workspace/process/src/server/Process.ts)
- [helpers.ts](/workspace/process/src/server/helpers.ts)
- [process.md](/workspace/process/guides/process.md)
- [HANDOFF.md](/workspace/process/.orkestrel/process/HANDOFF.md)
- [Process.test.ts](/workspace/process/tests/src/server/Process.test.ts:248)
- [helpers.test.ts](/workspace/process/tests/src/server/helpers.test.ts:635)
- [child.mjs](/workspace/process/tests/src/server/fixtures/child.mjs)
- [guides.test.ts](/workspace/process/tests/guides.test.ts:352)

The unrelated `.orkestrel/process/pc3-brief.md` change was present during the assignment and remains untouched.

### Red-then-green evidence

Documentation assertions ran red before the guide changes: 7 failed and 48 passed, including the 3 intended contract failures. After repair:

- Q1/Q7 assertions: 2 passed, exit 0.
- Q8 assertion: 1 passed, exit 0.

Behavioral red/green runs cannot complete in this sandbox. Nested `spawn` and `spawnSync` calls return `EPERM`, as the brief anticipated. The focused pre-fix runs reported:

- `Process.test.ts`: exit 1, 14 failed, 16 passed, 1 skipped.
- `helpers.test.ts`: exit 1, 9 failed, 46 passed, 8 skipped.

Those counts are sandbox evidence, not valid defect proof. Run this on the host to settle Q1, Q7, and Q8:

```text
npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:server tests/src/server/Process.test.ts tests/src/server/helpers.test.ts
```

### Validation

- `npm run format:check`: exit 0.
- `npm run lint:check`: exit 0.
- `npm run check`: exit 0.
- `npm run check:src:server`: exit 0.
- `npm run build`: exit 0.
- `npm run test:src:core`: exit 0, 3 passed.
- `npm run test:policy`: exit 0, 86 passed.
- `npm run test:config`: exit 1, 27 passed and 1 `spawnSync ... EPERM` failure.
- `npm test`: exit 1; its `test:src` stage reported 79 passed, 23 failed, and 9 skipped under the same child-creation denial.

No scope deviation occurred. Only the authorized contract-item-3 section of `HANDOFF.md` changed.