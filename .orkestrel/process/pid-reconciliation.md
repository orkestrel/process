# PID design round — reconciliation, 2026-08-20

Lanes: subjective (Opus planner), objective (Sol analyst), blind, one brief (tmp/pid-brief.md).

## The adopted shape

- `pid: number | undefined` — required member, getter over the held child, leading the
  `ProcessInterface` data block. Convergent across the lanes: eager spawn means the value is
  observable the moment construction returns; a failed spawn reports `undefined` forever; an
  assigned id survives exit and reports no liveness.
- `code: number | null` and `signal: string | null` — getters mirroring the host child's
  `exitCode` and `signalCode`. The objective lane's interval decides this against the subjective
  lane's `exited` boolean: the `exit` promise settles on stdio close, which a descendant holding
  inherited stdio keeps open past native exit, so a supervisor inside that interval can reach the
  root's exit state only through synchronous members. With `code` and `signal` present, `exited`
  is the derivation `code !== null || signal !== null` and the derive-state law refuses storing
  it; without them, `exited` cannot recover the code, so the boolean loses on both grounds.
  `null` mirrors the host child contract the way `ProcessExit` already does, so the absence law
  admits it.
- Liveness derives: `pid !== undefined && code === null && signal === null`. The guide documents
  the derivation beside the pid-reuse warning instead of the surface storing a flag.

## Convergent refusals and derivations, carried to the guide where named

Raw signal delivery stays off the surface (the guide documents `process.kill(pid, ...)` and the
negated id for the POSIX group, with the reuse warning); raw stdio streams, IPC members,
`ref`/`unref`, the host `killed` flag, restart, pause/resume, metrics, a disposal protocol, and a
stored command copy are refused or derived per the two lane tables, which ride in
`.orkestrel/process/` with this file.

## Probes the fix unit owns

- A spawn-fault child through `Process`: assert `pid` undefined and `code`/`signal` null while the
  `exit` promise still settles with the documented fault shape.
- The happy path: `pid` a number immediately after construction; `code`/`signal` null while live;
  set after exit.

## Routing

The pid unit goes to the Opus `implementer` (API shape, naming, and guide voice dominate; the
getters are trivial). Its auditor is Sol. The unit launches after the process fix-unit audit
returns, because a writer must not dirty the tree under a live read-only lane.
