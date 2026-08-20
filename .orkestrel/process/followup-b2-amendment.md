# Amendment to followup-b2-brief.md — 2026-08-20

The deviation report in the `tmp/followup-b2-report.md` file is accepted: the residue criterion's
population was wrong. The vendored policy fixtures (`tests/setupPolicy.ts`, `tests/policy.test.ts`)
lawfully define and exercise the generic `handlers.ts` kind and are off-limits, so they are outside
the sweep's population.

What changes:

- **Acceptance criterion on the residue sweep** — the command becomes
  `rg -n "handlers" src/ tests/src/ guides/process.md`, and it must return no hit. Everything the
  brief says about the other criteria stands unchanged.

Resume from the tree as you left it — the file map in your deviation report is accepted as landed.
Run the remaining acceptance criteria in the brief's order (lint:check, check, format:check,
test:policy or its recorded denial, the export-set comparison against HEAD, the corrected residue
sweep, the scoped runs or their recorded denials), and write the completed report to
`tmp/followup-b2-report.md` (the deviation report may be overwritten by the completed one — its
acceptance is recorded here).
