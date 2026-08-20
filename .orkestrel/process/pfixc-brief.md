# PFIX-C: close the cross-engine audit, starting with a rule the dispatcher overrode

## Role and engine

Role `sol` implementer. Engine GPT-5.6 Sol, high effort, sandbox `workspace-write`, rooted at
`/workspace/process`. Sole writer for this unit.

## Objective

An Opus 5 lane audited the fixes Sol wrote here and returned FAIL. Close its findings before 0.0.4
publishes.

## Read first

1. `AGENTS.md` — § Non-negotiable rules and § Design laws especially
2. `.claude/rules/typescript.md`, `.claude/rules/tests.md`, `.claude/rules/documentation.md`,
   `.claude/rules/writing.md`, `.claude/rules/quality.md`
3. `guides/process.md`
4. `.orkestrel/process/paudit2-brief.md` — the claims that produced these findings

## A1 — `CaptureCounts` breaks a rule stated as ALWAYS, and the dispatcher told the last unit to

`src/server/types.ts` declares `delivered: number` and `retained: number` without `readonly`.
`AGENTS.md` § Non-negotiable rules: "**ALWAYS** make interface properties and public return
collections readonly." There is no exception clause. `.claude/rules/typescript.md`: "Never mutate
caller-owned inputs."

The previous brief instructed the writer to make them mutable and to document the departure in one
sentence. That instruction was wrong: a TSDoc remark cannot create an exception to a rule stated as
ALWAYS. These are the only non-`readonly` interface properties in `src/`; every other public
property in this package, including each member of the neighbouring `ProcessChild`, is `readonly`.

The justification is also unmeasured. The remark claims mutability avoids "allocating for each
delivered chunk", and no measurement is cited. `.claude/rules/writing.md` § Claims and time requires
the run behind every number and forbids an effort adjective as a behaviour claim.

**Ruled: replace the record with a `Retention` sub-entity.** `AGENTS.md` § Design laws names this
remedy — where a shape does not fit, extract a sub-entity. A `Retention` holding `#delivered` and
`#retained` behind readonly accessors, with a `retain(chunk, limit)` method, satisfies the readonly
rule, the caller-owned-mutation rule, and the single-word entity API at once, and allocates once per
stream rather than once per chunk.

**The name is `Retention`, not `Capture`, and this is not negotiable.** `AGENTS.md` § Non-negotiable
rules requires inspecting the declared and installed `@orkestrel/*` capabilities before implementing
overlapping logic. `@orkestrel/console` publishes a `Capture` **class** — an observable console
interceptor — plus `CaptureInterface`, `CaptureOptions`, `CaptureLevel`, `CapturedMessage`,
`CaptureResult`, `createCapture`, and `withCapture`, and its server face publishes `ProcessCapture`
with `CapturedChunk` and a bounded `limit`. Those are a different concept, and the word is taken
across the fleet. Two published `@orkestrel` packages must not export a class of the same name
meaning different things.

`Retention` is this package's own established vocabulary: `guides/process.md` already speaks of a
retention bound, and says a `Process` omits `lines` past one. Name the interface
`RetentionInterface`, the class `Retention`, and put the class in `src/server/Retention.ts`.

**A previous run of this unit was stopped mid-implementation**, after it had written
`src/server/Capture.ts` and `tests/src/server/Capture.test.ts` and begun editing
`src/server/types.ts`, `src/server/helpers.ts`, `src/server/index.ts`, `guides/process.md`, and
`tests/src/server/helpers.test.ts`. That work is in your tree and its **shape is correct** — `#`
fields, readonly accessors, and a `retain` returning the retained slice. Only the name is wrong.

Carry it forward rather than starting over: rename the files, the class, and the interface, finish
what the stop interrupted, and leave no `Capture` identifier behind. Read the tree before you plan;
it is not the committed state.

## A2 — the refusal list can rot

`tests/guides.test.ts` declares `REFUSALS` and asserts no name of a neighbouring face appears in a
face's published surface. That can now fail — the previous round proved it with a plant. But nothing
ties a member of `REFUSALS` to the neighbouring face's **actual** surface. Add a server export
tomorrow: guide parity forces it into the Surface table, `REFUSALS` is never consulted, and the new
name sits outside the neighbouring-face check permanently.

The same file already knows the cure and applies it twice. `INTERNAL` carries an assertion and a
TSDoc line saying the assertion "fails when a name here stops being stranded, so the list cannot
rot", and `UNLISTED_TESTS` says the same. `REFUSALS` got neither.

Assert each face's refusal list equals the **neighbouring** face's published surface, minus any name
both faces legitimately publish, listed explicitly beside it. Keep the expectation independent of the
asserted face's own parse — that independence is what stopped the row being tautological — and give
`REFUSALS` the anti-rot TSDoc its siblings carry.

## A3 — an assertion that cannot fail

In the abort-listener row, the assertion that the listener count is zero **after** `controller.abort()`
cannot report anything the assertion before it did not: the count was already established as zero,
and aborting adds no listener. Delete it, or make it prove something the earlier line does not —
registering a second child on the same controller and observing that abort drives only the live one.

## A4 — the release gate turns on an environment value nothing asserts

`tests/distribution.test.ts` branches on `import.meta.env.MODE === 'release'`. That value is
`'release'` only because the `test:distribution` script appends `-- --mode release`; the same file
runs from `npm test` with no mode. If that argument stops reaching Vitest — a flag rename, a script
edit, an argument-forwarding change — the branch silently substitutes a `tar` extraction for the
install, and the file's own comment states what that costs: extracting proves the tarball unpacks and
says nothing about whether a consumer can install it. The gate stays green and the assertion it
exists for stops running.

Assert the mode. The auditor's exact remedy: make `expect(import.meta.env.MODE).toBe('release')` the
file's first assertion under the release path, then run it both ways and confirm the readings differ.

## A5 — a duration-bounded guarantee nothing binds or drives

`guides/process.md` states that the barrier does not cover the child's asynchronous teardown, "which
finishes within `grace` plus the confirmation window". That is a behavioural claim with a stated
bound, and no row binds or drives it. The `describe` block it belongs to declares its own discipline:
each row binds the sentence and then drives the behaviour it claims, because a sentence about
behaviour passes every parity assertion whether or not it is true.

The nearest source row proves the residual only on Windows; its POSIX branch says of itself that a
change which stopped spawning the child would also pass it, and its flag is initialised true and
never reassigned there.

Either add a row that binds the sentence and drives the residual within its stated bound, or remove
the duration claim and keep only what is proved. Rule and say which you took.

## Scope

- **Owned:** `src/server/Retention.ts` (**new file — create it**), the stopped run's
  `src/server/Capture.ts` and `tests/src/server/Capture.test.ts` (**rename them**),
  `src/server/types.ts`,
  `src/server/helpers.ts`, `src/server/index.ts`, `guides/process.md`, `tests/guides.test.ts`,
  `tests/distribution.test.ts`, and every test file under `tests/src/`, including a new
  `tests/src/server/Retention.test.ts`.

  *Amended: a first run stopped here, correctly. The `Capture` ruling requires a class, and
  `.claude/rules/architecture.md` puts a class in its own implementation file — which the owned list
  omitted, while `types.ts` may hold only types and `helpers.ts` only pure helpers. Both paths are
  now granted. The interface still goes in `types.ts` first, per TTTDD.*
- **Off-limits:** every other file. The vendored host — `AGENTS.md`, `CLAUDE.md`, `.agents/`,
  `.claude/`, `.codex/`, `.cursor/`, `configs/helpers.ts`, `scripts/*.sh`, `tests/config.test.ts`,
  `tests/policy.test.ts`, `tests/setupPolicy.ts` — is owned by `@orkestrel/scaffold`.
  `vite.config.ts` is scaffold-planned. In `package.json` you own the `test:distribution` script only
  if A4 requires it, and nothing else. Do not change the version.

## Host conditions

- The tree is committed and clean at `891f875`. Untracked `tmp/` files are expected.
- **Your sandbox denies child execution, a loopback listener, a nested install, an `rm -rf`, and a
  write to `.agents/`.** The `src` and `guides` projects both carry rows that spawn children and fail
  inside it with `spawnSync ... EPERM`. Never work around a denial and never change a test to suit
  your sandbox. Report each denied reading as an observation naming the exact command; the
  Orchestrator takes it on the host, where every gate was green before this unit.
- Use `rmdir` for an empty directory and `rm -f` for a single file.
- The network is unavailable. Do not install or fetch.
- Do not run `npm run build`, tree-wide `npm run format`, or the whole `npm test`.

## Execution

Perform this assignment directly. Spawn nothing.

## Prohibitions

- Never run `git checkout`, `git restore`, `git stash`, `git reset`, or `git clean`.
- Never commit, push, install, or read a credential.
- No `any`, no `as`, no `!`, no `@ts-ignore`, no `@ts-expect-error`, no `eslint-disable`.
- No mocks, behavioral fakes, module replacement, or framework spies.
- State no count in any prose you write, and never name a list item by its position.
- Never write a `readonly`-free property on a public interface. That rule is the reason this unit
  exists.

## Acceptance criteria

Close them in this order and report each with its exit code and counts.

1. `rg -n '^\s+(delivered|retained): number' src/` returns no hit, and no public interface in `src/`
   declares a property without `readonly`.
1b. `rg -n 'Capture' src/ tests/ guides/process.md README.md` returns no hit. The word belongs to
   `@orkestrel/console` and must not appear in this package's surface.
2. A permanent test proves the new capture shape accumulates delivered and retained totals correctly
   across a truncating stream. Record red-then-green.
3. The refusal-list anti-rot assertion fails against a planted neighbouring-face export and passes
   without it. Record both readings and the exact plant-and-remove steps.
4. `expect(import.meta.env.MODE)` is asserted in `tests/distribution.test.ts`, and the two invocations
   report different values. Record both, or report as a denied observation with the exact host
   command.
5. `npm run lint:check` exits 0.
6. `npm run check` exits 0.
7. `npx vitest run --config vite.config.ts --project src:core` exits 0. Report its counts.

Report the `src` and `guides` projects as **observations**, never as criteria.

## Deviation contract

Stop and report if the objective itself conflicts with what you find: expected, found, exact
evidence, done or not done, and at most one short hypothesis. An ancillary choice — a method's
parameter order, a test's name — is yours. The `Capture` sub-entity ruling is not ancillary: a
conflict with it stops the unit.

## Output

Write your report to `tmp/codex/pfixc-report.md` and make it your final message too: files touched
and what changed; the new entity's declaration; your ruling on A5; red-then-green readings; the exact
plant-and-remove steps; each criterion with its exit code; an **Observations** section for every
denied reading with its host command; and anything you could not close. No process diary.
