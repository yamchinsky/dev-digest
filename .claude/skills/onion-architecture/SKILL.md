---
name: onion-architecture
description: "Layering and dependency-rule conventions for the DevDigest backend (`server/` Fastify + Drizzle, and `reviewer-core/` pure engine). Use whenever editing or adding code in `server/src/` or `reviewer-core/src/`; whenever adding a new module / use case / repository / adapter / outbound port / shared contract; whenever the question is *where should this live* on the backend (route vs service vs repository vs adapter vs platform vs shared); whenever reviewing a backend PR for layer violations (Drizzle in a service, Octokit in a route, `process.env` in `reviewer-core`, services importing other modules' services, SDK imports leaking past the adapter boundary). Trigger phrases: 'new endpoint', 'new module', 'where should this go', 'add a repository', 'add an adapter', 'wire up a port', 'consume X from a service', 'reviewer-core needs to read', 'service is doing too much'. Layering and dependency placement ONLY — NOT Fastify runtime patterns (use `fastify-best-practices`), NOT Drizzle query syntax (use `drizzle-orm-patterns`), NOT Zod schema mechanics (use `zod`). For the client side use `frontend-architecture`."
version: 0.1.0
---

# Onion Architecture — DevDigest backend layering

Where code lives in `server/` and `reviewer-core/`, and which way dependencies are allowed to point. **Layering decisions only** — not Fastify runtime (`fastify-best-practices`), not Drizzle syntax (`drizzle-orm-patterns`), not Zod mechanics (`zod`).

This is the **DevDigest-Onion** variant: feature-modular outside, onion-layered inside. It codifies the *existing* pattern in the repo — it does not propose a refactor to classical `domain/application/infrastructure` rings, and it does not introduce a DI framework. For concrete code skeletons, see [examples.md](examples.md). For sources and version history, see [README.md](README.md).

## When to use this skill

- Adding a new module under `server/src/modules/`
- Adding a new outbound integration (DB, HTTP, LLM, GitHub, fs)
- Deciding where a piece of logic goes: route vs service vs repository vs adapter vs platform vs shared
- Adding capability to `reviewer-core/` without breaking its purity
- Reviewing a backend PR for layer violations
- Resolving "should this be a port?" debates

## Severity levels

- **CRITICAL** — wrong choice rots the architecture or breaks an invariant the rest of the system depends on
- **HIGH** — wrong choice creates lasting maintenance friction
- **MEDIUM** — wrong choice hurts DX but is locally fixable

---

## 1. The DevDigest-Onion model (CRITICAL)

Four rings, dependencies point inward.

| Ring | Lives in | Examples |
|---|---|---|
| **Domain core** — entities, value objects, pure invariants, shared contracts | `@devdigest/shared` (= `server/src/vendor/shared/`); `reviewer-core/src/` (the whole package is a domain-leaning core) | `Finding`, `Review`, `Verdict`, `RunEvent` types; port interfaces (`LLMProvider`, `Embedder`, `GitHubClient`) |
| **Application / use cases** — orchestration, no I/O of its own | `server/src/modules/<name>/service.ts`; `reviewer-core/src/review/run.ts` | `ReviewService.runReview()`, `assemblePrompt → groundFindings` pipeline |
| **Infrastructure adapters** — DB, HTTP, LLM, GitHub, fs, secrets, time | `server/src/adapters/<port>/*`, `server/src/modules/<name>/repository.ts`, `server/src/db/` | `OpenAIProvider`, `OctokitGitHubClient`, `OpenAIEmbedder`, Drizzle repos |
| **Presentation** — HTTP edge, schemas, error envelope, SSE, plugins | `server/src/modules/<name>/routes.ts`, `server/src/platform/*` | Zod request/response schemas, `app.ts` error handler, `sse.ts` bus |

**Dependency Rule** (concrete, enforce in review):

- `routes.ts` may import `service.ts`, Zod schemas, `getContext`, `_shared/`. **Never** Drizzle, **never** Octokit, **never** `db/`, **never** an adapter SDK directly.
- `service.ts` may import `Container`, sibling `repository.ts`, `@devdigest/shared`, `@devdigest/reviewer-core`. **Never** Fastify, **never** another module's service, **never** raw adapters (always via `Container`).
- `repository.ts` is the **only** place Drizzle is imported in a module. It may import `@devdigest/shared` types and `db/schema`. It must **not** import Fastify, adapters, or another module's repository.
- `adapters/<port>/*.ts` implements a port interface from `@devdigest/shared` (or the engine port consumed in `reviewer-core/src/review/run.ts`). May import third-party SDKs freely; **never** imports Fastify, **never** imports `db/`, **never** imports a module's service or repository.
- `reviewer-core/**` may **never** import `fastify`, `drizzle-orm`, `postgres`, `@octokit/*`, `node:fs`, `node:path`, `node:child_process`. May **never** read `process.env`. Only side effect is the injected `LLMProvider`.

---

## 2. Module skeleton — the non-negotiable triple (CRITICAL)

Every feature module is a folder under `server/src/modules/<name>/`:

```
modules/<name>/
  routes.ts        # Fastify plugin: Zod schemas + thin handlers
  service.ts       # business logic; constructor(container: Container)
  repository.ts    # Drizzle queries; module-internal
```

Then add **one** import + **one** entry to `src/modules/index.ts`. No filesystem autoload — static registration is intentional (see `server/AGENTS.md`).

### Route handler shape

The handler does exactly three things, in this order:

1. `await getContext(container, req)` — workspace + auth (see `modules/_shared/context.ts`)
2. Call the service
3. Return the result (Fastify serializes; the route's Zod response schema validates)

Validation happens via `fastify-type-provider-zod` **before** the handler runs. **Never** `Schema.parse(req.body)` inside a handler — that bypasses the 422 path.

### Service shape

```ts
export class FooService {
  private repo: FooRepository;
  constructor(private container: Container) {
    this.repo = new FooRepository(container.db);
  }
  async doThing(workspaceId: string, input: Input): Promise<Output> { /* … */ }
}
```

Adapters resolve lazily via `container.llm(id)`, `container.github()`, `container.embedder()`, etc. **Never** `new OpenAIProvider(...)` in a service.

When you need a side effect that does not yet have a port, add a port (see §3) — do **not** import the SDK in the service.

### Repository shape

The only Drizzle importer in the module. Returns either raw Drizzle row types (for module-internal use) or shared `@devdigest/shared` types when the data flows out to the service / API. **Don't** return raw Drizzle row types from a service — map at the boundary (see §5).

For multi-aggregate modules, split into `repository/<aggregate>.repo.ts` and compose them in `repository.ts` — see `server/src/modules/reviews/repository/` for the canonical example.

See the full skeleton in [examples.md](examples.md) — *Example 1: New module from scratch*.

---

## 3. Ports & adapters (HIGH)

### When to add a new port

Add a port when **any** is true:

- The dependency is an outbound side effect: DB, HTTP, LLM, fs, env, time, randomness.
- You want to fake it in unit tests (= cannot run the real thing in a hermetic test).
- More than one concrete implementation is plausible (real + mock; or OpenAI + Anthropic + OpenRouter).

### Where each piece lives

| Piece | Path | Notes |
|---|---|---|
| Port interface | `server/src/vendor/shared/adapters.ts` → re-exported via `@devdigest/shared` | Shared contracts live in one file so both `server/` and `reviewer-core/` can import them |
| Concrete adapter | `server/src/adapters/<port>/<impl>.ts` | E.g. `adapters/embedder/openai.ts`, `adapters/github/octokit.ts` |
| Adapter barrel | `server/src/adapters/index.ts` | Re-exports concrete classes |
| Mock for tests | `server/src/adapters/mocks.ts` | `MockLLMProvider`, `MockEmbedder` live here together |
| DI registration | `server/src/platform/container.ts` | Lazy getter, cached, env-gated where applicable |

### Engine ports (reviewer-core)

`reviewer-core/src/review/run.ts` declares its inputs as a typed `ReviewInput` whose `llm: LLMProvider` field comes from `@devdigest/shared`. The engine never news up a provider — the server does, and passes it in. If `reviewer-core` ever needs a *new* outbound (e.g. a search index), add a port to `@devdigest/shared`, declare it on `ReviewInput`, and let the server pass a concrete adapter.

### Gated adapters

`container.embedder()` throws `ConfigError` when `EMBEDDINGS_ENABLED=false`, **before** constructing the SDK client. Match this pattern for any new adapter behind a feature flag — the gate must fire before any third-party SDK constructor runs. See `server/src/adapters/embedder/openai.ts` + its wiring in `container.ts`.

### Anti-patterns

- A service importing `@octokit/rest` or `openai` directly → push behind an existing or new port.
- An adapter importing `db/schema` → that's a repository, not an adapter.
- Two near-identical adapters for the same port → keep one, parameterise.

See [examples.md](examples.md) — *Example 2: Adding a new outbound port*.

---

## 4. Where logic goes — decision table (CRITICAL)

The single most-asked question. Look it up here before writing.

| Kind of logic | Goes in | Anti-pattern |
|---|---|---|
| HTTP schema, request parsing, response shaping | `routes.ts` (Zod, `fastify-type-provider-zod`) | Business branching inside the handler body |
| Workspace scoping, auth pull from `req` | `getContext(container, req)` at the top of the handler, then pass `workspaceId` to the service | Reading `req` inside `service.ts` |
| Orchestration of multiple adapters / repos / engine calls | `service.ts` | A repository calling another repository |
| Single-aggregate read/write, SQL | `repository.ts` (or `repository/<aggregate>.repo.ts`) | `db.select(...)` outside a repo file |
| Cross-cutting infrastructure: pricing, SSE, model routing, error taxonomy, resilience, run-logger | `server/src/platform/*` | Re-implementing one of these inside a module |
| Pure prompt assembly / grounding / map-reduce / output shaping | `reviewer-core/src/{prompt,grounding,review,output}/` | Putting it in `server/` (would break engine reuse from the CI runner) |
| Outbound HTTP / LLM / GitHub / git / fs call | `server/src/adapters/<port>/<impl>.ts` (behind a port interface) | Importing the SDK directly in a service |
| Shared Zod contract or port interface (cross-module / cross-package) | `server/src/vendor/shared/` (`@devdigest/shared`) | Redefining `Finding` / `Review` / `LLMProvider` in `reviewer-core` |
| Module-internal helpers (DTO mappers, small pure functions) | `modules/<name>/helpers.ts` (or `.ts` siblings) | Promoting one-shot helpers to `platform/` |
| Mocks for tests | `server/src/adapters/mocks.ts` | A per-module `__mocks__/` directory |

---

## 5. Zod three-way split (HIGH)

Zod schemas serve three distinct purposes — do **not** merge them.

| Purpose | Where it lives | Why separate |
|---|---|---|
| **Transport DTO** (HTTP request / response) | `routes.ts` (declared inline next to the route) or `_shared/schemas.ts` for cross-module ids | Untrusted input; tolerant parsing; errors become `422` via the route plugin and `ApiErrorBody` envelope |
| **Domain invariant** (the canonical shape of a `Finding`, `Review`, `RunEvent`) | `server/src/vendor/shared/contracts/*` (= `@devdigest/shared`) | Single source of truth consumed by both `server/` and `reviewer-core/` |
| **Adapter decoder** (Drizzle row → entity, third-party response → typed result) | Private to the repository / adapter file | DB and domain shapes drift; keep ORM types from leaking up the rings |

Share atoms (enums, branded ids) via composition — `z.object({ ...IdParams.shape, ... })` — not by reusing one whole schema across two purposes "to save lines". When the schemas have drifted enough that you're tempted to fork them, **fork them.**

For `/:id` where the id is a uuid (DB primary key), reuse `modules/_shared/schemas.ts::IdParams`. Only define a fresh schema when the id is not a uuid (e.g. `/providers/:id` where id is a provider name).

---

## 6. `reviewer-core` purity invariants (CRITICAL)

Run this checklist *before* writing any code in `reviewer-core/`:

- [ ] No `process.env` reads — all inputs are function arguments.
- [ ] No `node:fs`, `node:path`, `node:child_process`. (Pure `node:crypto`, `node:util` is fine.)
- [ ] No `drizzle-orm`, `postgres`, `@octokit/*`, `fastify` imports.
- [ ] LLM calls go through the `LLMProvider` arg, not a `new OpenAI(...)` inside the engine.
- [ ] `groundFindings` runs on every emitted finding; never bypassed (see `reviewer-core/AGENTS.md`).
- [ ] Optional prompt slots (`skills`, `memory`, `specs`, `callers`) silently no-op when empty — don't throw, don't insert placeholder headers.
- [ ] New public types / functions are added to `reviewer-core/src/index.ts` (the entire public surface). Anything not re-exported there is module-internal.

**If you need to read a file, call an API, or look at an env var** — that work belongs in the **server**, which then plumbs the result into the engine as an argument. See [examples.md](examples.md) — *Example 3: Adding capability to `reviewer-core`*.

This invariant is what lets the same engine code run unchanged from the CI runner. Don't break it for ergonomics.

---

## 7. DI & the Container (HIGH)

- **One composition root**: `server/src/platform/container.ts`. Don't create a second.
- Services constructor signature: `constructor(container: Container)`. Adapters resolve via `container.llm(id)`, `container.github()`, etc. — all cached.
- Tests inject mocks via `ContainerOverrides` (interface declared in `container.ts`). Production code must never `new OpenAIProvider(...)` directly.
- **No decorator DI** (no `tsyringe`, no `@injectable`) — and especially never inside `reviewer-core`. Decorator-based DI couples the domain to a runtime container, breaking Palermo's tenet that the core must run without infrastructure. The manual composition we already have is sufficient.
- New adapter that depends on a secret? After persisting via `SecretsProvider.set`, call `container.invalidateSecretCaches()` so the next resolve picks it up.
- New gated adapter? Throw `ConfigError` from the container resolver *before* the SDK constructor runs (mirror `embedder()`).

---

## 8. Cross-package boundary rules (HIGH)

- Cross-package imports go through tsconfig path aliases: `@devdigest/reviewer-core`, `@devdigest/shared`. **Never** relative `../../reviewer-core/src/...`.
- ESM `.js` suffix on relative imports inside `server/src/` and `reviewer-core/src/` — required by tsx and the bundler (e.g. `import './service.js'`).
- `reviewer-core` is consumed as **TS source**, not built JS. Its build is `tsc --noEmit`. Don't add an emit step or a `dist/` import.
- Package managers: `server/` uses **pnpm**, `reviewer-core/` uses **npm**. Don't `pnpm install` inside `reviewer-core/`.
- `OpenRouterProvider` lives in `reviewer-core/src/llm/openrouter.ts` (not in `server/src/adapters/llm/`) because the CI runner also needs it. Don't duplicate it server-side.

---

## 9. Testing implications (MEDIUM)

The `*.it.test.ts` split maps directly to the rings (see `server/AGENTS.md` and `TESTING.md`):

| Ring | Test type | Filename |
|---|---|---|
| Domain (`reviewer-core/**`, shared contracts) | Unit, hermetic, fast | no `.it.` suffix |
| Application (`server/src/modules/<name>/service.ts`) | Unit with fake ports via `ContainerOverrides` | no `.it.` suffix |
| Infrastructure (`server/src/adapters/**`, `server/src/modules/<name>/repository.ts`) | Integration, testcontainers Postgres / recorded transport | `*.it.test.ts` |
| Presentation (routes) | Smoke / contract via Fastify inject | usually unit |

**Rule of thumb:** if a "unit" test needs a real DB or network, the dependency points outward — fix the layering, not the test. Push the dependency behind a port.

Reach for `server/src/adapters/mocks.ts` (`MockLLMProvider`, `MockGitClient`, `MockEmbedder`) rather than ad-hoc stubs.

---

## 10. When NOT to use Onion (MEDIUM)

Escape hatch for true CRUD with no branching:

- A pure get/put endpoint can have a thin service that delegates to one repo method and immediately returns. Don't invent fake "use cases" with no logic.
- A small read-only module may not need `service.ts` at all — but keep `repository.ts` separate, because Drizzle must never leak into `routes.ts`.

Don't apply this escape hatch when:

- There is *any* branching, retry, fan-out, or side-effect composition.
- The endpoint is workspace-scoped (always go through `getContext`).
- The endpoint touches >1 adapter or repo.

---

## 11. Common pitfalls catalog

One-line smell → one-line fix.

- **Drizzle types leaking out of `repository.ts`** → map to a domain shape (or `@devdigest/shared` type) at the boundary.
- **Anthropic / OpenAI / Octokit SDK imported in `service.ts`** → push behind an existing port (`container.llm` / `container.github`) or add a new one.
- **`process.env` read inside `reviewer-core`** → take the value as a function argument; the server reads env and plumbs it in via `Container`.
- **`service.ts` instantiating another module's service** → if cross-module orchestration is needed, the dep belongs in `platform/`, or factor a port that both depend on.
- **One Zod schema serving HTTP and DB row decoding** → fork per §5.
- **Route handler doing more than `parse → call service → return`** → move the logic into the service.
- **Adapter caught and rethrown with a richer error** → throw the right `AppError` subclass (`ExternalServiceError` for adapter failures), let the global handler render `ApiErrorBody`.
- **A new long-running job kind that isn't reaped on boot** → add it to `ReviewService.reapStaleRuns` (or its equivalent) — orphaned `running` rows leak otherwise.
- **`Schema.parse(req.body)` inside a handler** → declare the schema on the route's `body` / `params` / `querystring` so 422 happens before the handler.
- **`reply.status(500).send({ error: ... })`** → throw an `AppError`; the global handler owns the envelope.

---

## 12. Decision flowchart (one-page summary)

```
NEW BACKEND FILE → WHAT IS IT?

├── HTTP endpoint
│    └── modules/<name>/routes.ts
│        (handler = getContext → service.call → return)
│
├── Business logic / orchestration
│    └── modules/<name>/service.ts
│        (constructor(container: Container))
│
├── DB query (Drizzle)
│    ├── single aggregate → modules/<name>/repository.ts
│    └── multi-aggregate  → modules/<name>/repository/<aggregate>.repo.ts
│
├── Outbound SDK call (LLM / HTTP / GitHub / git / fs)
│    ├── port interface  → server/src/vendor/shared/adapters.ts (@devdigest/shared)
│    ├── concrete impl   → server/src/adapters/<port>/<impl>.ts
│    ├── re-export       → server/src/adapters/index.ts
│    ├── DI wiring       → server/src/platform/container.ts
│    └── test mock       → server/src/adapters/mocks.ts
│
├── Cross-cutting (pricing, SSE, model routing, error taxonomy, resilience)
│    └── server/src/platform/<topic>.ts
│
├── Shared contract / type / port interface
│    └── server/src/vendor/shared/{contracts,adapters}.ts (@devdigest/shared)
│
├── Pure prompt / grounding / map-reduce / output shaping
│    └── reviewer-core/src/{prompt,grounding,review,output}/
│        (export from src/index.ts if a consumer should see it)
│
├── Module-internal helper / DTO mapper
│    └── modules/<name>/helpers.ts
│
└── Test
     ├── DB-backed or testcontainers → *.it.test.ts
     └── Anything else (hermetic)    → *.test.ts (no .it. suffix)
```

---

For concrete code skeletons of each common task, see [examples.md](examples.md).
