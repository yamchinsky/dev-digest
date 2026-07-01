# Workflow retro ledger

One row per analyzed run — the trend of the SDD pipeline over time.

| Date | Run (plan/feature) | Agents | In / Out / CacheRead (tokens) | Cache-hit | Tool-calls | Duration | Max ∥ | Top recommendation |
|---|---|---|---|---|---|---|---|---|
| 2026-07-02 | SDD fleet refactor session (registry → /impl → retro tooling); retro-skill validation run | 5 (incl. 1 nested) | 258k / 765k / 76.0M | 96.8% | 268 | 77m | 2 | Plan-critique subagent re-Read 10 files the main session had already digested — pre-feed file digests (or path+summary pairs) in critique prompts instead of having the critic re-read |
