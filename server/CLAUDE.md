# CLAUDE.md — `server/` conventions

Module-scoped rules for `@devdigest/api`. **Architecture, env vars, API map,
and the three review-context rules live in `README.md`** — this file holds the
"how we write code here" conventions that aren't obvious from a single source
file.

**Read `README.md`** before reasoning about request flow, the DI graph, or env
configuration.

**Read `docs/`** for deep dives that don't fit in `README.md` (sub-architecture,
ADRs, runbooks for repo-intel / reviews / SSE). Empty until topics get
written.

**Read `specs/`** when you touch a route schema, the `ApiErrorBody` envelope,
SSE event payloads, or a fixture shared by integration tests.

**Read `INSIGHTS.md`** before solving a non-obvious bug — durable, surprising
lessons that bit this module.

**Read `../TESTING.md`** before adding **any** test in this package.

**Read `../CLAUDE.md`** for repo-wide globals (no workspace, mixed
pnpm/npm, …) that apply here too.

**Read `src/modules/index.ts`** to see the static module registry (the comment
at the top explains how to add a new module).

**Read `src/platform/container.ts`** when touching adapters, DI wiring, or the
PriceBook/embedder/LLM resolution path — it's the composition root.

## Module shape (non-negotiable)

Every feature module is a self-contained folder under `src/modules/<name>/`:

```
modules/<name>/
  routes.ts        # Fastify plugin: zod schemas + handlers (thin)
  service.ts       # business logic, takes `Container` in ctor
  repository.ts    # Drizzle queries; never imported outside the module
```

Then add **one** import + **one** entry to `src/modules/index.ts`. Do **not**
use filesystem autoload — static registration is intentional (same code path
under tsx, bundler, and vitest).

## Validation at the edge

Routes declare zod schemas for `params` / `body` / `querystring` via
`fastify-type-provider-zod`. **Never** `Schema.parse(req.body)` inside a
handler — invalid input must become a `422` **before** the handler runs.

For `/:id` where the id is a uuid (DB primary key), reuse
`modules/_shared/schemas.ts::IdParams`. Only define a fresh schema when the id
isn't a uuid (e.g. `/providers/:id` where id is a provider name).

## Request scoping via `getContext`

Every handler that touches workspace-scoped state starts with:

```ts
const { workspaceId, userId } = await getContext(app.container, req);
```

Never inline `container.auth.currentWorkspace(req)` — `getContext`
(`modules/_shared/context.ts`) is the single chokepoint so workspace scoping is
never forgotten and so a future real `AuthProvider` lands in one place.

## Errors via `AppError` taxonomy

Throw `NotFoundError` / `ValidationError` / `ExternalServiceError` /
`ConfigError` (from `platform/errors.ts`). The global error handler in
`app.ts` translates them into the `ApiErrorBody` envelope
(`{ error: { code, message, details } }`). **Don't** `reply.status(...).send({ error: ... })`
ad hoc for failure paths — that bypasses the envelope and the structured log.

## DI: services take `Container`, never raw adapters

Services constructors are `constructor(container: Container)`. Adapters resolve
lazily via `container.llm(id)`, `container.github()`, `container.embedder()`,
`container.repoIntel`, etc. — all cached. Tests inject mocks via
`ContainerOverrides` (see `src/adapters/mocks.ts`), so production code must
never `new OpenAIProvider(...)` directly.

When you persist a new API key via `SecretsProvider.set`, call
`container.invalidateSecretCaches()` so the next resolve picks it up.

## ESM imports end in `.js`

Even though source is `.ts`, internal imports use the `.js` extension
(`import './service.js'`) so tsx + the future bundler both resolve correctly.
Cross-package: `@devdigest/shared` (Zod contracts) and
`@devdigest/reviewer-core` (the review engine — yes, `OpenRouterProvider`
lives there, not in `adapters/llm/`).

## Embeddings are gated; respect the gate

`container.embedder()` throws `ConfigError` when `EMBEDDINGS_ENABLED=false`,
**before** constructing the OpenAI client — so the app makes zero OpenAI
requests when embeddings are off. Every caller wraps in `try/catch` and
degrades gracefully (memory/RAG returns no hits). Don't bypass the gate or
catch-and-rethrow.

## Drizzle schema is fixed

`db/schema/` already contains every table the course will use; lessons fill
empty tables, they don't add new ones. If you genuinely need a new column or
table, run `pnpm db:generate` and commit the generated migration alongside the
schema change. Migrations are **never** applied on boot — `pnpm db:migrate` is
manual.

## Testing

- **`*.it.test.ts` ⇒ DB-backed** via testcontainers (`test/helpers/pg.ts`,
  pgvector image). Self-skips when Docker is absent. Migrations run inside the
  helper; don't roll your own DB setup.
- **Everything else is hermetic** — reach for `src/adapters/mocks.ts`
  (`MockLLMProvider`, `MockGitClient`, …) rather than real network/keys.
- The split is by **filename**, enforced in CI by `pnpm exec vitest run`
  invocations (see root `CLAUDE.md` re `skip-worktree`).

A DB-backed test that imports `test/helpers/pg.ts` **must** end in
`.it.test.ts` or the unit lane will run it and fail in CI without Docker.

## Rate limits

Global `120/min` is registered globally (disabled when `NODE_ENV=test`).
Per-route caps go on the route itself via `config: { rateLimit: ... }`.
SSE endpoints and `/health*` must set `rateLimit: false`.

## Boot reaper (don't break it)

`buildApp` awaits `ReviewService.reapStaleRuns()` **before** the server
accepts requests. A fresh process has no in-flight runs yet, so every
`'running'` row is genuinely orphaned. If you add a new long-running job kind,
add it to the reaper rather than letting rows leak.

This assumes a **single API instance per DB** — multi-replica deployment would
need per-instance scoping / heartbeats. Not this app's deployment.

## How to grow this file

- **New convention?** → add a section here.
- **One-off surprise / "looked obvious and wasn't"?** → append an entry to
  `INSIGHTS.md`.
- **Topic outgrowing this file?** → promote to `docs/<topic>.md` and link it
  from the `Read … when …` block above.
- **New contract / fixture?** → add it under `specs/` with a short doc.
