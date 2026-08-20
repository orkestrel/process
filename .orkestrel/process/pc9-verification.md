# PC9 — independent gate evidence

`verifier`, Sonnet, read-only, every working-tree-discarding git command prohibited by name.

| Gate                        | Exit |
| --------------------------- | ---- |
| `npm run format:check`      | 0    |
| `npm run lint:check`        | 0    |
| `npm run check`             | 0    |
| `npm run build`             | 0    |
| `npm test`                  | 0    |
| `npm run test:distribution` | 0    |
| `npx scaffold audit`        | 0    |

`scaffold audit`: 0 of 123 planned paths drifted.

Test counts as the runner printed them: `test:src` 4 files, 114 passed, 7 skipped (121);
`test:policy` 86; `test:config` 28; `test:guides` 86 passed, 1 skipped (87); `test:setup` 5;
`test:distribution` 1.

## The word checks, run case-insensitively

`grep -rniE "\brunners?\b"` over `README.md guides/ src/ tests/` returns six hits. Five are in
`guides/test.md` and `guides/scaffold.md`, vendored mirrors of other packages' guides that name
Vitest and the conformance runner. The sixth is `tests/src/server/helpers.test.ts:741`, "the runner's
own process group", which names the test process rather than this package's API; PC9's brief ruled it
stays and the verifier flagged it for confirmation. Confirmed correct.

`grep -rniE "\bonce\b"` over `guides/process.md src/` returns 32 hits, every one the counting sense,
the idiom "at once", or the `once` method and code token. No temporal use remains.

## The heading and its anchor

`guides/process.md:552` links `[Where \`execute\` and \`executeSync\` differ](#where-execute-and-executesync-differ)`
and `:636` is that heading. The generated slug matches the anchor.

## Barrels

Every row in `src/core/index.ts` and `src/server/index.ts` is exactly `export * from './module.js'`.

## Line lengths

`guides/process.md` carries 34 non-table lines past 100 columns and `README.md` carries 4 past 80.
These are the pre-existing overhangs F10 deliberately left; the brief scoped the rewrap to the lines
the rename lengthened, because a guide-wide reflow would produce a diff that hides every other change
in the unit. A Markdown line-length gate is recorded as a successor decision.
