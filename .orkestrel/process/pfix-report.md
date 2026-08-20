# PFIX report

## Files touched

- `src/server/types.ts` adds the public `CaptureCounts` accumulator with named `delivered` and `retained` properties.
- `src/server/helpers.ts` changes `retainChunk` and the asynchronous capture paths to use `CaptureCounts`, and updates the helper TSDoc and example to name each total.
- `tests/src/server/helpers.test.ts` proves that `retainChunk` mutates the named totals while retaining the same byte head.
- `tests/guides.test.ts` removes the stale export tally, updates the `retainChunk` example proof, and transcribes the runnable `detach`, `stopChild`, and manual termination-helper fences.
- `guides/process.md` documents `CaptureCounts` and gives the transcribed termination fences short runnable child commands.
- `package.json` replaces the placeholder description and empty keywords. No other manifest field changed.

## Public type

`CaptureCounts` carries mutable `delivered` and `retained` byte totals. Its properties are mutable because `retainChunk` updates the caller-owned accumulator in place without allocating for each delivered chunk.

## Finding 4 ruling

I took transcription. The fences can run in this container without a Windows host, while their Windows-only branch remains subject to the guide's existing `taskkill.exe` limitation. The guide suite imports and calls `detach`, `stopChild`, `killProcess`, and `killTree`; its host-neutral paths execute without a skipped test. A focused run of the added transcriptions exited 0 with 3 passed and 87 skipped by the name filter.

## Acceptance criteria

1. `npx vitest run --config vite.config.ts --project src:server tests/src/server/helpers.test.ts` — exit 1. The runner reported 1 failed file: 61 passed, 8 failed, and 6 skipped from 75 tests. The changed `retainChunk` test passed. The failures came from sandbox-denied child execution, including `spawnSync ... EPERM`; no workaround was used.
2. `npm run lint:check` — exit 0.
3. `npm run check` — exit 0.
4. `npx vitest run --config vite.config.ts --project guides` — exit 1. The runner reported 1 failed file: 80 passed, 9 failed, and 1 skipped from 90 tests. The added fence transcriptions passed. Existing child-execution rows failed with denied or empty child output, including `spawnSync ... EPERM`, and one related row timed out.
5. `rg -n -i '\bsixteen\b' tests/ src/ guides/process.md README.md` — exit 1, the expected no-match result. No hit.
6. `rg -n 'slot `?[01]`?|counts\[[01]\]' src/ tests/ guides/process.md` — exit 1, the expected no-match result. No hit.
7. `node -p "const p=require('./package.json'); p.description + ' | ' + p.keywords.join(',')"` — exit 0. It printed `A typed child-process toolkit with supervised streaming, bounded output capture and termination, detached spawns, and keyed child registries. | child-process,nodejs,process,process-manager,spawn,subprocess,typescript`.

## Could not close

The server-suite and guide-suite acceptance commands could not reach exit 0 in this sandbox because child execution was denied. The implementation-specific proofs, lint check, type checks, text searches, and manifest check closed.