# INSIGHTS — `server/`

Durable, surprising lessons that bite this module — things that *looked
obvious and weren't*. Append-only. New entries are added by the
`engineering-insights` skill. Read this file before solving a non-obvious
bug or making a "looks obvious" decision in `server/`.

## What Works
_None yet._

## What Doesn't Work

### A non-OpenRouter model silently shows "—" cost unless its id is in pricing.ts
_2026-06-20_ · `server/src/platform/price-book.ts:34-39`, `server/src/adapters/llm/pricing.ts`, `server/src/db/seed.ts:11-13`

UI cost works out of the box only because the seeded default model is an
OpenRouter slug (`deepseek/deepseek-v4-flash`): `PriceBook` ingests live
prices for *all* OpenRouter models from `/models`, and the static fallback
table also has that slug. Switch an agent to an Anthropic/OpenAI model id
(via `PUT /agents/:id`) and OpenRouter's `/models` returns no price for it, so
`PriceBook` falls through to the static table — if that exact id is absent,
`estimate()` returns `null` and the row renders `—`, no error. Adding a
non-OpenRouter model means adding its id to `pricing.ts`, and the key must
match the string persisted in `agent_runs.model` exactly (whatever the
provider passes to `estimateCost`), or the fallback still misses.

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

### Declare new port interfaces in `@devdigest/shared`, not `adapters/<port>/types.ts`
_2026-06-20_ · `server/src/vendor/shared/adapters.ts`, `server/src/platform/container.ts:1-8`, `reviewer-core/src/review/run.ts:3`

Every `Container`-resolved port (`LLMProvider`, `Embedder`, `GitHubClient`,
`GitClient`, `CodeIndex`, `AuthProvider`, `SecretsProvider`) is declared in
`vendor/shared/adapters.ts` and imported as `import type … from
'@devdigest/shared'` — including in `reviewer-core/src/review/run.ts`,
which types `ReviewInput.llm: LLMProvider` against the same file. The
intuitive home — colocating the interface next to its implementation in
`server/src/adapters/<port>/types.ts` — breaks the engine, because
`reviewer-core` can't reach into `server/src/` (only `@devdigest/shared`
and `@devdigest/reviewer-core` are path-alias-rewritable across packages).
`AGENTS.md` calls out Zod contracts and `OpenRouterProvider` living across
the boundary but is silent on port-interface placement, so the natural
move when adding a new outbound integration is the wrong one. Declare new
port interfaces in shared from the start, even if `reviewer-core` doesn't
consume them yet.

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
