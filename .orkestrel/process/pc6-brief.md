# PC6 — one shape for one concept, and the handoff dissolved

## Role and engine

`implementer` (Claude Opus 5, native). Perform the assignment directly and spawn nothing.

Every row here is a shape or a sentence: what a mechanism is called, where it lives, how many copies of
it exist, and whether the prose beside it is true. That is the subjective engine's work. The writer is
on the Orchestrator's engine, so this unit's audit lane is **Sol**.

## Prerequisite

Unit PC5 lands before this one starts. It owns `tests/distribution.test.ts`,
`tests/src/core/index.test.ts`, `tests/src/server/Process.test.ts`, `tests/setup.ts`, and parts of
`tests/guides.test.ts` and `guides/process.md`. Read the tree, not the diff you expect.

## Context

Repository `/workspace/process`, `@orkestrel/process` 0.0.4, unpublished; 0.0.3 is on the registry.

Read before editing: `AGENTS.md`; `.claude/rules/names.md`, `.claude/rules/architecture.md`,
`.claude/rules/typescript.md`, `.claude/rules/tests.md`, `.claude/rules/documentation.md`,
`.claude/rules/writing.md`; `guides/process.md`; and `.orkestrel/process/pc-audit-reconciliation.md`,
which is where every row below came from and carries the evidence for each.

The two-lane audit of PC1-PC4 returned FAIL from both lanes. These are its subjective findings.

## The rows

### 1. The command snapshot is four verbatim copies

`src/server/helpers.ts:827-840`, `:988-1001`, `:1068-1081`, and `src/server/Process.ts:107-120` are the
same fourteen-line block, differing only in a local name. It is the package's input contract — the
thing this campaign repaired — and a reader meets it four times with no single place that defines it.

`AGENTS.md` § TTTDD step 3 and § Design laws "Export and test reusable logic". Extract one exported
pure leaf in `helpers.ts`, export it through the server barrel, document it in the guide's command
helpers table, and test it once. Name it for what it does; the audit suggested `snapshotCommand` and
you may improve on that.

### 2. `waitForExit` reads a member its own contract does not declare

`src/server/helpers.ts:697-704` removes its exit listener through
`if (!('off' in child)) return` plus `isFunction` plus `Reflect.apply`. The parameter type is
`Pick<ProcessChild, 'exitCode' | 'signalCode' | 'once'>`, and `src/server/types.ts:20-42` declares four
members, none of them `off`, under the remark that each helper takes the slice of this contract it
reads.

So a caller conforming exactly to the published contract leaks a listener on every deadline, silently.
The existing proof only passes because it uses a real `EventEmitter`, which carries `off` by accident.

Declare `off` on `ProcessChild`, widen the `Pick`, reduce the machinery to a plain call, correct the
"same four members" remark, and add a case driving a minimal object that implements exactly the
declared contract.

### 3. The guide promises a losslessness the cap removed

`guides/process.md:894-895` says the backlog pauses stdout and "pausing is what makes the consumer
lossless". `src/server/Process.ts:284` drops lines once `#terminating` is true, regardless. The bullet
immediately above tells the reader to check `truncated`, so two adjacent bullets disagree about the
same guarantee.

This is the campaign's own subject reintroduced one bullet lower. Qualify both — the guide's, and the
one in `HANDOFF.md` if it still exists when you start — and extend the assertion that already binds
"twice `backlog`" so the qualification is gated rather than stated.

### 4. Q16 — struck, closed by PC5

`pc-audit-reconciliation.md` routed Q16 here while `pc5-amendment.md` kept it in PC5's criteria. PC5
found the conflict and implemented it: `guides/process.md:355` now names both routes, and the executed
binding is PC5's Q15 test, which drives the direct fallback the row names. Do not repair it again.

This row stays numbered so the reconciliation's carrier table still reads.

### 5. The Tests section omits the two proofs this campaign added

`guides/process.md:937-957` lists six files and omits `tests/distribution.test.ts` and
`tests/setup.test.ts`. The distribution proof is the only thing that loads the artifact a consumer
installs, and the guide's own inventory of what is proven does not mention it. Add both rows; say for
the distribution row that it packs, installs outside the repository, and compares runtime exports
against the compiler-parsed declarations.

### 6. `tests/setup.test.ts` splits one import and carries a case that proves nothing

Lines 2-3 import twice from `@orkestrel/test`. The case at `:75-78` asserts
`typeof waitForCondition === 'function'`, trivially true once the module typechecks, and a property of
`captureError`, which is a dependency's behaviour under this package's name. Merge the imports; delete
that case and the import it exists for. The five preceding cases cover the helper.

### 7. `ProcessErrorCode`'s members are re-listed by hand inside the guard

`src/core/types.ts:441` declares the five codes. `src/core/errors.ts:60-66` re-lists the same five as a
hand-written disjunction. Adding a sixth code compiles cleanly and makes `isProcessError` return
`false` for a genuine `ProcessError` carrying it — the class of defect Q4 closed, through a second
door.

Declare the frozen tuple in `src/core/constants.ts`, derive the union from it in `types.ts`, and have
the guard test membership against the tuple. Prove that a code added to the tuple is admitted by the
guard with no second edit.

### 8. The brand's `@remarks` overstates what it survives

`src/core/errors.ts:36-39` says the brand "survives duplicate installations". A `0.0.3` copy carries
no brand, so the guard returns `false` for an error it throws — and a `0.0.3` copy is installed in this
very tree as a transitive dependency of `@orkestrel/scaffold`. The fix is not a regression, because
`instanceof` also returned `false`; the sentence is what is wrong. Name the boundary: the brand is
recognized across copies at 0.0.4 or later.

### 9. `truncated` carries two meanings on two public surfaces

`src/core/types.ts:161-162` documents it as the `lines` stream omitting output after a retention
bound; `:209-211` documents it as a stream exceeding `limit`. `AGENTS.md` § Design laws: one concept,
one term. Rule which meaning each surface carries and make the two sentences say so, or rename one.
Do not leave a reader to discover that one word means two things.

### 10. Eleven test names trade the subject for the applicability condition

`tests/src/server/Process.test.ts:228` is now "escalates when process groups accept SIGTERM before
SIGKILL", which names the platform condition rather than the trapped `SIGTERM` the test drives.
`.claude/rules/tests.md` requires a test named for what it proves. Rename them for their subject, and
carry the applicability in the skip condition where it belongs.

### 11. Four contracts PC1 established that the guide never stated

`pc1-report.md:69` names them and points at a later documentation unit that no brief ever became. The
carry check records them with no carrier. Each is behaviour a consumer meets:

- Validation snapshots the command once; the object validated is the object spawned.
- `destroy` removes its abort listener.
- `waitForExit` releases its exit listener.
- `isProcessError` recognizes an error thrown by another copy of the package, by brand rather than by `instanceof`.

State each in `guides/process.md`. The fourth carries the boundary row 8 names: recognition holds
across copies at 0.0.4 or later.

## Dissolve `HANDOFF.md`

`.agents/orchestration.md` § Before you prune, check 4: a cross-session orientation document is not a
category of its own. Delete `.orkestrel/process/HANDOFF.md` and route its parts.

| Section | Disposition |
| ------- | ----------- |
| What 0.0.3 is; the 0.0.2 → 0.0.3 delta | Narrative and release history. The git log holds both. Drop. |
| The behavioral contract 0.0.3 established | Product truth, each already carrying a pinning test. Add to the guide only what the guide does not already say. |
| Rulings a future audit must not re-litigate | Product truth where it states a boundary a consumer meets. The guide already carries the `%` refusal, Job Objects, `truncated` covering both streams, and `lines` single-consumer. Add what is missing; the rationale stays in the commit that made each decision. |
| Look out for, items 2-9 and 11 | Rule on each: in the guide already, added, or dropped with the reason in your report. |
| Look out for, item 1 — the Windows residue | Cannot close on this host. Report it as an explicit drop with its exact settling command. Do not put a verification-host history into the guide. |
| Look out for, item 10 — adopter republish states | Live state. Drop with no promotion. |
| Verification map | Derivable from `package.json` scripts and the test tree. Drop. |
| Upstream adopters; post-republish recipe | Live state, and a procedure the publishing contract owns. Drop. |

## Standing conditions

- Nested child creation works on this host. Take every measurement.
- `tests/setup.ts` exports `waitForCondition`. Use it rather than a fixed delay when waiting on another process.
- Do not edit any file under `.agents/`, `.claude/`, or `configs/`. Those are vendored and `repair` reverts an edit there. `tests/config.test.ts` is vendored: if a change of yours needs it, stop and report rather than editing it.

## Scope

**Owned:** `src/core/types.ts`, `src/core/errors.ts`, `src/core/constants.ts`, `src/server/types.ts`,
`src/server/helpers.ts`, `src/server/Process.ts`, `src/server/index.ts`, `guides/process.md`,
`tests/guides.test.ts`, `tests/setup.test.ts`, `tests/src/server/helpers.test.ts`,
`tests/src/server/Process.test.ts`, `tests/src/core/index.test.ts`, and
`.orkestrel/process/HANDOFF.md` (deletion only).

**Off-limits:** everything else, including `package.json`, `vite.config.ts`, `README.md`, every
vendored path, and every other file in `.orkestrel/`.

**Tools:** read, write, and run commands inside `/workspace/process`. Do not commit, push, install a
dependency, or run a destructive command.

## Execution

Perform this assignment directly. Spawn nothing.

Insert a failing proof before each repair that changes behaviour or a gated statement: record the exact
command and its failing count, implement, then record the same command green. A pure rename needs no
red proof; say so rather than inventing one.

## Acceptance criteria

Ordered so an unreachable criterion cannot hide the ones behind it.

1. Exactly one command-snapshot implementation exists, exported, documented, and tested once.
2. `ProcessChild` declares every member the helpers read, and a minimal object implementing exactly that contract releases its listener.
3. Rows 3 and 5 through 11 are each reported repaired with a `file:line`, or reported closed with the line that closes it. Row 4 is struck.
4. `HANDOFF.md` is deleted, and every statement worth keeping is in `guides/process.md`.
5. `npm run format:check` exits 0.
6. `npm run lint:check` exits 0.
7. `npm run check` exits 0.
8. `npm run build` exits 0.
9. `npm test` exits 0.
10. `npm run test:distribution` exits 0.

## Deviation contract

A conflict with the objective stops the unit: report expected, found, exact evidence, done or not
done, and at most one short hypothesis. Where a paragraph sits and which heading a section takes are
yours to decide and record.

## Output

- Per row: what you changed and the `file:line`, or why it was already closed.
- The red-then-green command and both counts, for each row that needed one.
- Your ruling on each "Look out for" item: in the guide already, added, or dropped with the reason.
- The gate table: command, bare exit code.
- Files changed.

No process diary.
