# PID design round: the supervision surface of `Process`

## Role and engine

One brief, read by blind design lanes; your dispatch names which lens you hold.

- **Subjective lens** — Claude Opus 5 `planner`, read-only. Shape, naming, ergonomics, what the
  surface must feel like.
- **Objective lens** — GPT-5.6 Sol `analyst`, read-only sandbox. What the contracts and the
  implementation actually permit, and what each candidate member costs in invariants.

Neither lane sees the other's answer. Each returns a proposal, never a decision.

## The settled part

The owner ruled on 2026-08-20: `pid` becomes available on `Process` / `ProcessInterface`
(src/core/types.ts:157, implemented in src/server/Process.ts). That decision is fixed; do not argue
against it. Your work is its exact shape and its company.

## The open questions

1. **The shape of `pid`.** The child's `pid` is `number | undefined` at the host (a failed spawn
   produces none). `Process` spawns eagerly or lazily — read the implementation and say when a
   consumer can observe the pid, what the member reads before spawn and after exit, and whether
   `undefined` alone carries every absent case per the absence law. Propose the exact member
   declaration with its TSDoc and the guide sentence that offers it.
2. **What else, if anything, the supervision surface misses.** The owner asks whether anything
   else consumers usually need to track or act on a process is missing. The current
   `ProcessInterface` members are `emitter`, `lines`, `evidence`, `truncated`, `exit`, `send`,
   `stop`, `destroy`. Rule on each candidate you consider — liveness, exit code access before
   `exit` settles, raw signal delivery, anything the comparison with the host `ChildProcess` and
   with common supervision APIs surfaces — as **add now** (name the real consumer case that needs
   it), **derivable** (name the derivation), or **refuse** (name the law it breaks, such as the
   minimal-public-API creation gate or derive-state). Do not propose a member without a concrete
   consumer case.

## Context

- Read first: AGENTS.md, .claude/rules/names.md, .claude/rules/typescript.md,
  .claude/rules/patterns.md, .claude/rules/architecture.md, the guides/process.md guide (the
  `Process` and `detach` sections), src/core/types.ts, src/server/types.ts (the `ProcessChild`
  contract), and src/server/Process.ts.
- The tree is committed and clean at 7010200. The `detach` contract stays fire-and-forget: its
  returning nothing was re-affirmed in the guide at this commit; the owner's instruction names
  `Process`, not `detach`.
- The single-word law binds every proposed member; a compound member is a shape error.

## Execution

Perform this assignment directly. Spawn nothing. Edit nothing. Never run a git state-mutating
command. State no count in prose you write.

## Output

A proposal: the exact `pid` member declaration with TSDoc, the guide sentence, the ruling table
over every candidate you considered with its add/derivable/refuse verdict and reason, and the
risks you see. No process diary.
