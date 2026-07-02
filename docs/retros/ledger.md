# Workflow retro ledger

One row per analyzed run — the trend of the SDD pipeline over time.

| Date | Run (plan/feature) | Agents | In / Out / CacheRead (tokens) | Cache-hit | Tool-calls | Duration | Max ∥ | Top recommendation |
|---|---|---|---|---|---|---|---|---|
| 2026-07-02 | SDD fleet refactor session (registry → /impl → retro tooling); retro-skill validation run | 5 (incl. 1 nested) | 258k / 765k / 76.0M | 96.8% | 268 | 77m | 2 | Plan-critique subagent re-Read 10 files the main session had already digested — pre-feed file digests (or path+summary pairs) in critique prompts instead of having the critic re-read |
| 2026-07-02 | SPEC-01 Project Context — full SDD pipeline (spec → plan → 10 impl tasks in 4 waves → coverage gate → arch loop ×3 → pr-self-review → PR #20) | 28 (incl. nested; whole session) | 516k / 1.41M / 231M | 96.0% | 1131 | ~3.4h wall (main) | 5 | pr-self-review bucket reviewers have the run's lowest cache-hit (60–77%) because each one loads full SKILL.md bodies itself — inline condensed severity/rule digests into bucket prompts instead; also: planner (812s, 50k out) and spec-creator (888s, 39k out) dominate single-agent latency — acceptable for a 20-AC feature, watch on smaller ones |
