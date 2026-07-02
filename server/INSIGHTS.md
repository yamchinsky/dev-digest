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

### Provider keys may live in `server/.env`, not the documented `~/.devdigest/secrets.json`
_2026-07-02_ · `server/src/adapters/secrets/local.ts:37-42`, `server/src/platform/config.ts:74`

Docs (README/AGENTS) say secrets live in `~/.devdigest/secrets.json` (0600) — but that file only exists after a key is saved via the Settings UI. `LocalSecretsProvider.get()` falls back to `process.env`, so on a setup where keys were provided via `server/.env` the JSON file never gets created, yet `/settings/secrets-status` reports every provider `true`. A script that reads `~/.devdigest/secrets.json` directly (e.g. to reuse the OpenRouter key for an ad-hoc API call) fails with ENOENT — read the key from `server/.env` as the fallback source, mirroring the provider's own order (file first, then env; `GITHUB_TOKEN` additionally falls back to `GITHUB_PAT`).

### The missing-context-doc "warn" is logged as `kind: "info"` with a literal `[warn]` prefix in the message
_2026-07-02_ · `server/src/modules/reviews/run-executor.ts:297`

SPEC-01 AC-16 says a missing attached doc "SHALL log a `warn` entry", but the run-log entry is emitted via `runLog.info(`[warn] Context doc missing: …`)` — the structured `kind` field stays `"info"`; the warn-ness lives only in the message text. Any test or log filter that matches `kind === "warn"` finds nothing (bit me during live AC-16 verification — filter by msg substring instead). If a real `runLog.warn` level ever lands, migrate this call; until then, assert on the message prefix, not the kind.

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

### Replace-style writes need `db.transaction()` — `setSkills` predates this and is silently non-atomic
_2026-07-02_ · `server/src/modules/agents/repository.ts` (`replaceContextDocs` vs `setSkills`)

The delete-then-bulk-insert "replace" pattern must run inside one `db.transaction()` — `replaceContextDocs` (context docs) does this and is the first `db.transaction()` use in any repository. The older `setSkills` does two bare awaits (DELETE, then INSERT): a crash between them leaves the agent with zero skills. When touching `setSkills` next, wrap it in a transaction; when adding any new replace-style method, copy `replaceContextDocs`, not `setSkills`.

## Tool & Library Notes

### Drizzle `text('col', { enum: [...] })` is TypeScript-only — no SQL CHECK constraint is generated
_2026-07-02_ · `server/src/db/schema/context.ts` (`onboarding_tours.index_status_at_generation`), repo-wide pattern

The `enum` option on Drizzle's `text()` column produces a discriminated-union TYPE for queries/inserts, but the emitted SQL is plain `text NOT NULL` — Postgres will happily store any string. Every `text(..., { enum: [...] })` column in this schema behaves the same. Don't rely on the DB to reject invalid enum values (e.g. in an `.it.test.ts` asserting a constraint violation — there is none); enforcement happens only at the Zod contract / service layer. If DB-level enforcement is ever needed, that's `pgEnum` or an explicit CHECK, a schema change + migration.

### `fs.promises.glob` returns an AsyncIterator, warns "experimental", and does not follow symlinks
_2026-07-02_ · `server/src/modules/workspace/discovery.ts`

Node's native glob (22+, still experimental in 23.x) is NOT `Promise<string[]>` — iterate with `for await…of`. It emits an `ExperimentalWarning` at runtime (harmless, appears in test output). Brace expansion `{a,b,c}` works; paths come back with forward slashes. Crucially it does **not** follow symlinks by default — for scanning untrusted repo clones this is the correct security default and is deliberately paired with a post-glob `path.resolve`-containment guard (two independent barriers). Do not "fix" either barrier or add `followSymlinks: true`.

### Drizzle `inArray([])` generates invalid SQL — guard the empty array
_2026-07-02_ · `server/src/modules/repos/repository.ts` (`getClonePathsByIds`)

`inArray(col, [])` emits `WHERE id IN ()`, which PostgreSQL rejects at runtime (typecheck won't catch it). Every batch-lookup repository method must early-return on an empty id list: `if (ids.length === 0) return [];`. Easy to drop when copying the batch pattern to a new method.

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
