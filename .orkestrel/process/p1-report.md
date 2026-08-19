Implemented all seven repairs. The static acceptance gates pass. Full spawned-child verification remains blocked because this executor denies nested child creation with `EPERM`.

### Repairs

1. Removed forced exits from the `chatty` and `empty` fixtures. Direct pipe probes returned 4,096 and 50,000 lines.
2. Added the `trapped` readiness marker and made the escalation test wait for it.
3. Replaced the POSIX zombie probe with a 100 ms pipe-release race.
4. Routed the `stopChild` boundary through `child.kill` by setting its pid to `undefined`.
5. Kept protocol and count assertions unconditional. Windows retains the pid proof; POSIX checks marker absence.
6. Corrected isolated-environment guidance and changed the fence to `process.execPath`.
7. Added the `ESRCH` fallback, documentation, and regression proof in [helpers.ts](/workspace/process/src/server/helpers.ts:507).

### Files written

- [process.md](/workspace/process/guides/process.md:352)
- [helpers.ts](/workspace/process/src/server/helpers.ts:507)
- [guides.test.ts](/workspace/process/tests/guides.test.ts:404)
- [Process.test.ts](/workspace/process/tests/src/server/Process.test.ts:226)
- [ProcessManager.test.ts](/workspace/process/tests/src/server/ProcessManager.test.ts:150)
- [child.mjs](/workspace/process/tests/src/server/fixtures/child.mjs:52)
- [helpers.test.ts](/workspace/process/tests/src/server/helpers.test.ts:428)

The pre-existing `package-lock.json` change remains untouched. No other `src/` file changed.

### Red-then-green proofs

- Repair 4: 1 failed → 1 passed.
- Repair 5: 1 failed → 1 passed.
- Repair 7 fallback: 1 failed → 1 passed.
- Repair 6: pre-change failed with `ENOENT`; post-change reaches the absolute executable but the sandbox returns `EPERM`.
- Repairs 1–3: the retained unrestricted POSIX run supplies valid red evidence. Post-change spawned tests cannot run validly in this sandbox. The direct fixture probes pass.

### Validation

- `npm run format:check`: exit 1 before formatting → exit 0.
- `npm run lint:check`: exit 1 before conditional-assertion cleanup → exit 0.
- `npm run check`: exit 0.
- `npm run build`: exit 0.
- `npm run test:policy`: exit 0, 86 passed.
- `npm run test:src`: exit 1; nested child creation is denied, producing 18 cascading failures.
- `npm run test:config`: exit 1; 27 passed, 1 explicit `spawnSync ... EPERM`.
- `npm run test:guides`: exit 1; 48 passed, 3 spawn-dependent failures.
- Built-artifact `killProcess` fallback probe: exit 0, delivered `SIGTERM`.

### Coverage and limits

Repair 4 removes the Windows `killTree` branch from that specific `stopChild` test.

Repair 5’s POSIX branch proves only that the marker stays absent during the bounded window. A change that prevented spawning would also pass it.

No scope deviation occurred. The only incomplete acceptance evidence is spawned-child execution under the sandbox restriction.