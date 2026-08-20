# PFIX-B report

All in-scope findings are closed. No `src/` file changed.

## Files touched

- `guides/process.md` splits host-independent root contracts from Node-side server contracts. It also states that the synchronous `protocol` refusal precedes the `destroy` barrier and that the barrier does not cover the residual child teardown.
- `tests/guides.test.ts` gives each package face an independent literal refusal list, pins the refusal/barrier order, and observes abort-listener membership before teardown, after teardown, and after abort.
- `tests/src/server/helpers.test.ts` moves the `validateWorkspace` refusal test under a `validateWorkspace` describe block and names the workspace behavior it proves.

## G1 reproduction

The runtime probe ran before the guide changed. This was the exact passing probe after its reversed-expectation control had failed:

```ts
import { describe, expect, it } from 'vitest'
import { isProcessError } from '@src/core'
import { createProcessManager } from '@src/server'

describe('ProcessManager destroy-refusal ordering probe', () => {
	it('records the protocol refusal and destroy barrier order', async () => {
		const manager = createProcessManager()
		const order: string[] = []
		let ending: Promise<void> | undefined
		let thrown: unknown

		try {
			manager.launch('racer', {
				command: { file: process.execPath, arguments: ['-e', ''] },
				workspace: process.cwd(),
				get grace() {
					ending = manager.destroy()
					void ending.then(() => order.push('barrier'))
					return 20
				},
			})
		} catch (error) {
			thrown = error
			order.push('refusal')
		}
		if (ending === undefined) throw new Error('The getter did not start destruction')
		await ending

		console.log(JSON.stringify(order))
		expect(isProcessError(thrown) ? thrown.code : undefined).toBe('protocol')
		expect(order).toEqual(['refusal', 'barrier'])
	})
})
```

Command:

```text
npm run test:probe -- tmp/probe/pfixb-order.test.ts
```

Exact output:

```text
> @orkestrel/process@0.0.4 test:probe
> vitest run --config vite.config.ts --no-cache --reporter=verbose --project probe tmp/probe/pfixb-order.test.ts


 RUN  v4.1.11 /workspace/process

stdout | tmp/probe/pfixb-order.test.ts > ProcessManager destroy-refusal ordering probe > records the protocol refusal and destroy barrier order
["refusal","barrier"]

 ✓ |probe| tmp/probe/pfixb-order.test.ts > ProcessManager destroy-refusal ordering probe > records the protocol refusal and destroy barrier order 11ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  14:32:25
   Duration  551ms (transform 313ms, setup 52ms, import 321ms, tests 13ms, environment 0ms)
```

The negative control changed only the final expectation to `['barrier', 'refusal']`. It exited `1`, printed `["refusal","barrier"]`, and reported `1` failed test in `1` failed file. The probe files were deleted, and the empty `tmp/probe/` directory was removed with `rmdir`.

The permanent guide test reads the documented sentence and drives the same getter interleaving. Its observable order is `['refusal', 'barrier']`.

## G2 ruling

The guide now splits contracts by published face. The root `@orkestrel/process` face carries the host-independent contracts, errors, constants, and types. The `@orkestrel/process/server` face carries the Node implementations and Node-side contracts.

This split is more precise than a broad exception. `ProcessChild` is exported only from the server face, and its `kill` method accepts `NodeJS.Signals`, so the contract names a Node global in its public signature.

## Test repairs and falsification readings

### T1 — neighbouring-face refusal

`REFUSALS` is a literal face-to-foreign-name contract. The live assertion still reads `source.surface()`, but its expected foreign names no longer come from that parser result or from the asserted face's own parsed names.

The planted leak was this temporary reassignment in `tests/guides.test.ts`:

```ts
files['src/core/index.ts'] = `${requireValue(
	files['src/core/index.ts'],
	'Missing file: src/core/index.ts',
)}\nexport * from '../server/index.js'\n`
```

That virtual export made the core face publish every server-face name. The targeted row exited `1` and reported the complete leaked server list. I removed the reassignment block exactly. The real `src/core/index.ts` file was never edited. The same targeted command then exited `0`.

### T2 — abort-listener release

The repaired row uses Node's real `getEventListeners` function. It observes the child-installed abort listener after construction, calls `child.destroy()`, observes no abort listener, aborts the controller, and observes no abort listener again. The `waitForExit` listener-release proof remains in the same row.

For the red reading, the unrepaired test source omitted `await child.destroy()` before the absence assertion while retaining `finally { await child.destroy() }` for cleanup. The row exited `1` because the bound `#terminate` listener remained. Restoring the teardown call before the assertion made the row exit `0`.

### T3 — validator ownership

The test that calls only `validateWorkspace('')` now sits under `describe('validateWorkspace')` and is named `codes a refused workspace as invalid and carries the rejected value`.

## Acceptance criteria

| Criterion | Exact command | Exit | Counts or reading |
| --- | --- | ---: | --- |
| G1 ordering probe, reversed control | `npm run test:probe -- tmp/probe/pfixb-order.test.ts` | 1 | Test files: 1 failed. Tests: 1 failed. Output: `["refusal","barrier"]`. |
| G1 ordering probe, actual order | `npm run test:probe -- tmp/probe/pfixb-order.test.ts` | 0 | Test files: 1 passed. Tests: 1 passed. Output: `["refusal","barrier"]`. |
| G1 permanent row, before guide repair | `npx vitest run --config vite.config.ts --project guides -t "states and proves the protocol refusal precedes the destroy barrier"` | 1 | Test files: 1 failed. Tests: 1 failed, 90 skipped, 91 collected. |
| G1 permanent row, after guide repair | `npx vitest run --config vite.config.ts --project guides -t "states and proves the protocol refusal precedes the destroy barrier"` | 0 | Test files: 1 passed. Tests: 1 passed, 90 skipped, 91 collected. |
| T1 with planted server-face leak | `npx vitest run --config vite.config.ts --project guides -t "publishes none of a neighbouring face's names on @orkestrel/process$"` | 1 | Test files: 1 failed. Tests: 1 failed, 90 skipped, 91 collected. |
| T1 after exact plant removal | `npx vitest run --config vite.config.ts --project guides -t "publishes none of a neighbouring face's names on @orkestrel/process$"` | 0 | Test files: 1 passed. Tests: 1 passed, 90 skipped, 91 collected. |
| T2 against unrepaired test source | `npx vitest run --config vite.config.ts --project guides -t "releases the abort listener destroy registered and the exit listener waitForExit registered"` | 1 | Test files: 1 failed. Tests: 1 failed, 90 skipped, 91 collected. The listener count was 1 instead of 0. |
| T2 after row repair | `npx vitest run --config vite.config.ts --project guides -t "releases the abort listener destroy registered and the exit listener waitForExit registered"` | 0 | Test files: 1 passed. Tests: 1 passed, 90 skipped, 91 collected. |
| Host-independence wording | `rg -n 'host-independent' guides/process.md` | 0 | Matches: 2. Both scope host independence to the root face or exclude server contracts from it. |
| Lint | `npm run lint:check` | 0 | Diagnostics: 0. |
| Typecheck | `npm run check` | 0 | Diagnostics: 0 across the root, core, and server checks. |
| Core project | `npx vitest run --config vite.config.ts --project src:core` | 0 | Test files: 1 passed. Tests: 3 passed. |

The moved T3 row also passed with this reading:

```text
npx vitest run --config vite.config.ts --project src:server -t "codes a refused workspace as invalid and carries the rejected value"
```

Exit `0`. Test files: `1` passed and `2` skipped, with `3` collected. Tests: `1` passed and `117` skipped, with `118` collected.

## Observations

The sandbox denied child execution in the full source reading. Run this exact command on the host:

```text
npm run test:src
```

Sandbox reading: exit `1`. Test files: `2` failed and `2` passed, with `4` collected. Tests: `22` failed, `92` passed, and `7` skipped, with `121` collected. The explicit denial was `spawnSync /opt/node22/bin/node EPERM`; asynchronous child rows consequently reported empty output or timed out. This reading is an observation, not an acceptance criterion.

The sandbox denied child execution in the full guide reading. Run this exact command on the host:

```text
npm run test:guides
```

Sandbox reading: exit `1`. Test files: `1` failed. Tests: `9` failed, `81` passed, and `1` skipped, with `91` collected. The explicit denial was `spawnSync /opt/node22/bin/node EPERM`; asynchronous child rows consequently reported empty output or timed out. The repaired G1, T1, and T2 rows passed together in a targeted guide reading before this observation.

No in-scope criterion remains open. The host-only source and guide readings remain for the Orchestrator because the sandbox cannot execute their child-process rows.