# PFIX-B: three guide sentences the code contradicts, and three gates that cannot fail

## Role and engine

Role `sol` implementer. Engine GPT-5.6 Sol, high effort, sandbox `workspace-write`, rooted at
`/workspace/process`. You are the sole writer in this checkout for the duration of this unit.

## Objective

Close the findings an audit lens raised over `@orkestrel/process` and an independent skeptic then
failed to refute. Two classes: a guide sentence the code contradicts, and an assertion that cannot
fail.

`0.0.4` is prepared and its gates are green. Nothing here changes the published surface; it changes
what the guide claims and what the suite actually proves.

## Read first, in this order

1. `AGENTS.md` — in full
2. `.claude/rules/documentation.md`, `.claude/rules/tests.md`, `.claude/rules/writing.md`
3. `guides/process.md` — the governing spec

## The findings

**G1 — the destroy barrier's ordering claim is backwards.**

`guides/process.md` states that the `destroy` barrier settles before the `protocol` refusal throws.
A live probe showed the opposite: the refusal is synchronous and the barrier settles strictly after
it. The probe drove a manager option getter calling `manager.destroy()` mid-construction.

Reproduce that ordering yourself before you write a word. Then correct the sentence to what the code
does, and add a permanent test pinning the real order so the sentence cannot drift back.

**G2 — the guide calls a Node-only contract host-independent.**

`guides/process.md` says every contract is host-independent. `ProcessChild` is not: it ships from
`@orkestrel/process/server` and its own signature carries `kill(signal: NodeJS.Signals)`, a Node
global. Correct the claim. Decide whether the sentence gains an exception or the contract list
splits by face, and say which you took and why.

**T1 — the neighbouring-face assertion derives its expectation from what it asserts.**

In `tests/guides.test.ts`, the row proving a face publishes none of a neighbouring face's names
computes its expected value from the same `own`/`published` computation the assertion itself checks.
It can never catch the leak it names. Make the expectation independent of the computation under
test, then prove the repaired row fails against a planted leak and passes without it. Plant the leak
in a file this unit owns, and name in your report exactly how you removed it.

**T2 — the abort-listener assertion never adds a listener.**

The only executed evidence for the row claiming a listener is released aborts the signal before any
listener is attached, so it cannot prove removal. Attach a listener, abort, and assert the listener
is gone. Prove red-then-green.

**T3 — a test is filed and named for a function it never calls.**

Under the `validateCommand` describe block sits a test that calls only `validateWorkspace`. Move it
to the block that owns it, or give it a name that says what it proves. `AGENTS.md` requires a test
named for what it proves.

## What is recorded and NOT yours

These were found and ruled record-only. Do not act on them, and do not let them widen this unit:

- The parity gate flattens both published faces into one scope, so no assertion binds a documented
  name to the face that publishes it. No row is currently misattributed, so it is a latent hole. A
  successor owns it.
- `terminationValid` is assigned only inside a `win32` branch, so it is tautologically true on this
  host.
- `killTree`'s describe block executes nothing on a POSIX host, and a probe reached its POSIX settle
  path directly, contradicting the skip's stated rationale.

## Scope

- **Owned:** `guides/process.md`, `tests/guides.test.ts`, and every test file under `tests/src/`.
  You may change `src/` only if G1's correction requires it, and if it does, stop and report first —
  a source change here moves the published surface and this unit is not scoped for that.
- **Off-limits:** every other file. The vendored host — `AGENTS.md`, `CLAUDE.md`, `.agents/`,
  `.claude/`, `.codex/`, `.cursor/`, `configs/helpers.ts`, `scripts/*.sh`, `tests/config.test.ts`,
  `tests/policy.test.ts`, `tests/setupPolicy.ts` — is owned by `@orkestrel/scaffold` and restored by
  `repair`. `package.json` and `vite.config.ts` are scaffold-planned. Do not change the version.

## Host conditions

- The tree is committed and clean at `6e59972`. Untracked `tmp/` files are expected.
- **Your sandbox denies child execution, a loopback listener, a nested install, an `rm -rf`, and a
  write to some paths outside the obvious source tree.** Measured in this repository: the `src`
  and `guides` projects both carry rows that spawn children, and those rows fail inside the sandbox
  with `spawnSync ... EPERM` however careful you are. Never work around a denial and never change a
  test to suit your sandbox. Report each denied reading as an observation naming the exact command;
  the Orchestrator takes it on the host, where every gate was green before this unit.
- Use `rmdir` for an empty directory.
- The network is unavailable. Do not install or fetch.
- Do not run `npm run build`, tree-wide `npm run format`, or the whole `npm test`.

## Execution

Perform this assignment directly. Spawn nothing.

## Prohibitions

- Never run `git checkout`, `git restore`, `git stash`, `git reset`, or `git clean`. Each discards a
  working-tree change silently, and this tree has no other copy of your work. To undo your own edit,
  undo exactly that edit.
- Never commit, push, install, or read a credential.
- No `any`, no `as`, no `!`, no `@ts-ignore`, no `@ts-expect-error`, no `eslint-disable`.
- No mocks, behavioral fakes, module replacement, or framework spies.
- State no count in any prose you write, and never name a list item by its position.

## Acceptance criteria

Close them in this order and report each command with its exit code and counts.

1. G1's real ordering is reproduced and recorded before the guide sentence changes. Paste the probe
   and its output.
2. A permanent test pins the real `destroy`-versus-refusal order. Record red-then-green.
3. T1's repaired row fails against a planted leak and passes without it. Record both readings and the
   exact plant-and-remove steps.
4. T2's repaired row fails against the unrepaired source and passes against the repaired one.
5. `rg -n 'host-independent' guides/process.md` shows no sentence that a Node-only contract falsifies.
6. `npm run lint:check` exits 0.
7. `npm run check` exits 0.
8. `npx vitest run --config vite.config.ts --project src:core` exits 0. Report its counts.

Report the `src` and `guides` projects as **observations** with their counts, never as criteria —
your sandbox cannot pass either.

## Deviation contract

Stop and report if the objective itself conflicts with what you find: expected, found, exact
evidence, done or not done, and at most one short hypothesis. An ancillary choice — a test's name,
where a paragraph sits — is yours to decide, record, and carry on from. A change to `src/` is not
ancillary: it stops the unit.

## Output

Write your report to `tmp/codex/pfixb-report.md` and make it your final message too. It contains: the
files you touched and what changed in each; G1's reproduction with its exact probe and output; your
ruling on G2 with the reason; the red-then-green readings; the exact plant-and-remove steps for T1;
each acceptance criterion with its exit code and counts; an **Observations** section for every
reading your sandbox denied with the exact host command; and anything you could not close. No process
diary.
