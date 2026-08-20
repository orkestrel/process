# PFIX: close the three findings the readiness audit confirmed

## Role and engine

Role `sol` implementer. Engine GPT-5.6 Sol, high effort, sandbox `workspace-write`, rooted at
`/workspace/process`. You are the sole writer in this checkout for the duration of this unit.

## Objective

Close three findings from the narrow readiness audit of `@orkestrel/process` 0.0.4. Each names an
exact site.

## Read first, in this order

1. `AGENTS.md` — in full, and its `Writing` section especially
2. `.claude/rules/names.md`, `.claude/rules/typescript.md`, `.claude/rules/architecture.md`,
   `.claude/rules/documentation.md`, `.claude/rules/writing.md`, `.claude/rules/tests.md`
3. `guides/process.md` — the governing spec
4. `src/core/types.ts` and `src/server/types.ts` — authoritative for the public contracts

## The findings

**Finding 2 — a count in a test comment.**

`tests/guides.test.ts:918` reads "Sixteen exports appear in no `guides/process.md` fence." Exports and
guide fences are both sets this package can extend, so the number is a count and goes stale silently.
Write the sentence without it.

**Finding 3 — a positional tally in a public helper's contract.**

`src/server/helpers.ts` exports `retainChunk(chunk, chunks, counts, limit)`. Its `counts` parameter is
a `number[]` mutated in place, where the entry at index 0 is the delivered byte total and the entry
at index 1 is the retained byte total. Its TSDoc at lines 587-588, its `@param`, and its `@example`
all describe the pair by position.

Deleting the positional prose alone leaves the shape that forces it. The shape is the defect:
`AGENTS.md` § Design laws requires a named discriminant and forbids an axis the reader has to learn
from prose. Replace the positional pair with a named mutable record carrying `delivered` and
`retained`. Keep the in-place mutation — the helper runs once per delivered chunk and must not
allocate per call — and keep the helper's behaviour identical in every other respect.

Define the record's type in `src/server/types.ts` before implementing it, per TTTDD. Its properties
are mutable by necessity, which is a deliberate exception to the readonly rule for an accumulator the
caller owns; say so in its TSDoc in one sentence. Update `src/server/helpers.ts:942-943`, the
`@example`, and `tests/src/server/helpers.test.ts`.

This is a public export, so it is a public surface change. The release is already breaking on the
`run` to `execute` rename and is not yet published, so carrying it here costs a consumer nothing
extra.

**Finding 4 — the guide claims an execution that does not happen.**

`guides/process.md:1011-1012` says `tests/guides.test.ts` proves "every flagship fence returns what
its comments claim". The guide carries `detach`, `stopChild`, and manual termination-helper fences at
lines 675, 904, and 919, and `tests/guides.test.ts` contains no `detach`, `stopChild`, `killProcess`,
or `killTree` import or call.

Rule between two remedies and say which you took and why:

- transcribe those fences so the stated population is true; or
- narrow the sentence to the population the suite actually executes.

Prefer transcription where the fence is executable in this container without a real Windows host.
`guides/process.md:978-981` already records that `killTree` through `taskkill.exe` and grandchild
termination are proven on no host; that disposition stands and is not yours to reopen. A fence that
cannot execute here gets the narrowing, not a skipped test.

## Finding 5 — the manifest ships a placeholder description and no keywords

`package.json` carries `"description": "The @orkestrel/process package."` and `"keywords": []`.
Both entered at the initial commit and were never edited. 0.0.3 already shipped them, and the
working tree's 0.0.4 repeats them byte for byte.

This is birth-owned, not vendored: `HOST_PATHS` does not list `package.json`, and scaffold's own
generator states that a workspace owns its manifest's description, its keywords, and any script it
added once the manifest exists. `The ${name} package.` is the birth default a consumer is meant to
replace. So a written description survives `repair` and `overwrite`, and editing it here is correct.

Write a description from `README.md`'s own opening, and a keyword set a consumer searching npm would
use. Fixing this emits no changed byte in `dist/`, so it rides the pending bump at no cost.

## Scope

- **Owned:** `tests/guides.test.ts`, `src/server/helpers.ts`, `src/server/types.ts`,
  `tests/src/server/helpers.test.ts`, `guides/process.md`, and — for the `description` and
  `keywords` fields only — `package.json`.
- **Off-limits:** every other file. In particular the vendored host — `AGENTS.md`, `CLAUDE.md`,
  `.agents/`, `.claude/`, `.codex/`, `.cursor/`, `configs/helpers.ts`, `scripts/*.sh`,
  `tests/config.test.ts`, `tests/policy.test.ts`, `tests/setupPolicy.ts` — is owned by
  `@orkestrel/scaffold` and restored by `repair`. `vite.config.ts` is
  scaffold-planned; do not hand-edit it. In `package.json` you own `description` and `keywords` and
  nothing else — every other field there is planned. Do not change the version.

## Host conditions

- The tree is committed and clean. Untracked `tmp/` files are expected.
- There is no `dist/` in this checkout. Do not run `npm run build`; a separate reading owns the
  packed artifact.
- The network is unavailable in your sandbox. You need it for nothing. Do not install or fetch.
- Your sandbox denies a loopback listener, a nested install, and a process one level below a child
  you spawn. None of this unit's suites needs any of those; report it as an observation if one
  surprises you, and never work around it.
- Do not run tree-wide `npm run format` or the whole `npm test`. Validate scoped to your own files.

## Execution

Perform this assignment directly. Spawn nothing.

## Prohibitions

- Never run `git checkout`, `git restore`, `git stash`, `git reset`, or `git clean`. Each discards a
  working-tree change silently, and this tree has no other copy of your work. To undo your own edit,
  undo exactly that edit.
- Never commit, push, install, or read a credential.
- No `any`, no `as`, no `!`, no `@ts-ignore`, no `@ts-expect-error`, no `eslint-disable`.
- No mocks, behavioral fakes, module replacement, or framework spies.
- State no count in any prose you write, and never name a list item by its position. This binds
  TSDoc, comments, test names, and the guide.

## Acceptance criteria

Close them in this order and report each command with its exit code.

1. `npx vitest run --config vite.config.ts --project src:server tests/src/server/helpers.test.ts`
   exits 0. Report its counts.
2. `npm run lint:check` exits 0.
3. `npm run check` exits 0.
4. `npx vitest run --config vite.config.ts --project guides` exits 0. Report its counts.
5. `rg -n -i '\bsixteen\b' tests/ src/ guides/process.md README.md` returns no hit.
6. `rg -n 'slot `?[01]`?|counts\[[01]\]' src/ tests/ guides/process.md` returns no hit.
7. `node -p "const p=require('./package.json'); p.description + ' | ' + p.keywords.join(',')"`
   prints a written description and a non-empty keyword set.

Report a whole-suite result as an observation if you take one, never as a criterion.

## Deviation contract

Stop and report if the objective itself conflicts with what you find: expected, found, exact
evidence, done or not done, and at most one short hypothesis. An ancillary choice — a field's name
within the shape the brief fixes, where a paragraph sits — is yours to decide, record, and carry on
from.

## Output

Write your report to `tmp/codex/pfix-report.md` and make it your final message too. It contains: the files
you touched and what changed in each; the new type and why its properties are mutable; your ruling on
Finding 4 with the reason; each acceptance criterion with its exit code and counts; and anything you
could not close. No process diary.
