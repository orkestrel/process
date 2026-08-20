# Process readiness fix report

The unit closes PR1 through PR7, PR10, and PR11. The source checks and the non-spawning policy proof pass. The sandbox denied nested child spawns in the broad server and guide projects, as the brief anticipated.

## Findings

- PR1: Replaced the temporal `once` wording with ordered `after` wording in `guides/process.md:387`, `guides/process.md:936`, and `src/server/helpers.ts:691`. The remaining hits from `rg -n '\bonce\b' guides/process.md src/server/helpers.ts` are counts, iterator-use limits, the `ProcessChild.once` member, and native `.once(...)` calls. None is temporal prose.
- PR2: Corrected the destroy/refusal order in `src/core/types.ts:397` and `src/server/ProcessManager.ts:100`. Both contracts state that the synchronous `protocol` refusal occurs before the `destroy` barrier settles and that the barrier excludes the spawned child's asynchronous teardown.
- PR3: Replaced the every-tier claim in `README.md:14`. The README names the emitter-bearing tiers as `Process` and `ProcessManager`, and the `AbortSignal` consumers as `Process` and `execute`.
- PR4: Replaced the `guarantee` claim with the two checkable batch-path outcomes in `guides/process.md:453`.
- PR5 and PR11: Moved `execute`, `executeSync`, and `detach` from `src/server/helpers.ts` to `src/server/handlers.ts:57`, `src/server/handlers.ts:221`, and `src/server/handlers.ts:288`. The new file imports and constructs `Retention`; the leaf `helpers.ts` file imports no implementation class. `src/server/index.ts:3` star-exports `handlers.ts`, so the published names stay the same. The kind-file choice is `handlers.ts`: `.claude/rules/architecture.md:31` assigns request handlers to `*/handlers.ts`, while lines 84-89 require the `helpers.ts` leaf to remain class-free. No run entity or class was added.
- PR6: `src/server/handlers.ts:61` reads and retains all eight `ExecuteOptions` properties, including `signal`, before validation and spawn. `tests/src/server/handlers.test.ts:10` supplies a throwing `signal` getter and proves that no child marker appears.
- PR7: Every platform-conditioned row already names its mechanism in the adjacent comment or the test reason, so no row changed. The permitted sites and mechanisms are:
  - `tests/guides.test.ts:980`: libuv injects variables into an explicit Windows environment.
  - `tests/guides.test.ts:1173` and `tests/guides.test.ts:1180`: POSIX delegates lookup to host spawn; Windows resolves an absolute executable path.
  - `tests/src/server/helpers.test.ts:174`: Windows applies `PATH` and `PATHEXT`; POSIX delegates to `execvp`.
  - `tests/src/server/helpers.test.ts:202`: only Windows applies `PATHEXT` to an extension-bearing name.
  - `tests/src/server/helpers.test.ts:232`: only Windows searches the workspace before `PATH`.
  - `tests/src/server/helpers.test.ts:250`: non-Windows lookup belongs to `execvp`.
  - `tests/src/server/helpers.test.ts:311`: only the Windows batch path performs percent expansion.
  - `tests/src/server/helpers.test.ts:337`: only the Windows batch path passes a spaced script path through `cmd.exe`.
  - `tests/src/server/helpers.test.ts:536`: Windows uses `taskkill` by root process id; POSIX uses a process group.
  - `tests/src/server/helpers.test.ts:717`: the direct-child fallback depends on a negative process-group id returning `ESRCH`.
  - `tests/src/server/helpers.test.ts:731`: a real non-detached-child proof depends on POSIX process groups and negative process ids.
  - `tests/src/server/helpers.test.ts:1208`: detachment and group-directed `SIGINT` depend on POSIX process groups.
  - `tests/src/server/Process.test.ts:227`: cooperative `SIGTERM`, the grace window, and `SIGKILL` escalation are POSIX mechanisms.
  - `tests/src/server/Process.test.ts:315`: Windows grandchild termination uses `taskkill /T` by tree id.
  - `tests/src/server/Process.test.ts:342`: POSIX grandchild termination uses a process group addressed by a negative pid.
- PR10: Removed the unsupported pid offer from `guides/process.md:686`. The sentence offers the streams, events, and bounded stop that `ProcessInterface` exposes.

No additional claim is flagged.

## Regression proof

The same command ran red before the implementation and green after it:

```text
npx vitest run --config vite.config.ts --no-cache --project src:server tests/src/server/handlers.test.ts
```

- Red: exit 1; 1 test file failed, 1 test failed. The getter error was returned, but `existsSync(marker)` was `true` instead of `false`, proving that the child had run.
- Green: exit 0; 1 test file passed, 1 test passed.

## Verification

- `npm run lint:check`: exit 0.
- `npm run check`: exit 0. The root, core, and server TypeScript checks passed. This also validated the unchanged server barrel surface.
- `npm run format:check`: exit 0 after `npm run format`; all 134 matched files passed.
- `npm run test:policy`: exit 0; 1 file and 86 tests passed.
- The export-set comparison below exited 0 with no diff. It compares the baseline helper function exports against the functions in the split `helpers.ts` and `handlers.ts` files:

```text
diff -u <(git show HEAD:src/server/helpers.ts | rg -o --pcre2 '^export (?:async )?function \K\w+' | sort) <(rg -o --pcre2 '^export (?:async )?function \K\w+' src/server/helpers.ts src/server/handlers.ts | sed 's/.*://' | sort)
```

- `rg -n '\bguarantee\b' guides/process.md`: exit 1 with no output.
- `rg -n 'the pid' guides/process.md`: exit 1 with no output.
- `rg -n 'Retention' src/server/helpers.ts`: exit 1 with no output.
- `rg -n '^export (async )?function (execute|executeSync|detach)' src/server/helpers.ts`: exit 1 with no output.
- `git diff --check`: exit 0.

The broad scoped runs reached the sandbox's nested-spawn restriction:

- `npm run test:src:server`: exit 1; 2 files failed, 3 passed, 22 tests failed, 90 passed, and 7 skipped. The output reports `spawnSync /opt/node22/bin/node EPERM`; spawn-dependent output assertions and waits then failed. This is a sandbox-denial observation for the host run.
- `npm run test:guides`: exit 1; 1 file failed, 9 tests failed, 89 passed, and 1 skipped. The output reports `spawnSync /opt/node22/bin/node EPERM`; the remaining failures are spawn-dependent output assertions and waits. The earlier missing-test inventory failure was repaired by listing `tests/src/server/handlers.test.ts` in `guides/process.md:1033` and did not recur.

## Git status

```text
 M README.md
 M guides/process.md
 M src/core/types.ts
 M src/server/ProcessManager.ts
 M src/server/helpers.ts
 M src/server/index.ts
?? src/server/handlers.ts
?? tests/src/server/handlers.test.ts
```

## Diffstat

```text
 README.md                    |  10 +-
 guides/process.md            |  16 +--
 src/core/types.ts            |   5 +-
 src/server/ProcessManager.ts |   5 +-
 src/server/helpers.ts        | 293 +------------------------------------------
 src/server/index.ts          |   1 +
 6 files changed, 25 insertions(+), 305 deletions(-)
```
