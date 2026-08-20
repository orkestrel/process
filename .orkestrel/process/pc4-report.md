Implemented PC4 Q9–Q14 directly, with no agents spawned.

### Changes

- **Q9 — `%1` quoting:** Kept runtime behavior unchanged. `quoteArgument('%1')` correctly returns `"%1"`; Windows batch arguments containing `%` remain refused at the execution boundary. Corrected the false prose in [helpers.ts](/workspace/process/src/server/helpers.ts:756), [process.md](/workspace/process/guides/process.md:420), and added parity coverage in [guides.test.ts](/workspace/process/tests/guides.test.ts:420).
- **Q10 — isolated environments:** Documented that POSIX `isolated: true` removes `PATH`, while Windows/libuv supplies its required host environment. Updated [types.ts](/workspace/process/src/core/types.ts:32) and [process.md](/workspace/process/guides/process.md:460).
- **Q11 — spawn faults:** Documented the asynchronous negative host errno versus synchronous `null` distinction in [types.ts](/workspace/process/src/core/types.ts:47) and [process.md](/workspace/process/guides/process.md:547).
- **Q12 — abrupt supervisor death:** Documented that detached POSIX children survive supervisor `SIGKILL` and do not receive terminal `SIGINT`; orderly shutdown must use `stop` or `destroy`. See [types.ts](/workspace/process/src/core/types.ts:117) and [process.md](/workspace/process/guides/process.md:341).
- **Q13 — distribution proof:** Added [distribution.test.ts](/workspace/process/tests/distribution.test.ts:18), the exact `test:distribution` script and publish gate in [package.json](/workspace/process/package.json:66), and the scaffold-produced Vitest project in [vite.config.ts](/workspace/process/vite.config.ts:167).
- **Q14 — TypeScript floor:** Documented supported `moduleResolution` values in [README.md](/workspace/process/README.md:30). No `typesVersions` compatibility layer was added.

The distribution proof packs the package, installs it in an external temporary consumer, validates every export target, compares ESM and CommonJS runtime exports with compiler-parsed declaration exports, and invokes real core/server functions.

### Evidence

Measured value exports:

- Core: **13 runtime / 13 declarations**
- Server: **33 runtime / 33 declarations**

The brief’s expected server count of 29 was stale; the current declared and runtime surfaces independently agree at 33.

Negative control:

- Deliberately changed the absent-subpath assertion to expect success.
- Exit `1`: `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- Restored the assertion.
- Exit `0`: 1 passed.

Red/green guide proof:

- Before documentation changes: exit `1`, 3 failed.
- After changes: exit `0`, 4 passed.

Validation:

- `npm run format:check` — exit `0`
- `npm run lint:check` — exit `0`
- `npm run check` — exit `0`
- `npm run build` — exit `0`
- Targeted guide parity — exit `0`
- Targeted config publish-gate assertion — exit `0`
- `npm run test:policy` — exit `0`, 86 passed
- `git diff --check` — exit `0`

### Sandbox limitations

Commands that create nested child processes were attempted but cannot settle in this sandbox:

- `npm run test:distribution -- --mode release` — exit `1`, `spawnSync npm EPERM`
- `npm run test:config` — exit `1`, 27 passed and one child-process policy test blocked by `EPERM`
- `npm test` — exit `1`; source tests requiring child processes failed with `EPERM`, empty output, or resulting timeouts

Those exact commands are the settling commands on a host that permits child creation.

The requested scaffold `overwrite` command was also blocked by its internal Git child process. I ran scaffold `repair` against a physical temporary mirror, applied its exact generated config diff, and verified the repository config matched that generated result byte-for-byte.

Files changed:

- `README.md`
- `guides/process.md`
- `package.json`
- `src/core/types.ts`
- `src/server/helpers.ts`
- `tests/guides.test.ts`
- `tests/distribution.test.ts`
- `vite.config.ts`