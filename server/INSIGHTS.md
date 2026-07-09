# INSIGHTS — `server/`

Durable, surprising lessons that bite this module — things that *looked
obvious and weren't*. Append-only. New entries are added by the
`engineering-insights` skill. Read this file before solving a non-obvious
bug or making a "looks obvious" decision in `server/`.

## What Works
_None yet._

## What Doesn't Work

### pgvector queries return zero rows when column dimension doesn't match embeddings model output
_2026-07-05_ · `server/src/db/schema/` (pgvector columns), `server/src/adapters/embeddings/` (model resolution)

After switching embeddings models (e.g. OpenAI `text-embedding-3-small` → `text-embedding-3-large`), pgvector queries that worked with the old model start silently returning zero rows. The cause: the column was created with a specific vector dimension (1536 vs 3072) matching the old model's output, but changing the model changes the input vector dimension without migrating the table. PostgreSQL silently rejects the distance calculation when dimensions don't match — no error, no warning, just an empty result set. Next time: after switching `EMBEDDINGS_MODEL` or updating the embedder, check the existing column's dimension in `information_schema.columns` or run a test query; if it doesn't match the new model's output size, back-fill with embeddings from the new model or create a new column.

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

### `*.it.test.ts` silently skip — looking green — when a COLD `docker info` exceeds the 5s `dockerAvailable()` timeout
_2026-07-09_ · `server/test/helpers/pg.ts:23`

`dockerAvailable()` runs `execSync('docker info', { timeout: 5000 })`. On a cold daemon `docker info` can take ~5.7s and time out, so the helper returns false and the whole suite reports "N skipped" — indistinguishable at a glance from "passed", a false-pass trap that let 4 genuinely-failing CI it-tests hide as green across two implementer sandboxes. A warm `docker info` is ~1.1s. Before trusting an it-test run, warm the daemon (`docker info` twice) and immediately invoke vitest so the in-test check lands inside the warm window; then confirm the summary says "passed", not "skipped".

### The CI export it-tests false-pass locally on a gitignored agent-runner bundle that is absent in CI
_2026-07-09_ · `server/src/modules/ci/ci.it.test.ts`, `server/src/modules/ci/service.ts` (`buildRunnerFile`)

`action='open_pr'` reads `agent-runner/dist/index.js` off disk and throws `ConfigError` (→ 500) when it's missing. That bundle is ncc-built and re-ignored by `agent-runner/.gitignore`, so it is NEVER committed and is absent in CI (`server-integration.yml` does not build it) — yet a dev build sits in `agent-runner/dist/` locally, so `ci.it.test.ts` passed on my machine and 500'd in CI. One missing file cascaded into 5 red tests: AC-9/10, AC-11, AC-13 directly (open_pr 500 before `commitFiles` even ran, so AC-13 saw 500 not the 502 it expected), and AC-23/AC-26 indirectly (their `setupInstallation` helper calls open_pr → no installation row → `syncCiRuns` iterates 0 installations → `synced=0`/200 instead of ≥1/502). Same false-pass class as the docker-warm entry above but a different trigger — the fix is for the test to self-provision the artifact (create a stub bundle when absent, remove only what it created so a real local build is untouched); do NOT relax the production `ConfigError` guard and do NOT add an ncc build to CI (no assertion inspects bundle content). Any it-test whose success depends on a sibling package's uncommitted build output will false-pass locally and fail in CI.

## Codebase Patterns

### Zod `response` schemas are ENFORCED at runtime by serializerCompiler — they gate persisted-jsonb shape drift
_2026-07-03_ · `server/src/app.ts` (global `serializerCompiler`), e.g. `modules/onboarding-tours/routes.ts` (`response: { 200: OnboardingTour }`)

Declaring `response: { 200: Schema }` on a route is not documentation: `fastify-type-provider-zod`'s globally installed `serializerCompiler` validates the payload on the way OUT, so a row whose jsonb no longer matches the contract (e.g. `onboarding_tours.sections` persisted under an older shape) fails serialization → 500 → the client renders ErrorState instead of crashing on `.map`-of-string. Two consequences: (1) when evolving a persisted-jsonb contract, old rows become 500s until regenerated/backfilled — that's the designed failure mode, don't "fix" it by removing the response schema; (2) a service-level cast (`row.sections as X`) is less dangerous than it looks, because the route boundary still enforces the real shape. Found while judging the SPEC-02 legacy-row hazard during pr-self-review.
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

### parseUnifiedDiff `newLineNumbers` covers context lines too — grounding accepts citations on unchanged lines inside a hunk
_2026-07-05_ · `server/src/adapters/git/diff-parser.ts` (`hunk.newLineNumbers`)

`newLineNumbers` accumulates ALL new-side lines a hunk covers (context included), not only `+` additions — and the citation-grounding gate validates `start_line/end_line` against that superset. So a finding citing an unchanged context line inside a hunk still survives grounding, and any "must the expectation hit a `+` line?" check (e.g. self-validating eval seed diffs) that intersects with `newLineNumbers` is deliberately looser than added-lines-only. Don't "tighten" it to `+`-only without changing the gate's semantics.

### `eval_cases` is owner-polymorphic (`owner_kind` ∈ {agent, skill}) — skill benchmarks reuse it, no new cases table
_2026-07-09_ · `server/src/db/schema/eval.ts` (`evalCases.ownerKind`), `server/src/modules/skill-eval/`

The `eval_cases` table already carries `owner_kind: text({ enum: ['skill','agent'] })`, but until L06 only the `'agent'` path was wired (agent eval pipeline). When adding skill benchmarks, store the benchmark cases as `eval_cases` rows with `owner_kind='skill'` and `owner_id=<skillId>` — do NOT add a parallel cases table (only `skill_eval_runs`, the run records, is genuinely new). Consequence for tests: `seed-eval-cases.it.test.ts` asserts `toHaveLength(8)` but scopes its query by the General Reviewer's `ownerId`, so seeding extra skill-owned cases in `seed()` does not affect that count — a skill-cases count check must filter by `owner_kind='skill'` itself.

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

### TS2783 (field listed before a same-object spread) fails `tsc --noEmit` while vitest stays green
_2026-07-05_ · `server/src/modules/eval/scoring.test.ts` (fixture helpers)

Writing `{ file: 'a.ts', ...overrides }` where `overrides` may also carry `file` compiles under vitest's transform (esbuild strips types; later keys win at runtime) but `tsc --noEmit` rejects it with TS2783 "property specified more than once". A test suite can be fully green while the typecheck gate is red. In fixture builders, list defaults first and put the `...overrides` spread LAST, and never re-list a required field you're already spreading.

### Variadic UUID IN-clause in raw Drizzle SQL uses `= ANY(ARRAY[…]::uuid[])` + `sql.join`, not `inArray`
_2026-07-09_ · `server/src/modules/agents/repository.ts` (`lastDoneRunsPerAgent`)

`inArray(col, ids)` needs an ORM-mapped column reference and can't target the output of a raw window-function subquery. For a last-N-per-group query (`ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY ran_at DESC)` filtered to `rn <= 3`) written as `db.execute(sql\`…\`)`, pass the id list as `= ANY(ARRAY[${sql.join(ids.map(id => sql\`${id}\`), sql\`, \`)}]::uuid[])` — the `::uuid[]` cast is required or Postgres rejects the text-vs-uuid comparison. Pairs with the empty-array note above: guard `ids.length === 0` before building the clause.

### Drizzle `onConflictDoUpdate({ target })` throws at runtime if the target columns lack a UNIQUE index
_2026-07-09_ · `server/src/modules/ci/repository.ts`

`onConflictDoUpdate` / `onConflictDoNothing` with an explicit `target: [colA, colB]` typechecks fine but Postgres rejects it at runtime — `"there is no unique or exclusion constraint matching the ON CONFLICT specification"` — unless those columns carry a matching DB-level UNIQUE index. `ci_installations(agent_id, repo, target_type)` had none, so every `open_pr` export threw 500 and cascaded into 4 red it-tests, all under a green typecheck. Either add the unique index in the migration, or fall back to a select-then-insert/update in the repository. Never infer `target` validity from a passing `tsc`.

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

### `resolveFeatureModel` returns `provider: string`, but `container.llm()` takes a provider union — every caller casts
_2026-07-02_ · `server/src/modules/onboarding-tours/service.ts`, `server/src/modules/conventions/service.ts`, `platform/container.ts`

`container.llm()` is typed `'openai' | 'anthropic' | 'openrouter'`, while `FeatureModelChoice.provider` is plain `string`, so feature-model consumers either cast (`as 'openai' | …`, onboarding-tours) or hardcode the provider (conventions). A bad provider string persisted in settings would pass the type check via the cast and fail at runtime inside the adapter. Fix direction: type `FeatureModelChoice.provider` as the union (validate at the settings write edge), or add a narrowing helper on `Container`. Not urgent — settings UI only offers valid providers — but the cast pattern will spread with each new feature-model consumer.

> Updated 2026-07-03: the premise was WRONG — `FeatureModelChoice.provider` IS typed as the `Provider` z.enum (`contracts/platform.ts:26`), so no cast is needed at all; the implementer's cast was redundant and was removed in the SPEC-02 arch-fix pass. If you see `provider as 'openai' | …` after `resolveFeatureModel`, just delete it. The `conventions/service.ts` hardcoded-provider pattern remains the only real oddity.
