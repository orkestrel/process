# Process follow-up unit A — report, 2026-08-20

Every item landed. The three non-mutating gates and the scoped suites are green; no criterion was
left open and no deviation was raised.

## The pid surface

- src/core/types.ts:168-172 — `ProcessInterface` gains `pid: number | undefined`, `code:
  number | null`, and `signal: string | null`, leading the data block ahead of `emitter`.
- src/core/types.ts:157-164 — the interface `@remarks` states the eager-spawn fixing of `pid`, the
  permanent `undefined` for a spawn that produced no child, the survival past exit, the derivation
  `pid !== undefined && code === null && signal === null`, and the close-versus-exit distinction
  that makes `code` and `signal` reachable while `exit` is still pending.
- src/server/Process.ts:150-162 — the getters over the held child (`pid`, `exitCode`, `signalCode`).
- src/server/Process.ts:38-40 — the class remark names the same three members as direct reads of the
  spawned child.
- guides/process.md:177 — the `ProcessInterface` types row enumerates the new members.
- guides/process.md:202 — the surface-notes enumeration carries them.
- guides/process.md:404-417 — the termination section documents the members, the liveness
  derivation, the pid-reuse warning, the `process.kill(pid, 'SIGTERM')` route, and the POSIX negated
  id for the process group.
- guides/process.md:1002-1004 — the practices bullet on deriving liveness before addressing `pid`.
- guides/process.md:708 — the `Process` offering sentence names the pid again, truthfully.

### Proofs, red then green

Command, both runs: `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project
src:server tests/src/server/Process.test.ts`

- Red, before the getters existed: `Tests  5 failed | 30 passed | 1 skipped (36)`.
- Green, after: `Tests  35 passed | 1 skipped (36)`.

The five that ran red are tests/src/server/Process.test.ts:391 (`reports a host process id from the
moment construction returns and keeps it past exit`), :407 (`reports no process id for a spawn that
produced no child, and still settles exit`), :429 (`reports a null code and signal while the child
is live`), :443 (`reports the host terminal pair after the child exits`), and :457 (`reports the
terminal pair while a descendant holds the stdio and exit stays pending`).

### The spawn-fault observation

Node reports `pid === undefined`, `exitCode === null`, and `signalCode === null` the moment
construction returns on the spawn-fault path, so the brief's "pid undefined with `code` and `signal`
null" holds for the synchronous read. It does not hold after the fault settles: at the `close` event
the host writes the negative errno onto the child, so `child.code` becomes `-2` for `ENOENT` and
matches the code the `exit` promise carries, while `pid` stays `undefined` forever. The proof at
tests/src/server/Process.test.ts:407 pins both readings, and src/core/types.ts:170 and
guides/process.md:409-410 state the errno case rather than claiming a permanent `null`.

Test :457 also observed that the host records `exitCode` at the native exit while a descendant holds
the stdio open: `child.code` is `0` for a root that already exited while `child.exit` is still
pending. That is the reachable case the reconciliation used to choose `code` and `signal` over a
stored `exited` flag, so it is now under a test rather than under an argument.

## PR1 — the simultaneity fact

- src/server/helpers.ts:691 — "Windows ends the whole tree at once through `killTree`".
- guides/process.md:388 — "`taskkill /F /T` on the whole tree at once, with a direct kill after the
  utility reports failure."

The fix unit's other correction at that row and the guide:937 `now` repair both stay in place.
`rg -n "at once" guides/process.md src/server/helpers.ts` returns exactly those two lines.

## PR3 — README cancellation

README.md:14-17 now reads: "`Process` and `ProcessManager` expose typed `emitter` properties.
`Process`, `launch`, and `execute` take an `AbortSignal` that terminates the child; `executeSync`
and `detach` take none." Every consumer and every abstainer is named, and the shell sentence stands
on its own.

## F2 — read-once option ownership in `executeSync` and `detach`

- src/server/handlers.ts:224-238 — `executeSync` hoists `environment`, `workspace`, `input`,
  `timeout`, `strict`, and `limit` into locals before the first validator, as `execute` does at
  :62-69, and every later use reads the local.
- src/server/handlers.ts:296-299 — `detach` hoists `workspace` the same way.

Command, both runs: `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project
src:server tests/src/server/handlers.test.ts`

- Red, before the hoist: `Tests  2 failed | 1 passed (3)`. The `executeSync` proof reported the child
  running in `/tmp/orkestrel-test-wAYvfF` where the validated directory was
  `/tmp/orkestrel-test-a5kgcp`, and the `detach` proof found no marker in the validated directory.
- Green, after the hoist: `Tests  3 passed (3)`.

The proofs are tests/src/server/handlers.test.ts:38 (`runs the child in the workspace it validated`)
and :63 (`spawns the detached child in the workspace it validated`). Each drives a caller getter
that returns one scratch directory on its first read and another on every later read, then reads the
directory the child actually ran in — the child's own `process.cwd()` for the run, and a marker file
written to a relative path for the detached spawn.

## F3 — the invariant stated

- src/core/types.ts:293-295 — `ExecuteOptions` states that every option is read once before the
  child is spawned, so the value validated is the value spawned and a getter that throws strands no
  process, in the supervised tier's words.
- guides/process.md:571-573 — the one-shot section states the same for `execute` and `executeSync`.
- guides/process.md:711-712 — the detached-spawn section states it for `detach`, where the reader
  meets that function; the one-shot section is not its home.

## Gates and scoped evidence

- `npm run lint:check` → exit 0.
- `npm run check` → exit 0.
- `npm run format:check` → exit 0, "All matched files use the correct format." `npm run format` ran
  once before it; it re-padded the widened markdown tables and touched no file outside the owned set.
- `npm run test:src:server` → `Tests  119 passed | 7 skipped (126)`.
- `npm run test:src:core` → `Tests  3 passed (3)`.
- `npm run test:guides` → `Tests  98 passed | 1 skipped (99)`.
- `npm run test:policy` → `Tests  86 passed (86)`.

Observation, not a criterion: `npm test` reported `122 passed | 7 skipped (129)` for `test:src`,
`86 passed (86)` for `test:policy`, `28 passed (28)` for `test:config`, `98 passed | 1 skipped (99)`
for `test:guides`, and `5 passed (5)` for `test:setup`. `npm run build` was not run.

## Ancillary decisions

- `code` and `signal` sit immediately after `pid`, ahead of `emitter`, so the host-child facts read
  as one group.
- The pid contract prose sits in the guide's termination section, beside the negated-id note, rather
  than beside the pid-reuse sentence in the patterns section, which keeps a member's contract with
  the members and leaves the patterns sentence about driving the raw helpers untouched.
- No guide fence changed and none was added. `tests/guides.test.ts` transcribes every flagship fence
  and is not an owned file, so a fence edit would have obliged an edit outside the owned set.
- `Process` keeps its `#signal` field for the caller's `AbortSignal` beside the new `signal` getter.
  The option name fixes the field's name, and each carries its own TSDoc.
- Two comment paragraphs in src/server/Process.ts and src/server/helpers.ts were reflowed around the
  edited sentences; `stopChild` now reads "after the native exit is observed" where it read "after
  the child's native exit is observed".

## Claims of my own I flag

- The cross-platform readings are from Linux only. Tests :429 and :443 assert host-agnostic values (a
  null pair while live, and code `7` from a child that exits on its own), and :457 uses the same
  `orphan` fixture an existing test already drives on every host, so I expect no Windows-specific
  behaviour — but I did not run them on Windows.
- The `-2` errno in the spawn-fault observation is the Linux `ENOENT` value. The test asserts the
  sign and the agreement between `child.code` and `exit.code`, never the number.

## Review evidence

`git diff --stat`:

```text
 README.md                         | 11 ++---
 guides/process.md                 | 76 ++++++++++++++++++++-----------
 src/core/types.ts                 | 19 +++++++-
 src/server/Process.ts             | 26 ++++++++---
 src/server/handlers.ts            | 31 ++++++++-----
 src/server/helpers.ts             |  8 ++--
 tests/src/server/Process.test.ts  | 94 +++++++++++++++++++++++++++++++++++++++
 tests/src/server/handlers.test.ts | 53 +++++++++++++++++++++-
 8 files changed, 263 insertions(+), 55 deletions(-)
```

`git status --short`:

```text
 M README.md
 M guides/process.md
 M src/core/types.ts
 M src/server/Process.ts
 M src/server/handlers.ts
 M src/server/helpers.ts
 M tests/src/server/Process.test.ts
 M tests/src/server/handlers.test.ts
```

Deviation state: none raised. `handlers.ts` was neither renamed nor moved, and only the F2 lines
inside it changed.
