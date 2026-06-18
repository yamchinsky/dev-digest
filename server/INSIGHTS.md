# INSIGHTS — `server/`

Durable, surprising lessons that bite this module — things that *looked
obvious and weren't*. Append-only. New entries are added by the
`engineering-insights` skill. Read this file before solving a non-obvious
bug or making a "looks obvious" decision in `server/`.

## What Works
_None yet._

## What Doesn't Work
_None yet._

## Codebase Patterns

### Compute run cost on read; never persist it
_2026-06-18_ · `server/src/modules/reviews/service.ts:70-89`, `server/src/modules/reviews/run-executor.ts:264-273`, `server/src/modules/pulls/routes.ts:131-152`

`reviewer-core` already produces `outcome.costUsd`, but we deliberately drop
it. Trace `stats.cost_usd` is persisted as `null`; the actual value is
re-derived at every GET via `container.priceBook.estimate(model, tokensIn,
tokensOut)` — in `ReviewService.listRuns`, in `getRunTrace`, and as a sum
per-PR in `pulls/routes.ts`. Why: a `PriceBook` refresh (live OpenRouter
prices, 6h TTL) propagates to all historical runs without rewriting any
jsonb. If you add a third surface that shows cost, plug PriceBook in there
too — do not denormalize a frozen value into the row.

## Tool & Library Notes
_None yet._

## Recurring Errors & Fixes

### Treat `agent_runs.status` and `pr_id` as nullable in TS even though they're runtime invariants
_2026-06-18_ · `server/src/db/schema/runs.ts:14,21`

Neither column is `.notNull()`, so Drizzle infers both as `string | null` on
every `select`. Runtime invariant is the opposite — `status ∈
{running,done,failed,cancelled}` and `pr_id` is always set by
`createAgentRun` — but tsc forces any new helper that selects either column
to widen its return type and add a guard. Concrete bite this session: the
PR-list cost aggregation in `pulls/routes.ts` needs `if (!row.prId)
continue;` even though it never fires. Either ship a `.notNull()` migration
with backfill, or accept the widened type — do not `row.prId!` past tsc.

### Adding a required field to a shared Zod contract rots inline test fixtures in both packages
_2026-06-18_ · see repo-root `INSIGHTS.md` → Recurring Errors & Fixes

## Session Notes
_None yet._

## Open Questions
_None yet._
