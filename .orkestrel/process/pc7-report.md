Renamed the execution primitive and every owned consumer without compatibility aliases. No red proof was required because this was an atomic rename.

## Counts

Every cell is a word-boundary occurrence count over `src/`, measured with
`git grep -ohE "\b<token>\b" <revision> -- src/ | wc -l`. `Before` reads `b004a67~1`, the revision
preceding this rename; each `After` reads `b004a67`, this rename's own tip. That pattern admits
neither `runner` nor `runners`, so the `run` row rules on neither word.

The whole table was re-measured on 2026-08-20 and every cell held. The `run` row's `After` cell
previously read `44 English uses`, which was 55 minus 11 rather than a reading of the tree; the
number now beside it is what the instrument returns. The residual grep output that follows opens
with the 41 `src/` lines those 44 occurrences sit on, three of which carry two each.

| Original | Before | After | Replacement | After |
| --- | ---: | ---: | --- | ---: |
| `run` | 55 | 44 | `execute` | 11 |
| `RunResult` | 23 | 0 | `ExecuteResult` | 23 |
| `createRunError` | 6 | 0 | `createExecuteError` | 6 |
| `runSync` | 4 | 0 | `executeSync` | 4 |
| `buildRunResult` | 4 | 0 | `buildExecuteResult` | 4 |
| `RunSyncOptions` | 3 | 0 | `ExecuteSyncOptions` | 3 |
| `RunOptions` | 3 | 0 | `ExecuteOptions` | 3 |
| `RunInput` | 3 | 0 | `ExecuteInput` | 3 |

## Residual grep output

```text
src/server/helpers.ts:68: * Keeps the head — the captured start of a one-shot run's output. When the cut point lands inside
src/server/helpers.ts:782: * Builds one settled {@link ExecuteResult} from a completed run's captured bytes and terminal facts.
src/server/helpers.ts:785: * `failed` is derived: a run failed when it timed out, was aborted, ended on a host fault, was ended
src/server/helpers.ts:791: * @returns The frozen run outcome
src/server/helpers.ts:831: * The executable is resolved through {@link buildSpawn}, so no run uses a shell. On a POSIX host the
src/server/helpers.ts:837: * a bounded window, so a descendant holding the child's stdio cannot keep the run pending. That bound
src/server/helpers.ts:838: * covers a terminated run alone: a run with no `timeout` and no `signal` settles on stdio completion
src/server/helpers.ts:839: * rather than on process exit, so a descendant that inherited the child's stdio holds the run open
src/server/helpers.ts:840: * after the child itself has gone. Give such a run a `timeout`. The child's `environment` merges over
src/server/helpers.ts:842: * overrides `command.input`. Unless `strict` is `false`, a failed run rejects with a
src/server/helpers.ts:848: * @returns The settled run outcome
src/server/helpers.ts:849: * @throws A {@link ProcessError} coded `invalid` for a malformed option, command string, or batch-bound argument, or one carrying the {@link ExecuteResult} when the run failed and `strict` is not `false`
src/server/helpers.ts:994: * {@link execute}. Unless `strict` is `false`, a failed run throws a {@link createExecuteError}
src/server/helpers.ts:999: * @returns The run outcome
src/server/helpers.ts:1000: * @throws A {@link ProcessError} coded `invalid` for a malformed option, command string, or batch-bound argument, or one carrying the {@link ExecuteResult} when the run failed and `strict` is not `false`
src/core/constants.ts:13:/** The default maximum captured bytes for a one-shot run's stdout and stderr, each. */
src/core/types.ts:208: * The settled outcome of a one-shot run: the buffered output and the terminal state.
src/core/types.ts:212: * failed to spawn. `expired` and `aborted` are the two ways the run ended the child rather than the
src/core/types.ts:215: * synchronous run and does not fail an asynchronous one. `ProcessInterface` carries the same name for
src/core/types.ts:220:	/** The command line that was run, for diagnostics. */
src/core/types.ts:229:	/** True if the run did not complete successfully. */
src/core/types.ts:231:	/** True if the run's `timeout` elapsed before completion. */
src/core/types.ts:233:	/** True if the caller's `signal` aborted the run before completion. */
src/core/types.ts:245: * that ended the run, when one did; its presence alone marks the run failed.
src/core/types.ts:256:	/** If `true`, the run's own timeout elapsed; if `false`, it did not. */
src/core/types.ts:258:	/** If `true`, the caller's signal aborted the run; if `false`, it did not. */
src/core/types.ts:264:	/** The host fault that ended the run, when one did. */
src/core/types.ts:269: * Options for a one-shot run.
src/core/types.ts:272: * A run is a fire-and-collect function, not a lifecycle entity, so it carries no emitter. `strict`
src/core/types.ts:277: * no NUL restriction. An unbounded run awaits stdio completion rather than process exit, so give
src/core/types.ts:292:	/** Aborting this signal terminates the run and reports `aborted`. */
src/core/types.ts:301: * Options for a synchronous one-shot run.
src/core/types.ts:452:	/** The command line involved, for a run or spawn failure. */
src/core/types.ts:470:	/** The buffered run outcome, present when an {@link ExecuteResult} produced the failure. */
src/core/errors.ts:15:	/** The buffered run outcome, present when a one-shot run produced the failure. */
src/core/errors.ts:22:	 * @param options - Machine-readable category, optional context, optional cause, and optional run result
src/core/errors.ts:111: * Creates the failure raised when a run does not complete successfully and rejection is requested.
src/core/errors.ts:114: * The category is `timeout` only when the run's own timeout elapsed; every other failure,
src/core/errors.ts:118: * @param result - The buffered run outcome that failed
src/core/errors.ts:119: * @param cause - The underlying host fault, when one ended the run
src/core/errors.ts:120: * @returns A typed run failure carrying its {@link ExecuteResult}
tests/src/server/helpers.test.ts:743:	// refuses a negative pid there, so only a POSIX host can run this.
tests/src/server/helpers.test.ts:751:				// The control is the pre-repair route run on its own: signalling the negated pid reports
tests/src/server/helpers.test.ts:796:	it('buffers a successful run and reports it did not fail', async () => {
tests/src/server/helpers.test.ts:806:	it('rejects a failed run with a process error carrying the result', async () => {
tests/src/server/helpers.test.ts:817:	it('resolves a failed run with the outcome when strict is false', async () => {
tests/src/server/helpers.test.ts:827:	it('reports a run that outlasted its timeout as expired rather than aborted', async () => {
tests/src/server/helpers.test.ts:839:	it('reports an externally aborted run as aborted rather than expired', async () => {
tests/src/server/helpers.test.ts:855:	// Both mechanisms armed on one run. The first to fire terminates the child and disarms the other,
tests/src/server/helpers.test.ts:957:	it('refuses a NUL in a per-run environment override before spawning', async () => {
tests/src/server/helpers.test.ts:1083:	it('buffers a successful synchronous run', () => {
tests/src/server/helpers.test.ts:1089:	it('resolves a failed synchronous run with the outcome when strict is false', () => {
tests/src/server/helpers.test.ts:1098:	it('throws a process error for a failed synchronous run by default', () => {
tests/src/server/helpers.test.ts:1109:	it('fails a synchronous run whose output overflowed the limit', () => {
tests/src/server/helpers.test.ts:1155:	it('refuses a NUL in a per-run environment override before spawning', () => {
tests/setupPolicy.ts:1468: * Write a control to a real temporary workspace and run the production sweep over it.
tests/setupPolicy.ts:1661:				content: 'export const HANDLERS = Object.freeze({ run: () => undefined })\n',
tests/distribution.test.ts:64:			// and says nothing about whether a consumer can install it. An ordinary local run inside a
tests/setup.test.ts:16:		// asserted as a relationship to the budget rather than as the number one run produced.
tests/config.test.ts:409:			'vitest run --config vite.config.ts --no-cache --reporter=dot --project config',
tests/config.test.ts:411:		expect(typeof test === 'string' && test.includes('npm run test:config')).toBe(true)
tests/config.test.ts:414:				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project distribution'
tests/config.test.ts:418:		expect(typeof publish === 'string' && publish.includes('npm run test:distribution')).toBe(
tests/config.test.ts:424:				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project integration'
tests/config.test.ts:430:		expect(typeof test === 'string' && test.includes('npm run test:integration')).toBe(
tests/config.test.ts:433:		expect(typeof publish === 'string' && publish.includes('npm run test:integration')).toBe(false)
tests/config.test.ts:441:				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project conformance'
tests/config.test.ts:444:		expect(typeof test === 'string' && test.includes('npm run test:conformance')).toBe(
tests/config.test.ts:449:				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project service'
tests/config.test.ts:452:		expect(typeof test === 'string' && test.includes('npm run test:service')).toBe(
tests/config.test.ts:455:		expect(typeof publish === 'string' && publish.includes('npm run test:service')).toBe(
tests/config.test.ts:494:	tester.run('no-mocking', MOCKING_RULE, {
tests/config.test.ts:534:	tester.run('no-keyword-privacy', PRIVACY_RULE, {
tests/guides.test.ts:1:// The guides-parity gate: @orkestrel/guide's checks run against this repository's own
tests/guides.test.ts:392:// Each row that follows is one `guides/process.md` fence, run against the real barrels, asserting the
tests/guides.test.ts:433:	// against its retention bound, and a one-shot run against its capture `limit`.
tests/guides.test.ts:658:		// A released abort listener leaves the signal with nothing to run, so a later abort is inert.
tests/guides.test.ts:830:	it('builds and wraps the run result the errors fence assembles', () => {
guides/test.md:126:| `PortfolioOptions`   | interface | `{ states, variants, variant, directory, enabled? }` — the registry, the matrix, this run's variant, where it writes, and whether it writes at all. |
guides/test.md:127:| `PortfolioInterface` | interface | `{ variant, states, paths, files }` plus `place` — one run's registry and what it placed.                                                           |
guides/test.md:165:| `createPortfolio` | function | `(options: PortfolioOptions) => PortfolioInterface` | The capture registry one run places its screenshots through. |
guides/test.md:199:`createPortfolio` refuses an unregistered variant name at creation, so a run cannot write a filename
guides/test.md:200:naming a combination it did not render. A portfolio left un-`enabled` is the ordinary run: `place`
guides/test.md:207:The filename law is injective within one run: one variant is selected, and every filename is
guides/test.md:329:| `place` | `Promise<string \| undefined>` | Places one registered state: applies the variant, resizes the viewport when it differs, writes the screenshot, records it, and returns the written path. `undefined` and no record at all when the run is not enabled. |
guides/test.md:566:    rejects does not stop the run: every remaining handler still runs, and the failures are raised
guides/test.md:568:    threw. Several are wrapped in an `AggregateError` whose `errors` are in run order — newest
guides/test.md:570:    handler registered while the run is in progress stays registered for the next call rather than
guides/test.md:606:    import, no framework, no `node:*`, and no `import.meta.env`, so whether a run writes captures is
guides/test.md:618:out a sibling test worker or the code under test, because both run as the same uid, and they are the
guides/test.md:980:Register the cleanup where you take the resource, then let one hook run all of it. The list reverses
guides/test.md:1086:The registry is declared once, the run renders one variant, and the same expansion answers both
guides/test.md:1108:	// This example is an enabled capture run. A real suite can supply its own gate here.
guides/test.md:1117:// A run that omits `enabled` returns undefined here, resizes nothing, and records nothing.
guides/test.md:1157:  with every remaining handler still run, both together aggregated in run order, a handler added
guides/test.md:1158:  during a run kept for the next call, the count reset before the handlers run, and a `destroy()`
guides/test.md:1178:  name; a run that is not
guides/test.md:1179:  enabled applies nothing, writes nothing, and records nothing; an enabled run applies the variant,
guides/process.md:89:| `createExecuteError`   | function | The failure a rejecting run raises, carrying its `ExecuteResult`.         |
guides/process.md:159:| `PROCESS_OUTPUT`       | const | `10_485_760`            | Default maximum captured bytes for a run's stdout and stderr, each. |
guides/process.md:527:| `signal`      | `AbortSignal`                         | none                  | Aborting this signal terminates the run and reports `aborted`.           |
guides/process.md:547:A run with no `timeout` and no `signal` is unbounded, and what it waits for is stdio completion
guides/process.md:549:the child itself has exited, and the run stays pending for as long as the descendant lives. Give
guides/process.md:551:below applies to a terminated run and cannot rescue one that was never bounded.
guides/process.md:560:| `failed`    | The run did not complete successfully, whatever ended it.                  |
guides/process.md:561:| `expired`   | The run's own `timeout` elapsed before completion.                         |
guides/process.md:562:| `aborted`   | The caller's `signal` aborted the run before completion.                   |
guides/process.md:565:`failed` is derived: a run failed when it expired, was aborted, ended on a host fault, was ended by a
guides/process.md:568:the two ways the run ended the child rather than the child ending itself, and only the first of them
guides/process.md:574:By default a failed run rejects with a `ProcessError` carrying the `ExecuteResult` on its `result`
guides/process.md:575:property. An expired run carries code `timeout`; every other failure carries code `spawn`. Passing
guides/process.md:581:// Rejecting form (the default): a failed run throws.
guides/process.md:608:run. `executeSync` hands `limit` to the host as its buffer ceiling, so an overflow ends the child with
guides/process.md:641:| Cancellation    | An `AbortSignal` terminates the run and sets `aborted`.   | None; the host offers no in-flight cancellation.     |
guides/process.md:642:| Overflow        | Reports `truncated` and keeps the run successful.         | Reports `truncated` and `failed`, killing the child. |
guides/process.md:651:holding the child's stdio cannot keep a terminated run pending forever. Nothing bounds a run that was
guides/process.md:652:never terminated: with no `timeout` and no `signal` there is no deadline to reach, and the run waits
guides/process.md:744:| `spawn`     | A rejecting run failed for a reason other than its own timeout. |
guides/process.md:745:| `timeout`   | A rejecting run's own `timeout` elapsed before completion.      |
guides/process.md:757:A run failure carries its `ExecuteResult` on `error.result`, and its command line, exit `code`, and
guides/process.md:789:`createExecuteError` is the factory behind a rejecting run, and `buildExecuteResult` assembles the result it
guides/process.md:884:		command: { file: 'npm', arguments: ['run', task] },
guides/process.md:939:  `lines` omission, and a run reports the `limit` it hit; a synchronous run fails on that limit while
guides/process.md:940:  an asynchronous run does not.
guides/process.md:949:- **Give `execute` a `timeout` when the command can start a descendant** — an unbounded run waits on
guides/process.md:967:| `evidence`, `backlog`    | Byte bounds are named for their subject where an entity has several, so a `Process` carries `evidence` and `backlog` rather than two flavours of `limit`. A run has one bound, so it is named for the bound: `limit`.            |
guides/process.md:978:pre-`b392629` form was last proven on Windows; the current fixtures have not run there. The exact
guides/process.md:980:root. On a Windows host, settle it and re-run every server row with this command:
guides/process.md:983:npx vitest run --config vite.config.ts --no-cache --project src:server
guides/guide.md:24:iterates to run this check once per documented concept.
guides/guide.md:397:run, `import.meta.glob('/**/*.ts', { eager: true, query: '?raw', import: 'default' })` in a
guides/guide.md:398:browser/vitest run, or a static bundle in any other environment. This keeps the package
guides/guide.md:513:- [`tests/guides.test.ts`](../tests/guides.test.ts) — the drop-in guides-parity suite, run against THIS repo's own `guides/README.md` manifest — the self-dogfooding acceptance criterion.
guides/contract.md:23:The `*Field` parsers read a (possibly nested) record field via a `FieldPath` (`string | readonly string[]`, in [`src/core/types.ts`](../src/core/types.ts)) — a single string is **one** key (no dot-splitting); an array descends own properties of nested objects/arrays through the `resolveField` core helper. The root must satisfy `isRecord`, and inherited properties are rejected at every segment. This is deliberate: a field reader receives a record, so accepting a root the module's record guard rejects or a value visible only through its prototype would contradict that contract; arrays remain supported as nested containers because indexed path segments are their own properties. The `whereOf` / `lazyOf` / `transformOf` combinators run caller-supplied callbacks _inside_ a guard body; they contain any throw via the core `attempt` helper, so even a guard that runs your code stays total and returns `false` rather than propagating.
guides/contract.md:217:| `drawRandom`            | function | Draw one sample from a caller-supplied `RandomFunction` and validate it — a source that throws, or returns anything outside `[0, 1)`, raises a `ContractError` with code `random`, naming the consuming shape category, the `[0, 1)` limit, and a total non-coercing `preview` of the offending sample (or `threw`), so hostile objects cannot run conversion hooks while the diagnostic is built and primitive symbols render without consulting mutable `Symbol.prototype.toString`. A thrown source value is retained exactly as `cause`. A broken source is a fault of the SOURCE, not of the shape, so it never wears the `generate` code and is never swallowed by union rotation: `compileGenerator` rethrows a `random` failure raised at any draw depth instead of trying the next variant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
guides/contract.md:305:Six refusal families may throw, and whenever they do they throw only this class: REQUIRED READS (`readValue` and the public inferer/helper/combinator/compiler readers layered over it — normally `structure` with `<reader>: <subject> could not be read`, while `RegExp` readers use `pattern`), shape CONSTRUCTION (every builder validates every runtime argument position before returning — `bound` / `range` / `empty` / `placement` / `pattern` / `literal` / `structure`), CLONING (`cloneJSONValue` / `cloneJSONRecord` for inexact JSON data, cycles, or hostile traversal; `cloneSchema` / `cloneShape` / `ownShape`, and `rawShape` through its snapshot — `clone` plus declaration-policy codes), VALIDATION (`validateShapeDepth` and `ShapeValidator` — `range` / `empty` / `placement` / `structure` / `literal` / `cycle` / `bound` / `pattern`), the COMPILATION gate (all six `compile*` exports plus `createContract` route through that same `validateShapeDepth` — the same declaration-policy codes, plus `depth`), and GENERATION (`compileGenerator` on an unsatisfiable request — `generate`; `drawRandom` on a broken sample source — `random`). Every message opens with the reader that OWNS the rule it enforces, never the engine that happened to run it. A declaration rule belongs to the shared gate and reads `validateShapeDepth: …` wherever it is applied, including inside `ShapeCloner`, which enforces the same rules while capturing; `cloneShape: …` is reserved for the ownership rules the cloner itself owns — own data discriminants, inherited fields, accessors, read stability, unreadable property maps, and a failed snapshot; and `ShapeCloner.clone: …`, `SchemaCloner.clone: …`, `JSONCloner.clone: …` and `ShapeValidator.validate: …` name a refusal about the CALL rather than the declaration, such as reentry. One rule therefore has one diagnostic at each of those doors: `cloneShape`, `ownShape`, `validateShapeDepth`, `ShapeValidator`, all six compilers and `createContract` report the same malformed declaration with the same code and the same message, across every declaration-policy family the gate owns (`placement`, `range`, `bound`, `pattern`, `empty`, `literal`, `cycle`, `depth`, `structure`). That is a statement about those eleven doors and those families, enforced by a sweep rather than asserted: it says nothing about a door outside the list. `createContract` observes its caller’s source twice — once as the declaration, once while cloning it — so a LIVE declaration that changes between those walks can be refused by ownership rather than by the gate, and each refusal names the boundary that owns the rule it broke. An error adopted by identity from another engine keeps the prefix that engine gave it. Hand-authored string declarations use the same unflagged-pattern policy as builders: a stable genuine `RegExp` carrying flags is a `pattern` refusal, and inline pattern constructs are the supported alternative. Total guards and optional readers use their non-throwing outcomes; `compileReporter` contains its diagnostic walk, while required `parse`/`audit` reads and schema inversion refuse traversal failure. Root ownership, including the frozen-state probe itself, is contained before standalone compilation begins: a revoked `Proxy`, throwing getter, or caller-thrown value becomes a coded `clone` / `structure` `ContractError`. Malformed containers, hostile proxies, and wrong primitives at any builder position become coded `ContractError` values. Every public door that can refuse runs its whole body through `contain`, which republishes anything that is not this class under the door's own name with the exact thrown value as `cause`; a door whose body cannot throw carries no boundary, because wrapping code that cannot fail misreports where the refusals are. A boundary placed per STATEMENT is only ever as complete as the last sweep — four consecutive rounds repaired the statements they were shown and were defeated by a statement one line later — while a boundary at the door covers whatever the body reaches, enumerated or not. Two limits are named rather than promised away. A boundary covers a BODY, so it cannot reach a parameter-default initializer, which is evaluated in the function environment before the first statement runs: the one such default this package had (`compileGenerator`'s wall-clock seed) was moved into the contained body, and any future computed default belongs there too. And a boundary is not a fidelity guarantee: containment answers what a door may THROW, while what a door PUBLISHES under a redirect that lies instead of throwing is the separate job of `INTRINSICS`, the module-scope membership functions layered over it, and the indexed publication walks. That enumeration was previously presented as exhaustive and was not: `RegExp.prototype.test` sat in none of the three and decided what `compileSchema`, `valueToSchema`, `audit`, `explain`, `is` and `parse` published. It is exhaustive only in the sense that every one of those sites is now reached from the captured table — which is a claim a sweep checks, not a claim this sentence makes.
guides/contract.md:349:| `cloneJSONValue`   | function | Validates and snapshots one `unknown` value as exact JSON. Finite primitives retain identity; an iterative descriptor walk requires exact array-key membership and copies dense branded arrays plus plain/null-prototype/cross-realm records into deeply frozen standard arrays and null-prototype records. Frozen/nonwritable data indices are accepted and their flags normalized. Repeated noncyclic aliases become distinct equal branches; cycles and inexact properties fail; accessors never run; every failure is a new cause-free `clone` `ContractError` with `context.shape === 'json'`. Alias duplication is the tree contract and stays, but its COST is now bounded: the walk counts the nodes it produces and refuses past `CLONE_NODE_LIMIT` with `cloneJSONValue: snapshot exceeds the node limit`. Without that bound an ordinary in-memory graph of twenty-one objects — a few hundred bytes, no attacker, shared references are normal data — produced two million nodes and took seconds, and thirty aliases took hours.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
guides/contract.md:534:| `inferSamples`         | function  | slot values + depth + breadth + `closed` + `format` + `enumOn` + an optional `memo` → `JSONSchema` — the shared non-record recursion step behind `samplesToSchema` (top level) and `inferRecordSamples` (per key). The optional `(row, remaining depth) → schema` memo is the sample walk's bound; it is created here when a direct caller omits it, changes no emitted schema, and is threaded through the whole walk. `breadth` passes through `sanitizeBudget`; a sparse slot list is refused as `inferSamples: samples must be a dense array`. Record-only value lists delegate to `inferRecordSamples`; otherwise enum inference runs first (`inferPrimitiveEnum`), then each value is classified via `inferValue` with `format` forced off and unified — only when that unified result is exactly `{ type: 'string' }` does `samplesToFormat` run to (maybe) reattach `format`.                                                                                                                                                                                                                                                                                                                                         |
guides/scaffold.md:43:| `CompileStage`      | type | The three compile phases, in the order they run.                                                 |
guides/scaffold.md:248:| `Compiler`      | class | The compile spine: draft, gate, pin, run in that order over a blueprint.    |
guides/scaffold.md:515:`--project value` and `--project=value` forms and follows literal `npm run` calls. A shell expansion
guides/scaffold.md:564:| `overwrite` | The `catalog` value plus `audit`, `releases`, and `note` on a partial run  |
guides/scaffold.md:628:`test:<project>` script and invoke that script from a gate chain; then run `repair`, which
guides/scaffold.md:685:beside them, and the stages after a failed one never run.
guides/scaffold.md:775:a path, not what one run did there. Counting planned findings by `content`, `presence`, and `birth`
guides/scaffold.md:777:repaired one. What one run compared comes from `ownership`, `drift`, and `observed` together. A
guides/scaffold.md:882:path at once. That is why `guides/scaffold.md` — this file — must exist before `npm run build`
guides/scaffold.md:1078:cannot be run: several declare an ambient value that has no runtime, and several write to a
guides/scaffold.md:1123:`distribution` and `service` run from `prepublishOnly` and `conformance` stays in `test`. In a
guides/scaffold.md:1132:`prepublishOnly` invokes it as `npm run test:distribution -- --mode release`, and a proof that reads
guides/scaffold.md:1134:ordinary local run may skip that case, because a developer offline is not a defect; a release run
guides/scaffold.md:1143:names that module by path, so an absent one fails the project's load rather than its run — and still
guides/scaffold.md:1156:port, so the run drives nothing external and stays in `test`.
```

The output contains no `runSync` or `Run[A-Z]` match. The non-English `run` tokens belong to npm, Vitest, the Oxlint tester, or an unrelated policy fixture.

## `Runs` judgments

- [src/server/helpers.ts](/workspace/process/src/server/helpers.ts:828): “Runs one command…” is the English third-person verb opening the asynchronous function’s TSDoc.
- [src/server/helpers.ts](/workspace/process/src/server/helpers.ts:984): “Runs one command… synchronously” is the same English TSDoc form for the synchronous function.

Neither occurrence names the former API.

## Gates

| Command | Exit | Status |
| --- | ---: | --- |
| `npm run format:check` | 0 | Criterion |
| `npm run lint:check` | 0 | Criterion |
| `npm run check` | 0 | Criterion |
| `npm run build` | 0 | Observation |
| `npm test` | 1 | Observation: 95 passed, 22 failed, 7 skipped. The sandbox denied child execution; failures showed `spawnSync … EPERM`, empty child output, and child-dependent timeouts. |
| `npm run test:distribution` | 1 | Observation: `npm pack failed: spawnSync npm EPERM`. |

## Files changed

- [README.md](/workspace/process/README.md)
- [guides/process.md](/workspace/process/guides/process.md)
- [src/core/errors.ts](/workspace/process/src/core/errors.ts)
- [src/core/types.ts](/workspace/process/src/core/types.ts)
- [src/server/helpers.ts](/workspace/process/src/server/helpers.ts)
- [tests/guides.test.ts](/workspace/process/tests/guides.test.ts)
- [tests/src/core/index.test.ts](/workspace/process/tests/src/core/index.test.ts)
- [tests/src/server/helpers.test.ts](/workspace/process/tests/src/server/helpers.test.ts)
- [tests/src/server/index.test.ts](/workspace/process/tests/src/server/index.test.ts)