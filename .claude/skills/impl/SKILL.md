---
name: impl
description: >
  Use to EXECUTE an Implementation Plan (`docs/plans/<feature>.md`) end-to-end
  in the main session: feature branch → implementer waves per the task DAG
  (or sequential steps in single-agent mode) → plan-verifier coverage gate
  (run inside a sonnet subagent) → capped gap-fix loop → architecture-reviewer
  with a capped fix loop (≤3, until APPROVE) → spec status flip →
  `gh pr create` (pr-self-review hook fires there). Trigger phrases: '/impl',
  'імплементуй план', 'implement the plan', 'run the plan', 'execute the
  plan', 'виконай план', 'запусти план'. NOT for writing plans
  (implementation-planner) or specs (spec-creator) — those are invoked
  manually, upstream of this skill.
allowed-tools: Read, Grep, Glob, Bash, Edit, Agent, Skill, AskUserQuestion
---

# impl

Execution orchestrator for DevDigest's SDD pipeline. Upstream steps are
manual by design — the user runs `spec-creator` and `implementation-planner`
themselves; this skill picks up from a finished plan:

```
spec-creator (manual) → SPEC-NN → implementation-planner (manual)
    → docs/plans/<feature>.md
    → /impl (THIS SKILL, main session):
        0. preflight: plan + spec + feature branch
        1. implementer waves per DAG (cap 3) | sequential steps
        2. plan-verifier agent — coverage gate, FIRST (sonnet)
        3. gap-fix loop (max 2 iterations)
        4. architecture-reviewer → arch-fix loop (≤3, until APPROVE)
        5. test intents + DEFERRED rows → manual checklist (test-writer is
           currently DISABLED for token economy)
        6. aggregate insight candidates → engineering-insights (once, serial)
        7. spec Status → implemented (+ specs/ README index line)
        8. gh pr create → PreToolUse hook runs pr-self-review
```

This skill runs in the **main session** deliberately: only the main session
has `AskUserQuestion` (failure decisions, gap acceptance, arch-loop cap) and
only it triggers the `gh pr create` hook predictably. Do not wrap this
pipeline in a subagent.

## When to use

- User asks to execute a plan: "/impl", "імплементуй план", "run the plan",
  "виконай план", or names a `docs/plans/<feature>.md` to run.
- An implementation-planner run just finished and the user confirms execution.

Do **not** fire:

- To write or amend a plan (that is `implementation-planner`, run manually).
- To verify coverage only (invoke `plan-verifier` directly).
- Mid-execution of another plan — one plan per run, finish or abort first.

## 0. Preflight

1. **Locate the plan.** If not named, infer from the branch name or the most
   recent file in `docs/plans/`; if still ambiguous, ask once.
2. **Read the plan fully.** Extract: `## Execution mode`, the Requirements
   table (R-IDs, `Covers AC` when present), the `Spec:` header (if the plan
   traces to a SPEC-NN, read that spec's ACs and verification hints too),
   tasks/steps with Owned paths + `Skills (mandatory)` + DAG edges,
   `## Test intents`, and `## Verification per task/step`.
3. **Branch gate.** `git branch --show-current`. On `main`, create a feature
   branch (`feat/<plan-slug>`) before anything else — implementers run in the
   launch branch, and the pr-self-review gate refuses to fire on `main`.
4. **Sanity-check the DAG** (multi-agent mode): owned paths disjoint across
   tasks, no dependency cycles, every `Skills (mandatory)` entry is a real
   skill under `.claude/skills/` (agents are not skills). A violation here is
   a **plan defect** — stop and send the user back to `implementation-planner`
   rather than improvising ownership.

## 1. Implementation

**Multi-agent mode** — topologically sort the task DAG into waves:

- A wave = all tasks whose `Depends-on` are already completed.
- Launch each wave's implementers **in parallel in a single message**, but cap
  at **3 concurrent instances**; a larger wave runs in batches of 3.
- Each implementer prompt must contain, verbatim from the plan: its task ID
  and text, **Owned paths**, **Skills (mandatory)** list, acceptance criteria,
  red flags, and the exact verify command for its package. Tell it which
  paths *other* tasks own (so "stop and report" beats improvisation).
- Between waves, skim each report: files changed within owned paths, verify
  command green, handoff notes (migrations needed, contracts mirrored),
  **Insight candidates** (collect for §5).

**Single-agent mode** — run one `implementer` per step S1..Sn sequentially,
same prompt contract; the verify/review tail below is identical.

### Failure protocol (a task fails or "stops and reports")

1. Do **not** launch its dependents.
2. Let the current wave drain (already-running tasks finish).
3. Present the failing report to the user and ask via `AskUserQuestion`:
   **retry** with an amended task prompt / **re-plan** (back to
   `implementation-planner` with the failure as input) / **abort** the run.
4. Never silently reassign the failed task's owned paths to another instance.

## 2. Coverage gate — plan-verifier FIRST

Immediately after the last wave, spawn the **`plan-verifier` agent**
(`.claude/agents/plan-verifier.md` — sonnet, self-contained methodology):
pass it the plan path and the pre-tests flag, and have it return the
coverage matrix as its final message. This keeps the grep-heavy verification
off the expensive model and out of the main context; if the matrix comes
back malformed, re-spawn the agent once with a corrected prompt before
falling back to verifying inline.

Run it **before** the architecture review: a coverage gap means a follow-up
implementer will change the diff, and anything reviewed before that gets
reviewed twice; arch review of an incomplete diff produces false findings.

- Test-evidence sub-criteria ("suite green", "test exists for X") come back
  `DEFERRED (test evidence pending)` — with test-writer disabled they stay
  deferred; route them to the manual checklist (§4). Do not treat DEFERRED
  as a gap.
- **Gap-fix loop, capped at 2 iterations:** for MISSING/PARTIAL rows, spawn
  follow-up implementer task(s) scoped to the gap (owned paths = the affected
  files), then re-run plan-verifier **on the gap rows only**. After 2
  iterations with remaining gaps, stop and ask the user: accept the gaps
  (descope) or re-plan. plan-verifier deliberately proposes no fixes — an
  unbounded loop thrashes.

## 3. Architecture review + fix loop

Launch the `architecture-reviewer` agent, scope: the branch diff vs `main`.

> **test-writer is currently DISABLED** (token economy). Do not spawn it.
> Existing suites stay green — every implementer runs them as its
> done-condition — and the plan's `## Test intents` land in the manual
> checklist (§4) instead of being authored. To re-enable: rename
> `.claude/agents/test-writer.md.disabled` back to `.md` and reinstate the
> parallel test-writer step here (feed it `## Test intents` + spec hints).

Then, on **REQUEST CHANGES**, run the **architecture-fix loop (≤3
iterations)**:

1. Spawn ONE follow-up implementer whose task is exactly the review's
   CRITICAL + WARNING findings — quote each finding (smell, `path:line`,
   fix direction) verbatim in its prompt. Its owned paths MUST include any
   test files whose imports break when files move, and its done-condition is
   the touched package's **existing** tests + typecheck re-run to green.
2. Re-invoke `architecture-reviewer` on the updated diff.
3. **APPROVE** → exit the loop. Still REQUEST CHANGES → next iteration with
   the *remaining* findings only. After 3 iterations without APPROVE, stop
   and ask the user (`AskUserQuestion`): accept the remaining findings
   (record them verbatim in the final report), keep fixing manually, or
   abort the run.

Loop discipline: never send the same findings to two parallel fixers; never
let a fix iteration touch paths outside the findings' files + their broken
test imports; count an iteration even when the reviewer surfaces *new*
findings caused by a fix.

## 4. Final re-check + manual checklist

- Re-run the plan-verifier agent (same pattern) on **previously-gapped
  rows only** after the gap-fix and arch-fix loops settle.
- Collect into a **manual checklist** in the final report:
  - all `DEFERRED` test-evidence rows + the plan's `## Test intents`
    (test-writer disabled — these are the user's to cover),
  - runtime acceptance criteria ("demo works", "response is fast"),
  - e2e-kind verification hints (`deferred — manual`; or run existing flows
    via `scripts/e2e.sh` when relevant).
  Never silently drop any of these.

## 5. Insights — aggregate, then write once

Implementers do **not** write INSIGHTS.md themselves (parallel instances in
one tree would collide on a file no task owns). They report **Insight
candidates**; this skill deduplicates them and invokes `engineering-insights`
**once, serially**, routing each entry to the correct `<module>/INSIGHTS.md`.

## 6. Terminal duties

1. **Spec status flip.** If the plan traces to a SPEC-NN and the verdict is
   ALL COVERED (modulo user-accepted descopes; DEFERRED rows don't block):
   `Edit` the spec header `Status: approved` → `Status: implemented` **and**
   update the trailing status in the same `specs/` folder's README index
   line (it says `(draft)` or `(approved)` — leaving it stale is the known
   failure mode).
2. **Open the PR.** `gh pr create` — the PreToolUse hook fires
   `pr-self-review` on its own; do not run it manually beforehand (double
   work) and do not bypass the gate.

## Output contract (final report, English)

- **Plan / spec**: paths, execution mode, branch.
- **Waves**: task → implementer result (files, verify command, green?).
- **Coverage**: plan-verifier verdict per run; gap-loop iterations used;
  accepted descopes.
- **Architecture**: verdict; fix-loop iterations used; fixes applied and
  re-green evidence; accepted residual findings (verbatim), if any.
- **Manual checklist**: deferred test intents, runtime ACs, e2e hints.
- **Insights**: entries appended (module + heading), or "none".
- **PR**: URL, or the pr-self-review BLOCK report if gated.

## Hard rules

1. **Never run on `main`** — branch first.
2. **Concurrency cap 3** implementers; parallel launches in a single message.
3. **plan-verifier before architecture-reviewer** — coverage first, always;
   run it via a sonnet subagent, not inline.
4. **Gap-fix loop caps at 2** iterations, then the user decides.
5. **Architecture-fix loop caps at 3** iterations — then the user decides
   (accept findings / continue manually / abort).
6. **A failed task never blocks silently** — failure protocol §1, user decides.
7. **No ownership improvisation**: plan defects (overlapping paths, cyclic
   DAG, agent names in `Skills (mandatory)`) go back to the planner.
8. **INSIGHTS.md is written once, by this skill** — never by parallel
   implementers.
9. **The pr-self-review hook is the gate** — don't pre-empt it, don't bypass
   it.
10. **Do not spawn test-writer while it is disabled** — deferred test work
    goes to the manual checklist, visibly.
11. One plan per invocation.

## Language

Progress narration, questions, and the final report to the user are in
**Ukrainian**; artifacts (PR body, plan annotations) in **English**.
