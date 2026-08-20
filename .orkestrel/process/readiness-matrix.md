# process readiness matrix — reconciled 2026-08-20

Lanes returned: canon (Luna), objective (Sol), subjective (Opus reviewer). All rows ruled.

| Row | Finding | Ruling | Carrier |
| --- | ------- | ------ | ------- |
| PR1 | Temporal `once` substitution hits: guides/process.md:387, :937, src/server/helpers.ts:704 | Accepted (canon lane; rule by sense at fix time) | process fix unit |
| PR2 | TSDoc claims the destroy barrier settles before the protocol refusal (src/core/types.ts:401, src/server/ProcessManager.ts:104) while the guide:749 and the reproduced interleaving state the opposite | Accepted with executed evidence; the guide is right, the TSDoc wrong | process fix unit |
| PR3 | README:14 claims every tier has an emitter and cancellation; the one-shot and detached tiers do not | Accepted | process fix unit |
| PR4 | Banned `guarantee` claim at guides/process.md:457 | Accepted (verified in source) | process fix unit |
| PR5 | src/server/helpers.ts imports and constructs the `Retention` class (:34, :847) — class-free leaf rule broken | Accepted (verified in source). Repair by what the function IS: the execution orchestration moves out of the leaf, per .claude/rules/architecture.md § Kind purity | process fix unit |
| PR6 | `execute()` spawns before reading `options.signal`; a throwing getter rejects while the child lives (subject 0.802s vs control 0.066s) | Accepted with executed evidence. Hoist option ownership before spawn; hostile-getter regression proof red-then-green | process fix unit |
| PR7 | Platform-conditioned `skipIf` rows | Verify each cites the mechanism, not the platform alone; scaffold's identical class ruled genuine. Rule per site at fix time | process fix unit |
| PR8 | Artifact proof lacks a TS scratch-consumer compile and a real server call | Partially accepted: add a minimal consumer `tsc` compile under the declared `bundler` resolution and one real server-face call to the Orchestrator's proof. The node10-matrix expansion stays refused per the recorded chair ruling | Orchestrator proof v2 |
| PR9 | Canon lane unresolved rows (policy run, guide parity, production behavior) | Close via the independent verifier's host gates at acceptance | verifier |
| PR10 | Subjective lane: guides/process.md:687-688 offers "the pid" from `Process`; `ProcessInterface` (src/core/types.ts:157) carries no `pid` member (reproduced 2026-08-20) | Accepted; strike "the pid" from the sentence and add no getter | process fix unit |
| PR11 | Subjective lane: `execute` (:817), `executeSync` (:974), and `detach` (:1041) are imperative shell in the leaf `helpers.ts`; convergent with PR5's `Retention` construction | Accepted; one restructure moves the execution orchestration to the kind file `.claude/rules/architecture.md` prescribes; the star-export barrel keeps every published name; no run entity is created | process fix unit (one restructure with PR5) |
| PR12 | Subjective lane: artifact-proof gaps — node16 CJS type resolution through the copied `index.d.cts` file, no real `execute` call from the installed tarball, sourcemap `sources` unswept for host paths | Accepted; folds into the proof v2 additions PR8 carries | Orchestrator proof v2 |
