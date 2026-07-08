# Spec: Eval Pipeline (L06 homework) | Status: implementing

> Full EARS pipeline spec: **`SPEC-04-2026-07-eval-pipeline.md`** (30 ACs, implemented).
> This file is the homework-facing spec and adds the **standalone Eval Dashboard
> page** required by the updated assignment (the sidebar page from the provided
> design). Written before the dashboard code, per L05 SDD discipline.

## Problem & why

Regression protection for DevDigest review agents, as a product feature: real
accept/dismiss decisions on findings become frozen eval cases in Postgres; a
batch executor replays them through a snapshotted agent config; scoring is pure
arithmetic (zero LLM calls) so runs across agent versions are comparable. The
shipped pipeline (SPEC-04) covers cases, batch runs, scoring, and the Evals tab.
This spec adds the **Eval Dashboard** — a dedicated sidebar page that surfaces
the latest eval runs per agent, matching the provided design.

## Acceptance criteria (homework)

Carried from SPEC-04 (already implemented — see that file for evidence):

- **AC-A** — Set holds ≥8 eval cases (seeded gold set). *(seed bumped 5 → 8)*
- **AC-B** — A case is created from a finding in one click; both expectation
  types work (accepted → `must_find`, dismissed → `must_not_flag`).
- **AC-C** — Changing the agent's system prompt visibly moves recall/precision
  between two batch runs; a deliberately broken prompt drops precision.
- **AC-D** — Scoring performs zero LLM calls (proven by
  `server/src/modules/eval/scoring.test.ts` — import-graph assertion).
- **AC-E** — `pnpm verify:l06` is green.

New in this spec — the Eval Dashboard page:

- **AC-F** — The left sidebar SHALL contain an "Eval Dashboard" entry (under
  SKILLS LAB) that routes to `/eval-dashboard`. (covers: the design's sidebar)

- **AC-G** — WHEN a user opens `/eval-dashboard`, the system SHALL render, for a
  selected agent: three metric cards (recall, precision, citation_accuracy) each
  with the current value and a signed delta vs the previous completed run; a
  multi-series metric-trend chart over completed runs; and a recent-runs table
  showing version, ran-at, the three metrics, pass count, and cost. (covers: the
  design)

- **AC-H** — The dashboard SHALL provide an agent selector so a user can switch
  which agent's eval history is shown; the page defaults to the first agent that
  has eval cases. (covers: "Eval Dashboard для агентів")

- **AC-I** — WHEN precision decreased between the two most recent completed runs,
  the dashboard SHALL show an alert banner naming the drop (e.g. "Precision
  dipped Npts on vX"); otherwise no banner. (covers: the design's alert)

- **AC-J** — The recent-runs table SHALL let a user select exactly two completed
  runs and open a side-by-side comparison (metric deltas + per-case pass/fail
  flips) — reusing the existing compare view. (covers: "порівняти два поруч")

- **AC-K** — WHEN the selected agent has no completed runs, the dashboard SHALL
  render an empty state (no chart, no metric values) rather than an error.

## Non-functional / notes

- **Client-side composition.** The dashboard derives its metrics, delta, trend,
  alert, and run list from the existing `GET /agents/:id/eval-runs` (batch
  history) via TanStack Query — no new server endpoint or migration. The given
  `EvalDashboard` Zod contract remains available for a future server-computed
  variant.
- **Component reuse.** The metric cards, trend chart, run-history table, and
  compare view already exist (built for the AgentEditor Evals tab); they are
  promoted to a shared location and consumed by both the tab and this page.
- **i18n.** The page uses the pre-provided `messages/en/eval.json` `dashboard.*`
  namespace and `page.crumbEvalDashboard`.
- **Label.** The FindingCard control is labelled "Turn into eval case" per the
  assignment wording.

## Addendum — Skill Editor Evals (benchmark)

Added after review feedback ("вкладка Evals у SkillEditor відсутня"). The design
(`dev-digest-mats/6/skill eval1.png`, artboard "Skill Editor · Evals") is a
`with_skill`-vs-`without_skill` **benchmark**, not the agent's case/run pipeline:
it answers "is this skill worth its tokens?". Real backend, not static.

- **AC-L** — The Skills Lab per-skill editor SHALL have an **Evals** tab
  (order: Config · Context · Preview · Evals · Stats · Versions).

- **AC-M** — WHEN a user opens the Evals tab with a completed benchmark, the
  system SHALL render a summary table (Pass rate, Duration, Tokens × with_skill /
  without_skill / signed Δ) and a per-case qualitative diff (aspect × with_skill /
  without_skill, each with a code-graded pass mark).

- **AC-N** — A "Run benchmark" control SHALL start a run
  (`POST /skills/:id/benchmarks`, 202, fire-and-forget); it is disabled while a
  run is in progress and the list self-polls until the run reaches a terminal
  state.

- **AC-O** — The benchmark SHALL run each skill benchmark case (an `eval_cases`
  row with `owner_kind='skill'`) twice — with the skill body injected and with
  the bare model — through the real LLM, and grade each aspect by **code only**
  (literal regex/substring over the output). NO judge, NO LLM call in scoring.

- **AC-P** — Benchmark runs SHALL persist in a new `skill_eval_runs` table
  (migration committed) and be served via `GET /skills/:id/benchmarks` and
  `GET /skill-benchmarks/:id`. A seeded `done` run exists for
  `branch-coverage-rubric` so the tab is populated with no API key.

Backend: `server/src/modules/skill-eval/` (routes/service/repository + pure
`scoring.ts`), contract `@devdigest/shared` → `contracts/skill-benchmark.ts`,
boot reaper wired in `app.ts`. Scoring proven code-only by
`skill-eval/scoring.test.ts`; UI by `SkillDetail/EvalsTab.test.tsx`. Both are
in the `verify:l06` gate.

## Out of scope (this cycle)

Export-to-CI and the peer-test (dropped from this assignment revision); a
server-computed `EvalDashboard` endpoint; a manual skill-benchmark case editor
(cases are seeded / created via the API, not a form yet).
