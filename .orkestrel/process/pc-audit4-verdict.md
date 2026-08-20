1. **BROKEN**

Executed evidence: the case-insensitive pattern `\b(run|runs|running|ran|runSync|RunResult|RunInput|RunOptions|RunSyncOptions|createRunError|buildRunResult)\b` found `run` vocabulary in `guides/process.md`, `src/core/constants.ts`, `src/core/errors.ts`, `src/core/types.ts`, `src/server/helpers.ts`, and tests. `README.md` was a clean path. The narrower old-identifier pattern found none.

Finding 1: The claim forbids the English noun `run`, but `guides/process.md:972` explicitly retains it under the prior round’s settled vocabulary ruling. Examples include `src/core/types.ts:207` and `src/core/errors.ts:15`. The code has no half-renamed identifier; the claim’s absolute text criterion is false. Narrow the claim to identifiers and function-naming prose. Do not remove the settled English noun.

No `dist/` directory exists in this checkout, so the built-artifact leg was unavailable. The source hits already falsify the universal claim.

2. **CONFIRMED**

Executed evidence: the public-declaration diff and source export sweep found `execute`, `executeSync`, `ExecuteResult`, `ExecuteInput`, `ExecuteOptions`, and `ExecuteSyncOptions`, with no public identifier named on the old axis. `guides/process.md:38-41` divides the tiers by lifetime: `Process` exposes a supervised live child, while `execute` and `executeSync` return buffered one-shot outcomes. `guides/process.md:638-657` distinguishes asynchronous execution from blocking execution by cancellation, tree termination, and overflow behavior. The surviving noun `run` is expressly limited at `guides/process.md:972` to one invocation.

3. **BROKEN**

Executed evidence: case-insensitive sweeps used the spelled-number pattern `\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b`, the ordinal pattern `\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|former|latter)\b`, and the positional pattern `\bslot\s+`?\d+`?\b`. `guides/README.md` was clean.

Finding 2: `tests/guides.test.ts:918` says “Sixteen exports appear in no `guides/process.md` fence.” Exports and guide fences are sets the package can extend. Replace the count with “Exports that appear in no guide fence.”

Finding 3: `src/server/helpers.ts:587-588` names the `counts` list entries as slots `0` and `1`; its `@param` and example also expose the positional tally. Replace the positional tally with named `delivered` and `retained` fields, then update its TSDoc and test.

4. **CONFIRMED**

Executed evidence: `git log` identified `2ec6f9a48bde554ccedcc92b19544c344e6bd804` as the commit whose message is exactly `0.0.3`. The diff to `HEAD` changes the manifest to `0.0.4` and changes public source names. Besides the brief’s listed names, consumers of `RunOptions`, `createRunError`, or `buildRunResult` must change source to use `ExecuteOptions`, `createExecuteError`, or `buildExecuteResult`. This release is not re-pin-only, but a `0.0.x` increment can carry that incompatible surface change.

The supplied `@orkestrel/mcp` import set is unaffected: `Process` and `PROCESS_GRACE` retain their names and exports. This tree provides no evidence about other external consumers.

6. **UNRESOLVED**

Executed evidence: the exact command `npm pack --dry-run` exited `1` and produced no package listing. A verbose repetition reported that npm tried to update the out-of-date `node_modules/.package-lock.json` and failed with `EROFS` under the read-only sandbox. The checkout also has no `dist/` directory. No evidence therefore establishes the packed membership or the absence of `.orkestrel/` and `tmp/`.

In a writable checkout, `npm run build && npm pack --dry-run` would settle the claim.

7. **BROKEN**

Executed evidence: a read-only `@orkestrel/guide` probe compared the compiler-derived aggregate source surface with the guide surface. It reported `67` source symbols, `67` guide symbols, no source-to-guide omissions, and no guide-to-source phantoms. Injected `Absent` and `Phantom` controls each failed in the intended direction. The `test:guides` source already proves both source-to-guide and guide-to-source parity at `tests/guides.test.ts:256-260`.

Finding 4: `guides/process.md:1011-1012` says every flagship fence returns what its comments claim, and `tests/guides.test.ts:1-2` repeats that every flagship fence is transcribed. The guide contains `detach`, `stopChild`, and manual termination-helper fences at lines 675, 904, and 919, but `tests/guides.test.ts` contains no `detach`, `stopChild`, `killProcess`, or `killTree` import or call. Add transcriptions that execute those fences, or remove them from the stated executed population.

VERDICT: FAIL — 3 broken, 1 unresolved, 0 not-evidenced, 0 findings outside the claims