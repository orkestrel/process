### Claim 1

Verdict: CONFIRMED  
Evidence: `tests/guides.test.ts:703`, the POSIX-only test reads the child’s real environment and asserts `PATH` is absent at line 713.

### Claim 2

Verdict: CONFIRMED  
Evidence: `tests/src/server/helpers.test.ts:942` asserts the asynchronous result code is negative; `tests/src/server/helpers.test.ts:1139` asserts the synchronous result code is `null`.

### Claim 3

Verdict: CONFIRMED  
Evidence: `tests/src/server/helpers.test.ts:1273`, the grouped child records `SIGINT` while the detached child does not; lines 1281-1289 then prove the grouped child stops after group `SIGKILL` while the detached heartbeat advances.

### Claim 4

Verdict: CONFIRMED  
Evidence: `tests/distribution.test.ts:228`, the installed consumer is compiled under `node16`, `nodenext`, and `bundler`; lines 261-298 make `node10` the firing control and assert the exact supported set.

### Claim 5

Verdict: CONFIRMED  
Evidence: `tests/src/server/helpers.test.ts:1000`, the asynchronous timeout is 200 ms rather than the bootstrap-racing 50 ms; lines 1012-1021 require the readiness marker before asserting that the final marker remains absent.

### Claim 6

Verdict: CONFIRMED  
Evidence: `tests/distribution.test.ts:90`, `createRequire` is rooted at the temporary consumer’s `control.cjs`; line 91 resolves the absent subpath from that consumer.

### Claim 7

Verdict: CONFIRMED  
Evidence: `tests/distribution.test.ts:62`, the install fallback checks `import.meta.env.MODE`; lines 66-68 throw on install failure under `release`.

### Claim 8

Verdict: CONFIRMED  
Evidence: `tests/src/core/index.test.ts:47` states that the source project reads source alone; `.orkestrel/process/pc-audit2-log.txt:96` records `test:src` passing with `dist/` moved aside at 113 passed and 7 skipped.

### Claim 9

Verdict: CONFIRMED  
Evidence: `tests/src/server/helpers.test.ts:744`, the POSIX test spawns a real non-detached child; lines 751-770 prove the negated-pid control returns `ESRCH`, leaves the child alive, and the repaired helper produces an observed `SIGKILL` exit.

### Claim 10

Verdict: CONFIRMED  
Evidence: `tests/guides.test.ts:820` records 16 compiler-discovered unfenced examples; lines 826-910 transcribe 14 table rows, `retainChunk`, and `resolveExecutable`. `.orkestrel/process/pc-audit2-log.txt:93` records that the compiler-derived count corrected the grade’s 12.

### Claim 11

Verdict: CONFIRMED  
Evidence: `tests/guides.test.ts:935`, the README parity suite checks backticked names at lines 958-970 and relative links at lines 973-982.

### Claim 12

Verdict: CONFIRMED  
Evidence: `tests/src/server/helpers.test.ts:852`, three tests arm both mechanisms: timeout-first at lines 854-872, abort-first at lines 874-889, and equal deadlines at lines 891-910. Each asserts mutually exclusive `expired` and `aborted` results.

### Claim 13

Verdict: CONFIRMED  
Evidence: `src/server/helpers.ts:112` contains the sole `snapshotCommand` implementation; its four callers are `src/server/Process.ts:102` and `src/server/helpers.ts:857`, `1005`, and `1072`. `src/server/index.ts:2` exports the helper barrel, and `dist/src/server/index.d.ts:717` declares it.

### Claim 14

Verdict: CONFIRMED  
Evidence: `src/server/types.ts:25` declares `pid`, `exitCode`, `signalCode`, `kill`, `once`, and `off`. `tests/src/server/helpers.test.ts:481` supplies exactly the `waitForExit` slice and asserts that its listener collection is empty at line 492.

### Claim 15

Verdict: CONFIRMED  
Evidence: `src/core/constants.ts:23` defines the frozen tuple; `src/core/types.ts:446` derives the union from it; `src/core/errors.ts:64` derives guard admission from the same tuple. `tests/src/core/index.test.ts:35` iterates every tuple member and includes an outside-population refusal control.

### Claim 16

Verdict: CONFIRMED  
Evidence: `guides/process.md:973` rules `truncated` as the single fact that a surface omitted output. `tests/guides.test.ts:434` drives both public surfaces and asserts both flags are `true` at lines 460-461.

### Claim 17

Verdict: CONFIRMED  
Evidence: `.orkestrel/process/pc-audit2-diff.txt:1` records the `HANDOFF.md` deletion. `.orkestrel/process/pc-audit2-log.txt:39` records the disposition: product behavior and naming reached the guide, Windows residue received an explicit settling command, and live adopter state and republish procedure were intentionally dropped.

## Continuing findings

### Finding 18

Verdict: FAIL  
Evidence: `guides/process.md:602` tells a consumer to compare each captured string’s byte length with `limit` to distinguish which stream overflowed. `src/server/helpers.ts:916` collapses both delivered-byte comparisons into one Boolean, and `src/server/helpers.ts:809` returns no per-stream overflow field. A pure shipped-helper probe delivered 16 stdout bytes and 17 stderr bytes at limit 16, yet returned two 16-byte strings with `truncated: true`; the lengths cannot identify the overflowing stream.

### Finding 19

Verdict: FAIL  
Evidence: `src/server/types.ts:14` says `ProcessChild` carries “the same five members,” but lines 16-19 enumerate six, and lines 25-58 declare all six.

### Finding 20

Verdict: FAIL  
Evidence: `.orkestrel/process/pc-audit2-log.txt:35` says eleven tests were renamed. The retained diff contains only ten removed test names, from `.orkestrel/process/pc-audit2-diff.txt:6736` through line 7000. The ten replacement names match their test bodies, but the audit record’s count is false.

### Finding 21

Verdict: CONFIRMED  
Evidence: `guides/process.md:363` adds the previously uncovered POSIX direct-child fallback to the termination table, matching `src/server/helpers.ts:671-675`.

### Finding 22

Verdict: CONFIRMED  
Evidence: `tests/setup.ts:13` accurately bounds `waitForCondition` by the budget plus one interval and one condition evaluation; `tests/setup.test.ts:36` proves rejection occurs at or after the named budget, and the dependency-only assertion was removed.

VERDICT: FAIL