# PC-AUDIT3 — subjective lane verdict

`reviewer`, Opus 5, clean context, blind to the objective lane. Told that its own engine wrote PC7
and PC8 and to attack that half harder. Returned verbatim.

## Numbered verdicts

**1. CONFIRMED.**
Attack: I enumerated every sentence in `guides/process.md`, `src/core/types.ts`, and
`src/server/helpers.ts` that names `truncated`, `limit`, or a captured stream, and looked for any
that leaves a consumer a route to per-stream attribution from the result. The candidates are
`guides/process.md:564` (`truncated` row), `:598-606`, `:642-643`, `:939-941`, `src/core/types.ts:214-216`,
`:235-236`, `:260`. None implies identification from the result. `guides/process.md:602-604` states
the real limit explicitly ("both captured strings are trimmed to `limit`, so a stream that stopped
exactly at the cap and a stream that ran past it read the same length"), and `tests/guides.test.ts:469-491`
drives the exact refuting case — stdout at `limit`, stderr at `limit + 1` — and asserts both read
`limit`. The attack failed. The remediation sentence that follows it carries a separate defect; that
is claim 9, not this one.

**2. BROKEN.**
The `src/server/types.ts:14` count is now correct — `pid`, `exitCode`, `signalCode`, `kill`, `once`,
`off` is six, and `:16-19` enumerates the same six.

Another count-bearing sentence disagrees with what it counts. `guides/process.md:960` — "Three names
on this surface read against a house rule, and each is settled here rather than rediscovered." The
table at `:963-969` has five rows naming eight identifiers: `execute`, `executeSync`, `process`,
`processes`, `strict`, `evidence`, `backlog`, `truncated`. No counting rule yields three; the first
row alone carries two names. Every row states a house-rule ruling, so there is no charitable reading
under which two rows are excluded.

This is finding 19's exact defect shape — a sentence enumerating a set it miscounts — surviving in
the guide because PC-AUDIT2 repaired only the instance it was pointed at. PC7 rewrote the first row
of this very table and did not read the sentence above it.

Count-bearing sentences enumerated and found correct: `guides/process.md:3`, `:38`, `:162`, `:177`,
`:556`, `:557`, `:213`, `:225`, `:1002`, `:361`, `:569`, `:599`, `:633`, `:719`, `:871`;
`src/core/types.ts:8`, `:144`, `:154`, `:212`; `src/server/helpers.ts:587`, `:626`.

**3. BROKEN.**
`.orkestrel/process/pc7-report.md:9` states `| run | 55 | 44 English uses | execute | 11 |`, measured
across `src/`.

`rg -o '\brun\b'` over `/workspace/process/src` returns 45 occurrences on 41 lines. `rg -o '\bexecute\b'`
over the same scope returns 11, matching the report's `execute` column exactly. The `run` column is
neither the occurrence count (45) nor the line count (41). It is 55 − 11, so the "After" figure is a
derivation from the substitution count presented as a measurement. Since `execute` = 11 is verified,
the true "Before" was 56, not 55 — both cells in that row are off by one.

The report's own evidence contradicts it: the residual grep block at `pc7-report.md:21-61` lists
exactly 41 `src/` lines, two of which carry two occurrences each, plus two more in
`server/helpers.ts`. Nothing in the PC8 diff changes the `src/` `run` population.

Finding 20 was an audit record claiming eleven renamed tests where the diff had ten. The very next
round's record repeats it, in a table whose purpose is to prove the rename was complete.

**4. BROKEN.**
The `run`/`runSync`/`Run*` identifiers are gone. The word survives as `runner`/`runners`, naming the
one-shot execution primitives themselves — not an invocation, the functions.

| Location | Text | Ruling |
| --- | --- | --- |
| `README.md:8` | "`execute` and `executeSync` are the one-shot runners" | Missed. `README.md` is in `package.json` `files`, so this is the first sentence a consumer reads on npm. |
| `guides/process.md:6` | same sentence in the guide blurb | Missed. |
| `guides/process.md:51` | `### Runners` — section heading over the table listing `execute`, `executeSync`, `detach` | Missed. The heading is the name the guide gives these functions. |
| `guides/process.md:551` | link text "Where the two runners differ" | Missed, and added by PC8 after PC7's rename. |
| `guides/process.md:599` | "the two runners differ in what they do about it" | Missed. |
| `guides/process.md:633` | `### Where the two runners differ` | Missed. |
| `src/core/types.ts:14` | "a one-shot runner that buffers a child to completion" | Missed. Ships in `dist/src/core/index.d.ts`. |
| `src/core/types.ts:308` | "where the synchronous and asynchronous runners genuinely differ" | Missed. Ships in the `.d.ts`. |
| `tests/guides.test.ts:768` | test name "…where the guide says the runners differ" | Missed. |
| `tests/src/server/helpers.test.ts:943` | "The documented difference between the two runners" | Missed. |
| `tests/src/server/helpers.test.ts:741` | "the runner's own process group" | Correct. Names the test process, not the API. |

Why the unit did not see them: `pc7-report.md:18-176` measures with a `\brun\b`-shaped pattern, so
`runner` and `runners` were outside the instrument's membership rule and were never ruled on. The
report's `Runs` judgments section rules on exactly two occurrences and declares the sweep complete.

`.claude/rules/names.md:199` forbids `run` as a synonym for the `execute` meaning, and the guide's own
ruling at `guides/process.md:965` now reads "Use the fixed lifecycle verb for primary work to
completion" — while three headings, the guide blurb, the published README, and the shipped `.d.ts`
call the same two functions runners. A reader who reads the ruling and then the heading gets two
answers. PC7 was precise enough about prose to rewrite `` `run` runs a command `` into "The `execute`
function runs a command" and to rename two test titles, which is what makes the omission a miss
rather than a scope decision.

Right looks like: rename the two headings and its inbound link; replace "the one-shot runners" at
`README.md:8`, `guides/process.md:6`, `src/core/types.ts:14`, and `:308`; update
`tests/guides.test.ts:768` and `tests/src/server/helpers.test.ts:943`. Then add a Vocabulary row
ruling on the surviving noun `a run`, so the next round does not re-open it.

Secondary residue from the same edit: the substitution lengthened tokens in place without rewrapping.
`guides/process.md` holds a hand-wrap at 100 columns (`.oxfmtrc.json:7` sets `printWidth: 100`, and
`oxfmt` does not format Markdown, so no gate sees this). These prose lines now overhang: `:5` (107),
`:39` (~107), `:357`, `:358`, `:406`, `:531`, `:608`, `:609`, `:635`, `:650`, `:772`, `:790` (107),
`:1004`. `README.md` hand-wraps at ~70 and now has three overhanging lines: `:8` (~86), `:59` (~88),
`:68` (~79).

**5. CONFIRMED.**
Attack: I searched the owned tree for `execute` standing where ordinary English `run` belongs —
`(npm|npx|vitest|node) execute`, `an execute`, `execute the gates`, `the execute stays` — and found
none. The English uses that must survive all do: `package.json:47-72` scripts use `npm run`;
`tests/config.test.ts:409-455` asserts `npm run test:*` and `vitest run` strings; `guides/process.md:884`
keeps `arguments: ['run', task]`; `:984` keeps `npx vitest run`; `:547`, `:552`, `:566`, `:652-653`
keep "a run" for one invocation; `tests/src/server/helpers.test.ts:741`, `:743`, `:751` keep the
English verb. The only two prose renames are `tests/guides.test.ts:745` and
`tests/src/server/helpers.test.ts:976`; both replaced text that named the former API, so neither is
over-reach. The attack failed.

**6. CONFIRMED.**
Attack: I diffed the three moved `it` blocks in `tests/src/core/errors.test.ts:6-67` against their
deleted originals. Every assertion, argument, and expected value is identical; only `entry.` prefixes
were dropped. The refusal control survives intact at `:20-25` — an `Error` carrying `code: 'stalled'`,
`name: 'ProcessError'`, and the real `Symbol.for('@orkestrel/process.error')` brand, so it is drawn
from outside `PROCESS_ERROR_CODES` while satisfying every other condition the guard tests. That is the
discriminating control: it fails only if the guard stops checking the tuple. The cross-copy control
also survives.

The barrel-membership `it` it dropped asserted the core barrel's exact 14 runtime keys. That fact is
still asserted by `tests/distribution.test.ts:121` / `:195` against the installed tarball's runtime
`Object.keys` and its parsed `index.d.ts`, which is a stronger instrument than the deleted literal.
**Boundary:** `distribution.test.ts` runs from `test:distribution`, not from `npm test`, so between
publishes the core barrel's exact runtime membership is pinned only statically, by the parity gate.
That is a real narrowing, not a loss — this package is about to run `prepublishOnly`.

**7. CONFIRMED.**
Attack on the missing-export direction. `symbolKey` is `${kind} ${name}` and `missingSymbols` diffs by
that key, so the comparison is over (name, kind) pairs, not names. Three assertions fire on a missing
export, each from a different door: `documents only barrel exports` (`:259-261`); `re-exports every
direct declaration that is not named internal` (`:245-248`) with `INTERNAL` empty; and `names no
symbol internal that the barrel already exports` (`:249-252`). Concretely: delete
`export * from './Process.js'` from `src/server/index.ts:4`, and both the first and second assertions
fail. That is the direction the plant did not cover, and it is covered. Because `symbolKey` carries
kind, the guide's `Kind` column is also asserted — which is what replaces the deleted file's `typeof`
block, in a form that discriminates five kinds instead of two.

**Boundary I could not close by reading:** the parity gate never loads either barrel; it parses source
text. A divergence between the text and the loaded module — an ESM `export *` name collision — is
invisible to it. Every server export except `Process` and `ProcessManager` is imported by name
somewhere in `tests/`, so such a divergence would break an import for the other 32. This is narrow and
I do not raise it as a finding.

**8. BROKEN.**
I attacked three instruments, all by reading; the mutation-probe half of this claim I could not
execute.

- `tests/guides.test.ts:509-518`, `documents the constant values its Surface table prints` — BROKEN.
  The body never reads `files['guides/process.md']`. It compares eight imported constants against
  eight literals in the test. Editing `guides/process.md:155` from `5_000` to `6_000` changes nothing
  this assertion evaluates, and no other assertion in the file reads the `Value` column. So the
  guide's `Value` column for all eight constants is guarded by nothing, under a test named for
  guarding exactly it. Right looks like: parse the `Value` cell out of the Constants table and compare
  it against the imported constant, the way `:522-533` does for the error-code table. The values
  currently agree, so the drift is latent, not present.
- `tests/guides.test.ts:464-491`, `reports no way to tell which stream overflowed` — the assertion
  holds; its stated coverage does not. The behavioural half is genuinely discriminating. But the
  comment at `:467-468` claims "a later per-stream field breaks this test rather than leaving the
  sentence stale," and that is false. Adding `truncatedStdout` / `truncatedStderr` to `ExecuteResult`
  would leave the guide substring at `:474` present and the three byte-length assertions unchanged.
  Right looks like: delete the clause, or pin `Object.keys(written).sort()` against the documented
  `ExecuteResult` field set.
- `tests/guides.test.ts:522-533`, `tables exactly the error codes the tuple declares` — held. It
  parses the guide's own `| Code |` table and compares both ways. Not tautological.

**Not executed:** I hold no exec tool, so I ran no mutation probe. What would settle the remainder is,
for each of the 30 assertions in `tests/guides.test.ts` and the four barrel-population rows at
`:215-230`, one recorded plant-and-revert against `npm run test:guides`.

**9. BROKEN.**
`guides/process.md:605-606`: "Where the distinction matters, bound the two streams separately by
running the command twice, or capture the child's output yourself."

The first clause names an operation the API does not offer. `ExecuteOptions.limit` and
`ExecuteSyncOptions.limit` are each a single number documented as "Maximum captured bytes for stdout
and for stderr, each", and `buildExecuteResult` applies that one value to both fields
(`src/server/helpers.ts:808`). No number of runs bounds stdout at one value and stderr at another. The
second clause is sound: `Process` does carry per-stream bounds.

This sentence is PC-AUDIT2's repair for finding 18. The false instruction was replaced by an
unperformable one, in the same paragraph, and the new executed row pins the true half of the paragraph
while leaving the advice unasserted. That is the failure mode the brief names — the replacement reads
as rigour and is not checkable.

Right looks like: "Where the distinction matters, re-run with a `limit` high enough that `truncated`
is `false`, then compare each captured length against the original bound — or supervise the child with
`Process`, which bounds `lines` and `evidence` separately."

Behavioural sentences checked and found true against the code: `:267-296`, `:329-340`, `:347-349`,
`:356-360`, `:405-450`, `:547-552`, `:650-654`, `:566-573`, `:719-733`, `:740-761`, `:895-912`.
Sentences I could not check: everything whose truth depends on a Windows host — `taskkill` tree
termination (`:366`, `:924-926`), `cmd.exe` quoting end to end (`:425-437`), and libuv's Windows
environment injection (`:476`). The guide itself records that residue as unproven at `:978-981`, which
is the honest disposition.

**10. CONFIRMED.**
Attack: I enumerated the surface by hand from the declarations rather than from the parity gate.
`rg '^export (async function|function|class|const|interface|type)\s+(\w+)' src` yields 67
declarations: `src/core/errors.ts` 6, `src/core/constants.ts` 8, `src/core/types.ts` 18,
`src/server/types.ts` 1, `src/server/Process.ts` 1, `src/server/ProcessManager.ts` 1,
`src/server/helpers.ts` 30, `src/server/factories.ts` 2. Both barrels are pure `export *` over exactly
those files, so the barrel surface is those 67.

The guide's Surface tables carry 67 rows: Factories 2, Runners 3, Entities 3, Guards 1, Error
factories 4, Command helpers 12, Capture helpers 4, Termination helpers 5, Validators 6, Constants 8,
Types 18, Server contracts 1. I matched them name by name; every declaration has exactly one row and
every row has exactly one declaration. The face split is right too. The Methods tables cover
`ProcessInterface.send/stop/destroy` and `ProcessManagerInterface.process/processes/launch/stop/destroy`,
with the three `stop` overloads represented by two rows — complete on names. `package.json:21-43`
declares exactly `.`, `./server`, `./package.json`.

Corroboration whose literals I read: `tests/distribution.test.ts:121-122` and `:195-196` pin the
installed tarball's runtime exports at 14 core and 34 server. My hand-count of the runtime subset is 14
and 34. They agree. **Coverage of my instrument:** source text, same medium as the parity gate. I could
not build, so I did not read `dist/`.

**11. BROKEN. I would not publish this yet.**

1. **A vocabulary split with no ruling.** After PC7 the package has one verb (`execute`) and one noun
   (`run`/`runner`) for the same concept, and nothing states that split is intended. The Vocabulary
   table rules on the identifiers and is silent on the noun, while `### Runners`,
   `### Where the two runners differ`, `## One-shot runs`, and `README.md:8` all use it. PC7 deleted the
   row that used to explain the tension and did not replace it with a row explaining the new one.
2. **`guides/process.md:960` heads a five-row table with "Three names."** Claim 2.
3. **One rule stated in two vocabularies.** `src/core/types.ts:188` reads "No signal is initiated
   after the child's native exit is observed." `src/server/helpers.ts:746` states the same rule as "No
   signal is initiated once the native exit is observed." Both ship in `.d.ts`.
4. **Two orderings for one tier list.** `src/core/types.ts:8` introduces the three tiers as "smallest
   to largest"; `guides/process.md:38` introduces the same three as dividing "by lifetime". The TSDoc
   ordering is not true of the surface it lists. Right looks like: drop "smallest to largest" and use
   the guide's axis.
5. **Unperformable advice in the guide's newest paragraph.** Claim 9.
6. **Ragged wrapping on the published README and in the guide.** Claim 4.

**A refusal that hardened past a legitimate caller — bounded, and I found none.** Candidates checked:
the `%`-in-argument refusal; NUL validation exempting `input`; `ProcessChild` requiring six members
while each helper takes a `Pick` slice; and `isProcessError` refusing an error from a copy earlier than
0.0.4, which is documented at `guides/process.md:753-755` and proved at `tests/guides.test.ts:663-681`.
Nothing here broke.

## Findings outside the claims

**A. The temporal `once` sweep stopped at one line, and the brief's established evidence records the
opposite.**

The brief states, as verified: "`guides/process.md:723` used `once` in the temporal sense and now reads
`after`. Every other `once` in the guide is the counting sense." That is false, and the same defect is
untouched in `src/`.

- `guides/process.md:279` — "Once an iterator has been requested, stdout pauses at the `backlog` mark
  and resumes at half of it." Temporal. This is the one surviving instance in the guide, so the
  established statement does not hold.
- `src/core/types.ts:146` — same sentence. Ships in `dist/src/core/index.d.ts`.
- `src/server/Process.ts:31` — same sentence, third copy.
- `src/server/types.ts:43` — "@param listener - The listener invoked once the process exits." Ships in
  `dist/src/server/index.d.ts`.
- `src/server/helpers.ts:746` — "No signal is initiated once the native exit is observed," against the
  same rule written "after" at `src/core/types.ts:188`.

I enumerated every `once` in `guides/process.md` and `src/`. The remainder are the counting sense, the
`once` code token or the emitter method, or the idiom "at once".

PC8 was handed one line, fixed that line, and the round recorded a universal about the whole guide that
one grep refutes. That universal is now supplied to this round as established evidence, where its job is
to stop a lane from attacking the ground it covers. Right looks like: rewrite the five occurrences above
to `after`, and re-state the established fact as the scope actually searched.

VERDICT: FAIL — 6 broken, 0 unresolved, 0 not-evidenced, 1 finding outside the claims
