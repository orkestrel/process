# PC audit round — reconciliation

Two lanes, both Claude Opus 5 in separate clean contexts, blind to each other. GPT-5.6 Sol wrote every
unit under audit, so Sol could not audit it; the substitution is recorded here and both lanes recorded
it themselves. Both returned **VERDICT: FAIL**.

## Claim verdicts, reconciled

| # | Subjective | Objective | Ruling |
| - | ---------- | --------- | ------ |
| 1 | CONFIRMED | CONFIRMED | Confirmed. Both cite the forgery control firing. |
| 2 | FAIL | FAIL | **The claim was wrong, not the code.** There is no respawn path and `buildSpawn` does not validate; each of the four entry points validates its own frozen snapshot and spawns from that same object. Both lanes independently proposed the same corrected wording. Restate; change nothing. |
| 3 | CONFIRMED | CONFIRMED | Confirmed. Both note the test asserts *retained* bytes where the grade's close condition said *drained*; retention is the property that can be bounded, so the test is right and the criterion's wording was wrong. |
| 4 | CONFIRMED | **FAIL** | **Objective wins, and this is a real defect.** The `runSync` half carries `timeout: 400`; the `run` half eight lines later still carries `timeout: 50` — inside the 45.7-49.9 ms bootstrap window the comment above it calls a coin flip, and it waits on no readiness marker. The negative assertion cannot distinguish "the group reached an established grandchild" from "the grandchild never started". The subjective lane read the corrected half and stopped. Repair. |
| 5 | CONFIRMED | CONFIRMED | Confirmed by two executed proofs. |
| 6 | CONFIRMED | FAIL | **The claim was wrong.** Both lanes describe the same mechanism: the deadline is read only after a failed poll, so rejection lands at or after the budget, never inside it, and a slow condition overshoots by its own duration. Restate the claim and tighten the helper's TSDoc to name the bound: budget plus one interval plus one evaluation. |
| 7 | CONFIRMED | CONFIRMED | Confirmed. The objective lane traced it to the installed generator and found the emitted factory byte-identical to the repository's. |
| 8 | CONFIRMED | UNPROVEN | **Objective is right about the evidence.** The repair is commit `b392629`, which is the supplied diff's base, so no line of it was in the review evidence. The classification stands on `posix-first-run.md`, which flags its own single-lane basis. Not a product question; the dispatch supplied the wrong base. |
| 9 | CONFIRMED | CONFIRMED | Confirmed, and bound as an executed value rather than as prose. |
| 10 | UNPROVEN | UNPROVEN | **Unanimous.** The POSIX half is executed and proven. The Windows half is bound by a prose substring that would pass unchanged if the statement were false. |
| 11 | UNPROVEN | UNPROVEN | **Unanimous.** Both codes are documented and neither is asserted. The row's own close condition required the gate to transcribe both codes; what landed transcribes the two English sentences. |
| 12 | UNPROVEN | UNPROVEN | **Unanimous.** The `SIGKILL` half was probed once pre-campaign; the `SIGINT` half was never probed on any host. |
| 13 | CONFIRMED | CONFIRMED | Confirmed. The objective lane re-derived 13 and 33 from the built declarations independently and matched. |
| 14 | UNPROVEN | UNPROVEN | **Unanimous.** No artifact compiles a consumer under any named mode. The exports map is structurally correct, which is why neither lane ruled FAIL. |

**The pattern the round found:** five of the six consumer-facing rows PC4 closed are bound by
`expect(text).toContain(sentence)`. That is the mechanism `.claude/rules/documentation.md` names — the
parity test proves a name exists, never that a sentence about behaviour is true — and it is how the
false `%1` claim survived 51 green parity assertions before this campaign. Q9 was closed correctly,
with an executed value. Q10, Q11, Q12, and Q14 were not.

## Findings carried, with their carrier

Numbering continues the lanes'. `S` is the subjective lane, `O` the objective.

| Finding | Source | Carrier |
| ------- | ------ | ------- |
| The `run` half of the termination proof still runs inside the bootstrap window | Claim 4, O | PC5 |
| Q10, Q11, Q12, Q14 need executed assertions, keeping the substring check only as a presence guard | O18, unanimous claims | PC5 |
| The standalone negative control resolves `@orkestrel/process/absent` against the repository's own `node_modules`, which holds the published 0.0.3 copy — so the control that was seen to fire proved the wrong subject | O15 | PC5 |
| `tests/distribution.test.ts` reads no `import.meta.env.MODE`, so `--mode release` is inert and the `EPERM` tar fallback lets the publish gate pass having proved only that the tarball unpacks | O16 | PC5 |
| A built-artifact assertion inside `tests/src/core/index.test.ts` makes `src:core` build-ordered; on a fresh clone it fails as a missing export | O17 | PC5 |
| Q15 ESRCH guard, Q17 unfenced `@example` blocks, Q19 README parity, Q20 first-wins both armed | grade rows, S18 | PC5 |
| The command-snapshot block is four verbatim copies across `helpers.ts` and `Process.ts` | S15 | PC6 |
| `waitForExit` reads `off`, which `ProcessChild` does not declare, so a caller conforming exactly to the published contract leaks a listener on every deadline | S16 | PC6 |
| The guide promises `lines` is lossless one bullet below the bullet that tells the reader to check `truncated`; the cap made the first false during termination | S17 | PC6 |
| Q16: the POSIX termination table row still names the group-only sequence | S18, O21 | PC6 |
| The guide's Tests section omits `tests/distribution.test.ts` and `tests/setup.test.ts` | S19, O20 | PC6 |
| `tests/setup.test.ts` splits one import in two and carries a case proving a dependency's behaviour under this package's name | S22, O19 | PC6 |
| `ProcessErrorCode`'s five members are re-listed by hand inside the guard, so a sixth code compiles and makes `isProcessError` return `false` for a genuine error | S23 | PC6 |
| `isProcessError` `@remarks` says the brand "survives duplicate installations" without naming the boundary: a `0.0.3` copy carries no brand, and one is installed in this very tree | O22 | PC6 |
| `truncated` carries two meanings on two public surfaces | O23a | PC6 |
| Eleven test renames traded the subject for the applicability condition | O23c | PC6 |
| `mergePlatformEnvironment` puts `platform` first where its three siblings put it last, and takes five positional parameters with two adjacent optional records | S24, O23b | PC6 |
| The platform helper family has grown to seven and `names.md` says promote it to an entity | S24 | **ROADMAP, not this campaign.** The extraction is behaviour-preserving and tested on both branches. Rule on it before a fifth member is extracted. |
| Campaign artifacts sit in the package they are about | O24 | **Known deviation, user-directed.** The user ruled against cross-repo duplication. The folders are being pruned; the placement ends with them. |
| The `setup` project sits outside `tests/config.test.ts`'s expected map, so a registered project is unverified by the gate that exists to verify exactly that | S20 | **Landed in scaffold.** The file is vendored, so the repair belongs upstream and must not be edited here. Red proof: a `setup*.test.ts` present with no registered project gives 1 failed / 27 passed, exit 1; removed, 28 passed, exit 0. |

## Dropped

Nothing. Every finding either has a carrier above or is recorded as a ruling with its reason.
