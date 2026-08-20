# PFIX-C report

## Outcome

The brief's implementation criteria are closed. `Retention` replaces the mutable accumulator record, the refusal rows carry an anti-rot control, the redundant abort assertion is gone, release mode is asserted before distribution work, and the unproved teardown duration claim is removed. The sandbox prevented the host-only child and install readings listed under Observations.

## Files touched

The source changes are:

- `src/server/Retention.ts` adds the bounded stream-head entity with `#delivered` and `#retained` fields, readonly accessors, and the `retain` method.
- `src/server/types.ts` replaces the mutable accumulator record with `RetentionInterface`.
- `src/server/helpers.ts` removes `retainChunk` and uses one `Retention` instance per output stream.
- `src/server/index.ts` exports `Retention`.
- `src/server/Capture.ts` from the stopped run is removed after its implementation is carried into `Retention.ts`.

The proof and guide changes are:

- `tests/src/server/Retention.test.ts` replaces the stopped `Capture.test.ts` file and proves totals across a truncating stream.
- `tests/src/server/helpers.test.ts` removes the superseded `retainChunk` row.
- `tests/guides.test.ts` aligns the renamed surface, compares each refusal row with its neighbouring published face, lists shared names beside each row, removes the post-abort zero-listener assertion, and transcribes the worked `Retention` fence.
- `tests/distribution.test.ts` makes `expect(import.meta.env.MODE).toBe('release')` the first assertion.
- `guides/process.md` documents `Retention`, adds its worked method fence, removes the superseded helper, and removes the unproved duration bound.

No off-limits file changed. `package.json` and the package version did not change.

## Entity declaration

The public declaration is:

```ts
export interface RetentionInterface {
	readonly delivered: number
	readonly retained: number
	retain(chunk: unknown, limit: number): Buffer | undefined
}

export declare class Retention implements RetentionInterface {
	get delivered(): number
	get retained(): number
	retain(chunk: unknown, limit: number): Buffer | undefined
}
```

## A5 ruling

Removed the duration claim. The guide still states that the `destroy` barrier does not cover the child's asynchronous teardown, but it no longer claims completion within `grace` plus the confirmation window. No timing guarantee remains for a test to bind or drive.

## Red-then-green reading

Command:

```text
npx vitest run --config vite.config.ts --project src:server tests/src/server/Retention.test.ts
```

- Red: exit `1`; test files: `1 failed`; tests: `1 failed`. The collected test expected `hel` and received `undefined` from the incomplete `retain` method.
- Green after implementation: exit `0`; test files: `1 passed`; tests: `1 passed`.
- Final green reading: exit `0`; test files: `1 passed`; tests: `1 passed`.

## Refusal anti-rot control

The exact mutation steps were:

- Plant: append the following declaration to `src/server/types.ts`:

  ```ts
  /** Plants a temporary neighbouring-face export for the refusal-list control. */
  export type RefusalPlant = never
  ```

- Failing control: run `npx vitest run --config vite.config.ts --project guides tests/guides.test.ts -t 'keeps the refusal list aligned'`. Exit `1`; test files: `1 failed`; tests: `1 failed`, `1 passed`, `96 skipped`. The core-face row reported the missing `RefusalPlant` name from the neighbouring server surface.
- Remove: delete the exact temporary comment and `RefusalPlant` alias from `src/server/types.ts`.
- Clean reading: rerun the same command. Exit `0`; test files: `1 passed`; tests: `2 passed`, `96 skipped`.
- Final clean reading after the worked fence was added: exit `0`; test files: `1 passed`; tests: `2 passed`, `97 skipped`.

## Criteria

The acceptance readings are:

| Criterion | Command and reading | Exit | Counts |
| --- | --- | ---: | --- |
| Readonly totals | `rg -n '^\s+(delivered\|retained): number' src/` returned no hits. | `1` | hits: `0` |
| Readonly public interfaces | `node tmp/codex/check-readonly.mjs` parsed every interface property under `src` and reported `All interface properties in src are readonly.` The temporary probe was then deleted. | `0` | violations: `0` |
| Removed identifier | `rg -n 'Capture' src/ tests/ guides/process.md README.md` returned no hits. | `1` | hits: `0` |
| Retention behavior | The identical narrow command recorded the red and green readings under Red-then-green reading. | `0` final | test files: `1 passed`; tests: `1 passed` |
| Refusal anti-rot | The exact plant failed and its removal passed under the identical targeted command. | `1` planted; `0` removed | planted: `1 failed`, `1 passed`, `96 skipped`; removed final: `2 passed`, `97 skipped` |
| Release mode, ordinary invocation | `npm run test:distribution` reached the first assertion and reported expected `release`, received `test`. | `1` | test files: `1 failed`; tests: `1 failed` |
| Release mode, release invocation | `npm run test:distribution -- --mode release` passed the mode assertion and reached `npm pack`, where the sandbox denied child execution. | `1` observation | test files: `1 failed`; tests: `1 failed` |
| Lint | `npm run lint:check` completed without diagnostics. | `0` | not applicable |
| Type checks | `npm run check` completed the root, core, and server TypeScript projects. | `0` | not applicable |
| Core tests | `npx vitest run --config vite.config.ts --project src:core` passed. | `0` | test files: `1 passed`; tests: `3 passed` |

Supplementary readings also passed: `npm run format:check` exited `0`, and `git diff --check` exited `0`.

## Observations

These readings require a host that permits child execution and nested installation:

| Host command | Exit | Reading |
| --- | ---: | --- |
| `npx vitest run --config vite.config.ts --project src:server` | `1` | Test files: `2 failed`, `2 passed`; tests: `22 failed`, `89 passed`, `7 skipped`. The failures follow denied child execution, including `spawnSync /opt/node22/bin/node EPERM`, empty child output, and waits that timed out because no child started. |
| `npx vitest run --config vite.config.ts --project guides` | `1` | Test files: `1 failed`; tests: `9 failed`, `89 passed`, `1 skipped`. The remaining failures follow denied child execution, including `spawnSync /opt/node22/bin/node EPERM`, empty child output, and a wait that timed out because no child started. The `RetentionInterface` example row passes in this reading. |
| `npx vitest run --config vite.config.ts --project distribution tests/distribution.test.ts --mode release` | `1` | Test files: `1 failed`; tests: `1 failed`. The release assertion passed, then `npm pack` failed with `spawnSync npm EPERM`. |
| `npm run test:distribution -- --mode release` | `1` | Test files: `1 failed`; tests: `1 failed`. Argument forwarding set release mode, the first assertion passed, then `npm pack` failed with `spawnSync npm EPERM`. |

## Unclosed host readings

No in-scope implementation remains. The host must rerun the `src:server`, `guides`, and release distribution commands from Observations because this sandbox cannot produce their child-process or nested-install evidence.