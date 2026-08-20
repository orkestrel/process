# PFIX-C report

## Status

Stopped under the deviation contract. No product, guide, test, or package file changed.

## Conflict

**Expected:** Implement the ruled `Capture` sub-entity with `#delivered` and `#retained` fields,
readonly accessors, and a `retain` method while changing only owned files.

**Found:** A compliant `Capture` class requires its own `src/server/Capture.ts` implementation file,
but the scope does not own that path and declares every unlisted file off-limits. The permitted
placements are also forbidden: `src/server/types.ts` may contain interfaces and types only, and
`src/server/helpers.ts` may contain pure helpers only.

**Exact evidence:**

```text
AGENTS.md: Centralize by kind. Types, constants, helpers, validators, parsers, factories, errors,
and similar declarations live in their designated centralized files. Implementation files contain
one class plus imports.

.claude/rules/architecture.md: Interfaces/types -> */types.ts
.claude/rules/architecture.md: Implementations -> */[domain]/[Entity].ts, one class per file
.claude/rules/architecture.md: An implementation file contains imports and exactly one class
implementation with # fields.

tmp/codex/pfixc-brief.md: Owned: src/server/types.ts, src/server/helpers.ts,
src/server/index.ts, guides/process.md, tests/guides.test.ts, tests/distribution.test.ts,
and every test file under tests/src/.
tmp/codex/pfixc-brief.md: Off-limits: every other file.
```

**Done:** Read the required authority, governing guide, prior audit brief, public server contract,
barrel, helper implementation, and source layout. No implementation began.

**Hypothesis:** The owned-file list omitted `src/server/Capture.ts` when the `Capture` ruling was
written.

## Files touched

- `tmp/codex/pfixc-report.md` — recorded the required stop report.

## Capture declaration

No declaration was added. Adding only an interface would not implement the ruled entity, placing the
class in `types.ts` or `helpers.ts` would violate the repository contract, and adding
`src/server/Capture.ts` would exceed the dispatch scope.

## A5 ruling

No ruling was taken. The deviation contract stopped the unit before A5.

## Red-then-green readings

No red or green reading was taken. The permanent capture test was not added.

## Refusal-list plant and removal

No plant was made and no removal was needed. The anti-rot assertion was not changed.

## Acceptance criteria

### Readonly public properties

Command: `rg -n '^\s+(delivered|retained): number' src/`

Exit code: unavailable. The exact acceptance command was not run after the stop condition. The
existing `CaptureCounts` declaration still contains both prohibited properties, so this criterion is
not closed.

### Capture accumulation proof

Exit code: unavailable. No test command ran. Test counts: unavailable. This criterion is not closed.

### Refusal-list anti-rot control

Exit codes: unavailable. The planted and unplanted readings did not run. Test counts: unavailable.
This criterion is not closed.

### Distribution mode control

Exit codes: unavailable. The local and release invocations did not run. Test counts: unavailable.
This criterion is not closed.

### `npm run lint:check`

Exit code: unavailable. The command did not run. This criterion is not closed.

### `npm run check`

Exit code: unavailable. The command did not run. This criterion is not closed.

### `npx vitest run --config vite.config.ts --project src:core`

Exit code: unavailable. The command did not run. Test counts: unavailable. This criterion is not
closed.

## Observations

No sandbox-denied reading occurred because the unit stopped before commands that spawn children,
open loopback listeners, or install a package.

The stated clean-tree condition also differs from the observed tree. The exact command and reading
were:

```text
$ git status --short
?? .orkestrel/process/paudit2-brief.md
```

That untracked audit brief was read as required and was not changed.

## Unclosed work

A1 through A5 and every acceptance criterion remain unclosed. Grant ownership of
`src/server/Capture.ts` to make the ruled entity implementable without breaking the coding contract.