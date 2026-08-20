# PC3 — prove the decidable half of the Windows surface on any host

## Role and engine

`sol` (GPT-5.6 Sol), direct `codex exec`. Perform the assignment directly and spawn nothing.

## The problem this unit exists to shrink

Row Q2 of `.orkestrel/process/readiness-grade.md`. The audit's reconciler ruled it **blocks-release**,
in these words:

> A supported platform with zero executed evidence after a change reasoned from that platform's own
> behaviour is an unproven seam, not a known limit.

Nine tests skip on Linux. The `cmd.exe /d /s /c` and `taskkill` branches ship in the tarball. The
guide documents Windows behaviour as covered. And commit `b392629` changed the fixtures those tests
depend on on the strength of a Windows/POSIX stdout difference **without re-running Windows**.

No Windows host is available to this campaign. This unit does not pretend otherwise. It shrinks the
unproven surface to the part that genuinely needs a Windows kernel, and proves the rest here.

## The split, measured

```text
$ git show HEAD:src/server/helpers.ts | grep -n "process.platform"
129:	if (process.platform !== 'win32') return undefined          resolveExecutable POSIX short-circuit
160:	const folded = process.platform === 'win32'                 PATHEXT case folding
225:	if (process.platform !== 'win32') return undefined          resolver POSIX short-circuit
297:	const batch = process.platform === 'win32' && (…'.cmd'…)    batch routing
531:	if (process.platform === 'win32' || child.pid === undefined) killProcess branch
632:	if (process.platform === 'win32') {                          killTree / taskkill
757:	detached: process.platform !== 'win32',                      spawn options
```

**Decidable logic** — a pure decision over inputs, provable on any host: PATHEXT resolution and its
folding, batch routing, argument quoting, and the percent-sign refusal.

**Genuine I/O** — needs a Windows kernel and stays unproven: `killTree` spawning `taskkill`, and
grandchild tree termination.

## The repair

Extract each decidable decision into a pure function that takes the platform (or the host facts it
depends on) **as a parameter**, so both branches are reachable from a test on any host. The thin
`process.platform` read stays at the call site and becomes the only unproven line.

Constraints that make this a real reduction rather than a relabelling:

- **Never patch `process.platform`** or any global. `AGENTS.md` forbids it and it would prove nothing.
- The extracted functions are pure leaves and belong in `helpers.ts` per
  `.claude/rules/architecture.md`. Every one is exported and tested — no hidden module helpers.
- Behaviour must not change on either platform. This is a testability refactor. Prove that: the
  existing suite stays green, and each extracted function reproduces the current decision for both
  platform values.
- Do not extract the I/O-shaped branches. `killTree` spawning `taskkill` is not decidable logic and
  wrapping it would manufacture false confidence.

Then write the tests that the extraction makes possible: for **each** decidable behaviour, assert the
Windows decision and the POSIX decision, on this host, from the same test file.

Include the percent-sign refusal for a batch target — `HANDOFF.md` contract item 1 records it as
attacker-proven and it is exactly the kind of rule that must not regress silently.

## A rule the existing skips already break

`.claude/rules/tests.md` § Test contract:

> Give a conditional skip the mechanism that makes it inapplicable, **cited**, not the platform name
> alone. A test skipped on a platform is a test nobody re-examines; a test skipped because a named API
> rejects a named case is one anybody can re-check.

All fourteen conditional skips in this package cite `process.platform` and nothing else. That is the
rule violation that let nine tests sit unexecuted without anyone re-examining them, and it is why the
audit found this seam rather than a gate finding it.

So every skip that survives your extraction must name **the mechanism**: which API, rejecting which
case, on which host. `it.skipIf(process.platform !== 'win32')` becomes a skip whose reason a reader
can re-check without owning a Windows machine.

Two further rules from the same file bind your new tests:

- *"Probe a host-varying property at runtime, on the host the test is running on, and assert against
  what the probe returned."* Your extracted functions take the platform as a parameter, so both
  branches are ordinary inputs and neither is host-varying. Where something genuinely is — path
  separators, case folding — probe it rather than fixture it.
- *"Never assert an implementation against itself."* An extracted decision must be compared to a
  declaration or a fixture that could disagree, not re-derived the way the source derives it. A test
  that recomputes the answer passes for every value the source will ever return.

## Q7 is CLOSED — do not reopen it

Q7's race was closed by the Orchestrator before this unit was dispatched, at commit `16ec17f`. Its
cause was the test's own parameter, not its instrument: the root ran `timeout: 50` while Node
bootstraps in 45.7–49.9 ms on this host, so the grandchild raced its own interpreter startup and lost
three of six trials. The root now runs 400 ms and the test measures termination. Eight consecutive
runs are green.

Leave `leaves an established grandchild running after a root-only timeout where run ends the tree`
alone. If your extraction touches it, preserve the 400 ms root timeout and the readiness wait, and say
so in your report.

**Use `waitForCondition` from `tests/setup.ts`** for any wait you add. It exists now, measures its
deadline with `performance.now()`, and accepts a synchronous or asynchronous condition. Do not write
another local polling loop, and never use a fixed delay to wait for something another process
produces.

## Honesty requirements

- `guides/process.md`'s Tests section must state which rows execute on which host, and name the host
  each half was last proven on. Row Q18 of the grade requires this independently.
- The residue — `killTree` and grandchild tree termination — must be named as unproven, in the guide
  and in `HANDOFF.md`, with the exact command that would settle it on a Windows host.
- Do not claim the extraction proves Windows end to end. It proves the decisions. Say so in those
  words.

## Standing conditions

Units PC1 and PC2 land before you and both own `src/server/helpers.ts`. Take their state as given.
This executor denies **nested** child creation with `EPERM`; record what you cannot run and name the
settling command.

## Scope

Owned: `src/server/helpers.ts`, `src/server/Process.ts`, `guides/process.md`,
`.orkestrel/process/HANDOFF.md` (the Windows-coverage statement only), and the matching files under
`tests/src/`.

Off-limits: `package.json`, `src/core/**`, the rest of `.orkestrel/`.

## Execution

Perform this assignment directly. Spawn nothing.

## Acceptance criteria

1. `npm run format:check`, `npm run lint:check`, and `npm run check` each exit 0.
2. Every decidable Windows behaviour named above has a test asserting **both** the Windows and the
   POSIX decision, passing on this Linux host, with no global patched.
3. The count of `process.platform` reads in `src/server/helpers.ts` falls, and each survivor is a
   call-site read feeding an extracted pure function or an I/O branch you deliberately left.
4. The existing suite stays green — behaviour unchanged on both platforms.
5. `guides/process.md` and `HANDOFF.md` state which rows run on which host, name the residue, and give
   the command that settles it.

**`npm run build` and the test projects are observations, not criteria.** Report every command's
**bare** exit code.

## Deviation contract

Stop and report if extracting a decision would change behaviour on either platform, or if a branch you
judged decidable turns out to depend on a host call. Naming, placement, and test structure are yours.

## Output

**What you extracted and what you deliberately did not**, **The platform-read count before and
after**, **Files written**, **Red-then-green proofs**, **The residue, named exactly**, **Validation**
(each gate, bare exit code), **Deviation**, **Decisions**. No process diary.
