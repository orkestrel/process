# PC4 — a gate over the published artifact, and the prose that ships with it

## Role and engine

`sol` (GPT-5.6 Sol), direct `codex exec`. Perform the assignment directly and spawn nothing.

## Why this unit

Six rows of `.orkestrel/process/readiness-grade.md`, all consumer-facing. Read the grade first, then
`HANDOFF.md`, and reopen no settled ruling there.

The audit's own summary of what the gates do not see: **every defect in this package passed
`format:check`, `lint:check`, `check`, `build`, and `npm test`.** Row Q13 is the structural reason —
nothing loads the artifact a consumer installs.

Its sibling package had the same hole. Closing it there immediately exposed a real defect that all six
green gates had shipped past.

## The repairs

### Q13 — no proof runs against the built artifact

`tests/config.test.ts:412-419` **already asserts** a `test:distribution` script exists. Build the whole
row:

- `tests/distribution.test.ts`;
- the exact `test:distribution` script that assertion requires;
- `prepublishOnly` includes it;
- the `distribution` Vitest project — add the proof file and the script, then let
  `scaffold overwrite` generate the project. Do not hand-write it into `vite.config.ts`.

The test packs the package, installs the tarball **outside this repository**, and asserts:

1. every `exports` target exists;
2. both entries load under **both** `import` and `require`;
3. each entry's runtime export set equals its `.d.ts` value-declaration set — the audit counted
   **13 core, 29 server**, so verify those counts rather than trusting them;
4. one real call per entry returns the documented value.

**A negative control is required and must be seen to fail** before you trust the instrument — an
assertion that a deliberately absent export path resolves, for instance. Report what it proved.

**Learn from the sibling's mistake.** Its distribution test linked the peer dependencies only inside
its extraction fallback — the branch that runs where a nested install is denied. On a host where the
real install succeeds, that branch never ran, the consumer had no toolchain, and the test failed for a
reason the sandbox could never show. If you write a fallback path, whatever it sets up, the real path
must set up too.

Your sandbox denies nested `npm install` with `EPERM`, so you will likely only exercise the fallback.
Say so plainly and name the settling command; the Orchestrator runs the real install on the host.

### Q9 — `quoteArgument`'s `%1` claim is false

`guides/process.md:396` and `src/server/helpers.ts:252-253` state `%` is in the quoted set. It is not.
Make the statement true or make it accurate — decide which, and say why. `tests/guides.test.ts`
asserts `quoteArgument('%1')` beside the existing `a&b` row.

This matters more than a prose fix: the percent-sign rule is what keeps "arguments are data, never
syntax" true for a batch target, and `HANDOFF.md` records that refusal as attacker-proven.

### Q10 — `isolated`'s own declaration omits the constraint that breaks it

`src/core/types.ts:38` and `ProcessCommand`'s `@remarks` must state both host qualifications: on POSIX
`isolated: true` leaves **no `PATH`**, so a bare command cannot resolve — pass an absolute file or
include `PATH` among the overrides; on Windows libuv injects a host set regardless.

A consumer hovering the option in an editor reads the declaration, never the guide. This is the same
defect that made the guide's own fence throw `ENOENT` on Linux.

### Q11 — a spawn fault's exit code is undocumented and the runners disagree

`ProcessExit.code` and the `RunResult` prose must state that a spawn fault yields the host's negative
errno on `Process` and `run`, and `null` on `runSync`. The "Where the two runners differ" table gains
that row, and `tests/guides.test.ts` transcribes both codes.

### Q12 — a supervised child survives the supervisor's abrupt death

The guide and `ProcessOptions`' remarks must state that POSIX detachment is what makes group
termination possible, that a child therefore **survives the parent's `SIGKILL`** and does not receive
the terminal's `SIGINT`, and that the consumer must call `stop` or `destroy` on shutdown. The parity
test covers the statement.

### Q14 — the `/server` subpath has no types under `moduleResolution: node10`

`README.md` § Requirements states the supported `moduleResolution` floor — `node16`, `nodenext`, or
`bundler` — and the parity gate asserts that statement.

**Do not add `typesVersions`.** The audit ruled against it: the mode is deprecated in TypeScript 6 and
removed in 7, so the workaround would outlive its own subject.

## Standing conditions

- `waitForCondition` exists in `tests/setup.ts`. Use it for any wait; never a fixed delay for something
  another process produces, and never `Date.now()` for a deadline.
- The sandbox denies nested child creation and nested `npm install` with `EPERM`. Record what you
  cannot run with its settling command; never substitute a weaker instrument.

## Scope

Owned: `tests/distribution.test.ts` (new), `package.json`, `guides/process.md`, `README.md`,
`src/core/types.ts`, `src/server/helpers.ts`, `tests/guides.test.ts`, and matching files under
`tests/src/`.

Off-limits: `vite.config.ts` (scaffold generates it), `.orkestrel/`, `src/server/Process.ts`.

## Execution

Perform this assignment directly. Spawn nothing.

## Acceptance criteria

1. `npm run format:check`, `npm run lint:check`, and `npm run check` each exit 0.
2. `tests/distribution.test.ts` exists, `tests/config.test.ts` passes including its existing
   `test:distribution` assertion, and `prepublishOnly` includes it.
3. The distribution test's negative control was seen to fail, and its result is reported.
4. Q9 through Q12 each close with a guide statement and a parity assertion.
5. Q14's requirement is stated in `README.md` and asserted by the parity gate, with no `typesVersions`.

**`npm run build` and the test projects are observations, not criteria.** Report every command's
**bare** exit code; a pipe masks it.

## Deviation contract

Stop and report if a repair needs a file you do not own, if the export-set comparison cannot be made
without changing a published surface, or if Q9's decision would change behaviour rather than prose.
Test structure, prose, and the fallback's shape are yours.

## Output

**Per numbered row: what changed and why**, **The Q9 decision and why**, **The export counts you
measured**, **The control and what it proved**, **Files written**, **Red-then-green proofs**,
**Validation** (each gate, bare exit code), **What you could not run and its settling command**,
**Deviation**, **Decisions**. No process diary.
