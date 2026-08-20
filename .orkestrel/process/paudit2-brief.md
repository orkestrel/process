# PROCESS-AUDIT2: audit the fixes Sol wrote, on the engine that did not write them

## Role and engine

Role `reviewer`. Engine Claude Opus 5, high effort. Read-only. You rule; you never edit.

## Why you exist

Every fix in the subject range was written by GPT-5.6 Sol, which also wrote the audit that found the
defects. `AGENTS.md` and `.agents/orchestration.md` require a lane whose engine did not write the
work. Grok is never a lane in this harness and Sol cannot audit itself, so you are the only auditor
available.

The gates are green and are **not** the subject. A green suite proves the code does what the tests
say, not that the tests say the right thing. An equivalent audit on a sibling package found a
`prepublishOnly` step that could never have run on a clean checkout, while every gate reported green
— because the gate depended on a directory campaign work had incidentally created.

## Objective

`@orkestrel/process` 0.0.4 is the first layer of a publish wave; `@orkestrel/mcp` and
`@orkestrel/scaffold` both depend on it. Rule on the claims below with evidence. A claim you cannot
substantiate is a FAIL, not a courtesy PASS.

## Read first

1. `AGENTS.md` — § Design laws and § Writing
2. `.claude/rules/quality.md` — the Falsification law, and its Instruments section
3. `.claude/rules/tests.md`, `.claude/rules/documentation.md`, `.claude/rules/writing.md`
4. `.agents/skills/orkestrel-falsify/SKILL.md` — it fixes the verdict shape and the terminal line
5. `guides/process.md`

## Context

- Subject: `git diff c4b1e70..HEAD -- src/ tests/ guides/ package.json`. Run it yourself.
- The tree is committed and clean at `891f875`. Untracked `tmp/` files are expected.
- Host gates all exit 0: format:check, lint:check, check, build, test (src 4 files / 114 passed and
  7 skipped, policy 86, config 28, guides 90 passed and 1 skipped, conformance 5), test:distribution
  1. Do not re-run the suite; another agent may be using this host.
- Vendored files are off-limits as subjects: `AGENTS.md`, `CLAUDE.md`, `.agents/`, `.claude/`,
  `.codex/`, `.cursor/`, `configs/helpers.ts`, `scripts/*.sh`, `tests/config.test.ts`,
  `tests/policy.test.ts`, `tests/setupPolicy.ts`. Report a defect in one as a scaffold finding.
- `guides/*.md` other than `guides/process.md` and `guides/README.md` are refetched mirrors, out of
  scope.

## The claims

**Claim 1.** `CaptureCounts` earns its shape. It replaced a `number[]` whose entries meant delivered
and retained bytes. Rule on whether the named record is the right contract for a caller-owned
accumulator mutated once per delivered chunk, whether its mutable properties are justified and
documented as the deliberate exception they are, and whether any consumer now has a worse time than
before.

**Claim 2.** The guide's newly transcribed fences — `detach`, `stopChild`, and the manual
termination helpers — are transcribed **faithfully**. Rule on whether each executed transcription
drives what the fence shows a reader, or whether it drives something adjacent and easier. A
transcription that diverges from its fence is worse than an untranscribed fence, because the gate
now claims coverage it does not have.

**Claim 3.** The repaired assertions can each fail for the reason they exist. The
neighbouring-face row's expectation was made an independent literal list; rule on whether that list
can now drift silently from the real surface, trading one blindness for another. The abort-listener
row now uses `getEventListeners`; rule on whether it observes the listener the code actually
installs. Name any assertion in the range that still cannot fail.

**Claim 4.** The `destroy`-versus-refusal ordering the guide now states is what the code does, and
the permanent row that pins it would fail if the order reversed. The unit proved the order with a
probe and a reversed-expectation control; verify the **permanent** row carries that strength, not
just the deleted probe.

**Claim 5.** The manifest's new description and keywords are accurate and useful. Rule on whether the
description matches what the package does and whether a developer searching npm would find it by
those terms. This ships to the registry and cannot be quietly corrected later.

**Claim 6.** No gate in this package depends on incidental state — a directory that exists only
because work happened here, an environment variable, a file another test leaves behind, or an
ordering between projects. Name the exact command that would prove each suspicion, and say which you
could not run.

**Claim 7.** Every prose line the range added obeys `AGENTS.md` § Writing and
`.claude/rules/writing.md`: no count of a growable set, no list item named by position, no clause
written to persuade. Quote every line that fails and name the rule.

**Claim 8.** Nothing in the range weakened a test's ability to fail, and the guide's split of
contracts by published face is complete — no contract left on the wrong side, and no host-independent
claim still false.

## Unknowns

- Whether the transcribed termination fences can execute their Windows branch here. They cannot, and
  the guide records that limit; rule on whether the limit is stated where a reader meets the fence.
- Whether `CaptureCounts` is reachable by an external consumer at all, or is effectively internal.

## Scope

Read-only. Own nothing. Edit nothing. Spawn nothing. Perform this assignment directly. Never run
`git checkout`, `git restore`, `git stash`, `git reset`, or `git clean`.

State no count in anything you write, and never name a list item by its position.

## Output

The verdict shape `.agents/skills/orkestrel-falsify/SKILL.md` fixes, and nothing else. Per-claim
verdicts with evidence, findings numbered in one sequence, and the single terminal line. No process
diary.
