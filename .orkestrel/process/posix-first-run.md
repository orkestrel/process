# The first POSIX run of 0.0.3, and what it found

`HANDOFF.md` names this the first task on any POSIX host: four tests are POSIX-gated and had never
executed anywhere. This session ran the suite on Linux. **Seven tests fail.**

Two of the failures are POSIX-gated tests running for the first time in the package's life.

## Host

```text
$ node --version && uname -s && which node
v22.22.2
Linux
/opt/node22/bin/node
```

## Gate results, each read by direct exit rather than through a pipe

```text
format:check   exit 0 PASS
lint:check     exit 0 PASS
check          exit 0 PASS
build          exit 0 PASS
test:src       exit 1 FAIL   3 files failed, 6 tests failed, 84 passed, 9 skipped (98)
test:policy    exit 0 PASS   86 passed
test:config    exit 0 PASS   28 passed
test:guides    exit 1 FAIL   1 failed, 50 passed (51)
```

A pipeline masks the code — `npm run test:src | tail` reported `EXIT=0` while the gate had exited 1.
The handoff warns about this for Windows; it is equally true here. Every reading above is bare.

## The seven failures

| # | Test | Assertion |
| - | ---- | --------- |
| 1 | `Process > drains output with no line consumer and still resolves exit` | expected 4096 lines, got **3251** |
| 2 | `Process > loses no line for a consumer holding a chatty child at the backlog mark` | expected 4096, got **621** |
| 3 | `Process > escalates to SIGKILL when the child traps SIGTERM and stays alive` | expected `'SIGTERM'` to be `'SIGKILL'` |
| 4 | `Process > kills a grandchild through the process group while the root is still live` | expected `true` to be `false` |
| 5 | `ProcessManager > refuses a launch whose own options destroyed the registry mid-construction` | expected `0` to be greater than `0` |
| 6 | `helpers > stopChild > signals a live child and reports an unconfirmed termination` | expected `0` to be greater than `0` |
| 7 | `guides > reads the isolated environment fence back from the child` | `spawnSync node ENOENT` |

Rows 3 and 4 are two of the four the handoff flagged. Rows 1 and 2 contradict the losslessness the
handoff's contract item 3 states and claims was proven.

## Row 7 is diagnosed, and it is a documented-surface defect

The fence at `tests/guides.test.ts:407-418`:

```ts
const keys = runSync({
    file: 'node',
    arguments: ['-e', printer],
    environment: { TOKEN: 'a' },
    isolated: true,
}).stdout.split(',')
```

`isolated: true` makes the child environment the overrides alone, so it holds `TOKEN` and no `PATH`.
On Windows libuv injects `PATH`, `SYSTEMROOT`, `TEMP` and others into any explicit environment, so a
bare `node` resolves. **On POSIX libuv injects nothing**, so the bare command cannot resolve and
`spawnSync` returns `ENOENT`.

The test's own comment at `:405-406` documents the Windows injection. The POSIX consequence was
invisible because the fence never ran on POSIX.

The package's own resolver declines to help, and that appears deliberate:

```text
$ node -e "const {resolveExecutable}=require('./dist/src/server/index.cjs');
  console.log(resolveExecutable('node', process.cwd(), process.env))"
undefined
```

`node` is on this host's `PATH` at `/opt/node22/bin/node`. The handoff describes the POSIX resolver as
a passthrough that leaves lookup to the host, and `helpers.test.ts:170` pins that as
"leaves the lookup to a host that performs it". So the resolver returning `undefined` is the design;
the defect is that `isolated` then removes the only thing that could perform the lookup.

This matters beyond one test: the fence is **published guidance**. A consumer copying it from the
guide gets a working call on Windows and `ENOENT` on Linux.

## What this does not yet say

Rows 1 through 6 have executed failures but no ruled mechanism. Each could be a product defect, a
test encoding a Windows assumption, or a contract that is wrong about platform behaviour, and those
take different repairs. Four blind diagnosis lanes are running one per cluster; their reconciliation
lands beside this file.

Nothing here reopens a handoff ruling. Where a diagnosis appears to, the lane is required to say so
and explain why POSIX changes it.
