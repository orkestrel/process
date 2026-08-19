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

## Correction: the package is not losing data, and my reading above was wrong

Four blind diagnosis lanes ran one per failure cluster. Their evidence overturns two claims recorded
earlier in this file. Both corrections are recorded here rather than edited away, because the wrong
reading was committed and pushed.

### Rows 1 and 2 are a fixture defect, not a losslessness failure

This file said those rows "contradict the losslessness the handoff states and claims was proven".
**That is wrong.** The handoff's contract item 3 stands unmodified on POSIX.

The `chatty` fixture writes 4096 lines of 133 bytes and then calls `process.exit(0)`, which discards
the child's own userspace write queue. The loss reproduces with **no package code involved** — plain
`spawn`, plain byte counter, read to `close`:

```text
run=0 exit code=0 signal=null closeCode=0 bytes=36997  newlines=279
run=1 exit code=0 signal=null closeCode=0 bytes=359618 newlines=2692
run=2 exit code=0 signal=null closeCode=0 bytes=22899  newlines=173
```

The child measured its own state immediately before exiting:

```text
stdoutLines=317 childReport=type=pipe backpressured=3287 queued=505703 corked=0
```

3287 of 4096 writes returned `false` and 505,703 bytes were still queued when the process exited.

A control child with the identical payload that omits `process.exit` delivers all 4096 lines, five
runs out of five. Driving `createProcess` against that control passes every shape including the
handoff's `backlog: 1` claim.

**Why it passed on Windows.** Node makes a child's stdout pipe blocking on Windows only. The
synchronous write loop therefore self-throttles against the parent's reads, `writableLength` is 0 when
`process.exit(0)` runs, and every line lands. On POSIX the handle stays non-blocking, the loop never
yields, and teardown discards the queue.

My "3251 versus 621" framing was also wrong. Across five iterations the counts are nondeterministic
(173, 172, 1557, 172, 359) and the two tests are indistinguishable. The asymmetry is scheduling
variance, not a pause-and-resume effect.

### Row 7's divergence is libuv's, not this package's

I wrote that the fence fails because `isolated` removes `PATH` and the package's resolver declines to
help. The first half holds. The second is wrong in a way that changes the repair: `resolveExecutable`
returns `undefined` under isolation on **both** platforms, because with no `PATH` the Windows branch
searches the workspace alone. The Windows pass was libuv's environment injection and never this
package's resolution.

That removes any basis for touching `resolveExecutable`, which I had left open as an option.

## The corrected picture

**Zero product defects.** Six of the seven failures are defects in the tests and their fixtures; one
is a defect in published guidance. The runtime behaviour of 0.0.3 on POSIX is, so far, correct.

| # | Failure | Class | Owner |
| - | ------- | ----- | ----- |
| 1, 2 | line loss | TEST | `tests/src/server/fixtures/child.mjs` — drop `process.exit(0)` from `chatty` and `empty` |
| 3 | no SIGKILL escalation | TEST | the fixture signals before its trap is installed; announce `trapped` and wait for it |
| 4 | grandchild reads as live | TEST | `process.kill(pid, 0)` succeeds against a zombie until PID 1 reaps it, measured at 1250 ms |
| 5 | manager race | TEST | the child is killed before Node finishes booting it |
| 6 | `stopChild` counts no signal | TEST | the stub watches `kill`, which POSIX never calls |
| 7 | `isolated` fence | CONTRACT | `guides/process.md` and its transcription: use `process.execPath`, and state that `isolated` removes `PATH` |

## What is still owed

Every one of these seven rulings rests on **one lane**. The four lanes partitioned the failures
disjointly, so no finding received an adversarial cross-check. The synthesizer independently applied
and re-ran the repairs for rows 1 through 6, which is a second execution but not a second opinion.

One weakness is already named: the proposed POSIX branch for row 5 proves only a negative, so a change
that stopped spawning the child at all would also pass it. Accept that knowingly or design a stronger
instrument as its own unit.
