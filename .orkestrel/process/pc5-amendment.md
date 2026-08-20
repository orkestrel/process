# PC5 amendment — the audit round's objective findings join this unit, and the handoff leaves it

`pc5-brief.md` stands, with two changes. Read the original first; this file says only what moved.

## Removed from PC5

The `HANDOFF.md` dissolution and its whole disposition table move to **PC6**, a separate unit on the
Opus `implementer`. PC5 no longer touches `.orkestrel/process/HANDOFF.md` and no longer owns
acceptance criterion 6.

## Added to PC5

The two-lane audit of PC1-PC4 returned FAIL from both lanes. `pc-audit-reconciliation.md` holds the
per-claim ruling; these are the rows it carries here. Each is a defect with an executed contradiction,
not a preference.

### A. Four documented behaviours are gated by substring alone

Both lanes ruled claims 10, 11, 12, and 14 **UNPROVEN**, unanimously. PC4 closed each row by asserting
that a sentence appears in the file. That assertion passes unchanged when the behaviour changes, which
is the mechanism `.claude/rules/documentation.md` names and how the false `%1` claim survived 51 green
parity assertions before this campaign.

Add the executed assertion to each. Keep the substring check beside it as a presence guard.

1. **`isolated: true` removes `PATH` on POSIX.** `tests/guides.test.ts:485-496` asserts
   `keys.includes('SYSTEMROOT') === (process.platform === 'win32')`, which on this host proves only a
   negative and never asserts `PATH`'s absence — the property a consumer acts on. Add
   `expect(keys.includes('PATH')).toBe(false)` on the POSIX branch. The Windows half stays unproven on
   this host; leave it as prose and say so in your report.
2. **A spawn fault reports the host's negative errno for `run` and `null` for `runSync`.** No test
   asserts either number. `tests/src/server/Process.test.ts:370-384` asserts
   `expect(exit.code).not.toBe(0)`, which `null` also satisfies. Assert the sign for `run` and `null`
   for `runSync` against a file that cannot resolve.
3. **A detached POSIX child survives the supervisor's `SIGKILL`.** Bound by substring only. Prove the
   `SIGKILL` half: spawn a supervisor holding one child, kill the supervisor, read the child's state.
   The `SIGINT` half has never been probed on any host — prove it or report it unproven; do not leave
   it asserted as fact with no gate.
4. **The `moduleResolution` floor.** Nothing compiles a consumer under any named mode. Extend
   `tests/distribution.test.ts` to run `ts.createProgram` inside the existing external consumer, once
   per named mode, `skipLibCheck: false`, asserting zero diagnostics, with a firing control.

### B. Three defects in the proofs themselves

5. **The termination proof's `run` half still runs inside the bootstrap window.**
   `tests/src/server/helpers.test.ts:826-831` carries `timeout: 50` eight lines below the comment that
   calls 50 ms a coin flip against Node's measured 45.7-49.9 ms bootstrap. It waits on no readiness
   marker, so its negative assertion cannot distinguish "the group reached an established grandchild"
   from "the grandchild never started". Give it a root timeout clear of bootstrap and inside the
   fixture's write delay, wait on the readiness marker with `waitForCondition`, then assert.
6. **The standalone negative control measures the wrong package copy.**
   `tests/distribution.test.ts:18-21` resolves `@orkestrel/process/absent` through
   `createRequire(import.meta.url)`, which reaches the repository's own `node_modules` — where
   `@orkestrel/process` 0.0.3 sits as a transitive devDependency of scaffold. So the control that was
   seen to fire exercised the published 0.0.3 exports map, not the artifact the proof exists to hold.
   Root it in the temporary consumer, or delete it: the correct control already exists at `:102`.
7. **`--mode release` is inert.** `tests/distribution.test.ts` reads no `import.meta.env.MODE`, and its
   `EPERM` branch falls back to a `tar` extraction unconditionally. `.claude/rules/tests.md` requires a
   distribution proof to fail rather than skip under `--mode release`. As it stands, `prepublishOnly`
   can go green having proved that the tarball unpacks and never that it installs — the precise hole
   the row was opened to close. Read the mode; take the extraction branch only when it is not
   `release`, and rethrow the install error otherwise.

### C. One project is not hermetic

8. **`tests/src/core/index.test.ts:70-84` loads `dist/`**, which is gitignored, so `npm run test:src`
   fails on a fresh clone with "built core entries did not load" — a build-order fault reported as a
   missing export. `.claude/rules/tests.md` fixes `distribution` and `service` as the projects for
   proofs over built output. Move the ESM/CJS brand-recognition assertion into
   `tests/distribution.test.ts`, where it runs against the artifact a consumer receives. Leave the
   two-copy source assertion where it is; it is hermetic.

## Two claims were wrong, and the code was right

Record these in your report; change no code for them.

- There is no respawn path, and `buildSpawn` does not validate. Each of the four entry points validates
  its own frozen snapshot and spawns from that same object. Both lanes proposed the same corrected
  wording independently.
- `waitForCondition` rejects **at or after** its budget, never inside it: the deadline is read only
  after a failed poll. Tighten the helper's TSDoc in `tests/setup.ts` to name the real bound — budget,
  plus one interval, plus one condition evaluation — since the current wording invites the wrong claim.

## Scope, amended

**Owned, added:** `tests/distribution.test.ts`, `tests/src/core/index.test.ts`,
`tests/src/server/Process.test.ts`, `tests/setup.ts`.

**Owned, removed:** `.orkestrel/process/HANDOFF.md`. PC6 owns it.

`guides/process.md`, `README.md`, `tests/guides.test.ts`, `tests/src/server/helpers.test.ts`,
`src/server/types.ts`, and `src/core/types.ts` remain owned as the original brief states.

## Acceptance criteria, amended

Insert these before the original criteria 1 through 5, keeping the gate criteria last so an
unreachable criterion cannot hide them:

1. Each of the four substring-gated behaviours has an executed assertion that fails when the behaviour
   changes, or is reported unproven with the exact host that would settle it.
2. The termination proof's `run` half waits on a readiness marker and runs clear of Node's bootstrap.
3. The distribution proof's negative control resolves inside the temporary consumer.
4. `tests/distribution.test.ts` reads `import.meta.env.MODE` and fails rather than extracts under `release`.
5. `npm run test:src` passes against a tree with no `dist/`. State how you proved it.

The original criteria for Q15, Q16, Q17, Q19, and Q20 follow, then the five gate criteria unchanged.
Original criterion 6, the handoff, is struck.

## Routing, amended

`pc5-brief.md` § Role and engine names `sol` through `codex exec`. That routing is withdrawn.

**Role:** `implementer` (Claude Opus 5, native). Perform the assignment directly and spawn nothing.

Three of this unit's added items need a capability a bench sandbox denies. Item 3 spawns a supervisor
that itself holds a child, so the proof needs a grandchild; items 4 and 7 need a real `npm install`
inside the temporary consumer. `.agents/orchestration.md` **Bench laws** rule 4 records that every
operation one level deeper than a bench unit's own child fails `EPERM`. A unit that cannot run its own
new test cannot red-green it, so this unit runs on the host.

The writer is therefore on the Orchestrator's engine, and the audit lane for this unit is **Sol**.
