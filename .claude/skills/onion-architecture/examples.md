# Onion architecture — concrete examples

Skeletons referenced from [SKILL.md](SKILL.md). Each example mirrors a real file in the repo so you can verify the pattern against working code.

---

## Example 1: New module from scratch

Scenario: add a `widgets` module — list and create widgets, scoped to a workspace.

Real-world references: `server/src/modules/reviews/` (full triple + repository-split), `server/src/modules/settings/` (lighter module without a service when the logic is trivial).

### `server/src/modules/widgets/routes.ts`

```ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { WidgetService } from './service.js';

// Transport DTOs (HTTP edge). Keep separate from any domain Zod schemas.
const CreateWidgetBody = z.object({
  name: z.string().min(1).max(80),
  color: z.enum(['red', 'green', 'blue']),
});

export default async function widgetsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new WidgetService(container);

  app.get('/widgets', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return { widgets: await service.list(workspaceId) };
  });

  app.post(
    '/widgets',
    { schema: { body: CreateWidgetBody } },
    async (req) => {
      const { workspaceId, userId } = await getContext(container, req);
      const widget = await service.create(workspaceId, userId, req.body);
      return { widget };
    },
  );

  app.get(
    '/widgets/:id',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return { widget: await service.getById(workspaceId, req.params.id) };
    },
  );
}
```

Then in `server/src/modules/index.ts`:

```ts
import widgetsRoutes from './widgets/routes.js';
// …existing imports…

export const modules = [
  // …existing entries…
  { name: 'widgets', plugin: widgetsRoutes },
];
```

### `server/src/modules/widgets/service.ts`

```ts
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { WidgetRepository } from './repository.js';

export interface CreateWidgetInput {
  name: string;
  color: 'red' | 'green' | 'blue';
}

export class WidgetService {
  private repo: WidgetRepository;

  constructor(private container: Container) {
    this.repo = new WidgetRepository(container.db);
  }

  list(workspaceId: string) {
    return this.repo.listByWorkspace(workspaceId);
  }

  async create(workspaceId: string, userId: string, input: CreateWidgetInput) {
    return this.repo.insert({ workspaceId, createdBy: userId, ...input });
  }

  async getById(workspaceId: string, id: string) {
    const widget = await this.repo.findById(workspaceId, id);
    if (!widget) throw new NotFoundError(`widget ${id} not found`);
    return widget;
  }
}
```

Notes:
- Constructor takes `Container`, never raw adapters.
- Throws `NotFoundError` (from `platform/errors.ts`) — the global handler renders the `ApiErrorBody` envelope.
- No Drizzle import here — the repository owns it.

### `server/src/modules/widgets/repository.ts`

```ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

// Drizzle row type — module-internal. Map to a shared type if it ever crosses
// the module boundary in a wider-than-this-module API.
export type WidgetRow = typeof t.widgets.$inferSelect;

export class WidgetRepository {
  constructor(private db: Db) {}

  listByWorkspace(workspaceId: string) {
    return this.db.select().from(t.widgets).where(eq(t.widgets.workspaceId, workspaceId));
  }

  findById(workspaceId: string, id: string) {
    return this.db
      .select()
      .from(t.widgets)
      .where(and(eq(t.widgets.workspaceId, workspaceId), eq(t.widgets.id, id)))
      .then((rows) => rows[0]);
  }

  async insert(input: {
    workspaceId: string;
    createdBy: string;
    name: string;
    color: 'red' | 'green' | 'blue';
  }): Promise<WidgetRow> {
    const [row] = await this.db.insert(t.widgets).values(input).returning();
    return row;
  }
}
```

Notes:
- `Db` is imported from `../../db/client.js` — the only DB import in the module.
- Workspace scoping is enforced in **every** query (`and(eq(workspaceId), …)`).
- Multi-aggregate module? Split into `repository/widget.repo.ts` + `repository/tag.repo.ts` and have `repository.ts` compose them. See `server/src/modules/reviews/repository/` for the canonical pattern.

### What NOT to do

```ts
// ❌ Drizzle in the service
// service.ts
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
class WidgetService {
  list(workspaceId: string) {
    return this.container.db.select().from(t.widgets).where(eq(t.widgets.workspaceId, workspaceId));
  }
}

// ❌ Schema.parse in the handler
app.post('/widgets', async (req) => {
  const body = CreateWidgetBody.parse(req.body); // bypasses 422 path
  // …
});

// ❌ Service-to-service import
// widgets/service.ts
import { ReviewService } from '../reviews/service.js'; // forbidden cross-module dep
```

---

## Example 2: Adding a new outbound port

Scenario: the widget creation flow needs to call a third-party "Sentiment API" to score the widget name. New outbound HTTP → new port.

Real-world references: `server/src/vendor/shared/adapters.ts` (port interfaces), `server/src/adapters/embedder/openai.ts` (gated adapter), `server/src/platform/container.ts` (DI wiring), `server/src/adapters/mocks.ts` (test mocks).

### Step 1 — declare the port in `@devdigest/shared`

In `server/src/vendor/shared/adapters.ts`:

```ts
// ---------- Sentiment ----------
export interface SentimentClient {
  score(text: string): Promise<{ value: number; label: 'pos' | 'neg' | 'neu' }>;
}
```

Re-export from `server/src/vendor/shared/index.ts` if it isn't picked up by the existing `export *` line.

### Step 2 — concrete adapter

`server/src/adapters/sentiment/http.ts`:

```ts
import type { SentimentClient } from '@devdigest/shared';
import { ExternalServiceError } from '../../platform/errors.js';

export class HttpSentimentClient implements SentimentClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async score(text: string) {
    const res = await fetch(`${this.baseUrl}/score`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      throw new ExternalServiceError(`sentiment api ${res.status}`);
    }
    const json = (await res.json()) as { value: number; label: 'pos' | 'neg' | 'neu' };
    return json;
  }
}
```

Notes:
- `implements SentimentClient` — typecheck is the contract.
- Failure throws `ExternalServiceError` (from `platform/errors.ts`) so the global handler can shape the response. **Never** swallow + rethrow with a string.
- No DB, no Fastify, no module imports — adapters are leaves.

Re-export from `server/src/adapters/index.ts`:

```ts
export { HttpSentimentClient } from './sentiment/http.js';
```

### Step 3 — DI wiring in `server/src/platform/container.ts`

```ts
import type { SentimentClient } from '@devdigest/shared';
import { HttpSentimentClient } from '../adapters/sentiment/http.js';
import { ConfigError } from './errors.js';

export interface ContainerOverrides {
  // …existing fields…
  sentiment?: SentimentClient;
}

export class Container {
  // …existing fields…
  private _sentiment?: SentimentClient;

  sentiment(): SentimentClient {
    if (this._sentiment) return this._sentiment;
    if (!this.config.SENTIMENT_ENABLED) {
      throw new ConfigError('sentiment is disabled (SENTIMENT_ENABLED=false)');
    }
    const key = this.config.SENTIMENT_API_KEY;
    if (!key) throw new ConfigError('SENTIMENT_API_KEY missing');
    this._sentiment = new HttpSentimentClient(this.config.SENTIMENT_BASE_URL, key);
    return this._sentiment;
  }
}
```

Notes:
- Resolver is lazy: SDK constructor never runs until the adapter is asked for. Gate check happens **before** any keys are read or clients constructed.
- Cached on the container instance — one per app instance.
- Override path for tests: `new Container({ ..., overrides: { sentiment: new MockSentimentClient() } })`.

### Step 4 — consume from a service

```ts
// widgets/service.ts
async create(workspaceId: string, userId: string, input: CreateWidgetInput) {
  const sentiment = this.container.sentiment().score(input.name).catch(() => null);
  const row = await this.repo.insert({ workspaceId, createdBy: userId, ...input });
  const scored = await sentiment;
  if (scored) await this.repo.attachSentiment(row.id, scored);
  return row;
}
```

The service consumes the port via `this.container.sentiment()`. It never sees `fetch` or the SDK.

### Step 5 — test fake

Add to `server/src/adapters/mocks.ts`:

```ts
import type { SentimentClient } from '@devdigest/shared';

export class MockSentimentClient implements SentimentClient {
  constructor(private fixed: { value: number; label: 'pos' | 'neg' | 'neu' } = { value: 0, label: 'neu' }) {}
  async score() { return this.fixed; }
}
```

Now the widget service tests can pass `{ sentiment: new MockSentimentClient({ value: 0.9, label: 'pos' }) }` via `ContainerOverrides` and stay hermetic (no network, no `.it.` suffix).

---

## Example 3: Adding capability to `reviewer-core`

Scenario: the engine needs the project's `README.md` to bias the review.

The wrong instinct is to read it from inside the engine. That breaks purity. The right move is to take it as an argument and let the caller (the server) supply it.

Real-world references: `reviewer-core/src/index.ts` (public surface), `reviewer-core/src/review/run.ts` (`ReviewInput`).

### ❌ Wrong: filesystem access in the engine

```ts
// reviewer-core/src/review/run.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function reviewPullRequest(input: ReviewInput) {
  const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8'); // ❌ ❌ ❌
  // - filesystem access in a pure engine
  // - process.env / cwd assumption
  // - now the CI runner needs the file to be at cwd, too
  // …
}
```

This fails the purity checklist on every line: fs import, `process.cwd()` read, and the engine now silently depends on a working directory layout.

### ✅ Right: take it as an argument

In `reviewer-core/src/review/run.ts`:

```ts
export interface ReviewInput {
  // …existing fields…
  llm: LLMProvider;

  /** Optional project README text — caller supplies, engine never reads files. */
  readme?: string;
}

export async function reviewPullRequest(input: ReviewInput): Promise<ReviewOutcome> {
  const parts: PromptParts = {
    // …existing parts…
    ...(input.readme ? { readme: input.readme } : {}),
  };
  // …
}
```

In `reviewer-core/src/prompt.ts` add a slot to `PromptParts` and make `assemblePrompt` silently skip it when empty — that's the engine's existing convention (`skills`, `memory`, `specs`, `callers` work the same way).

If a new public type came out of this, re-export from `reviewer-core/src/index.ts` — the public surface lives in one file.

### ✅ The server reads the file

In `server/src/modules/reviews/service.ts` (or `run-executor.ts`):

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewPullRequest } from '@devdigest/reviewer-core';

const readme = await readFile(join(this.container.config.REPOS_DIR, repo.slug, 'README.md'), 'utf8')
  .catch(() => undefined);

const outcome = await reviewPullRequest({
  // …existing inputs…
  llm: this.container.llm(agent.providerId),
  readme,
});
```

The server owns the I/O. The engine stays pure, hermetic-testable, and reusable from the CI runner without modification.

### Purity checklist for the change

- [x] No `node:fs` in `reviewer-core/`
- [x] No `process.env` in `reviewer-core/`
- [x] New optional input declared on `ReviewInput`
- [x] `assemblePrompt` no-ops on empty `readme` (matches existing slot behavior)
- [x] Public types exported from `reviewer-core/src/index.ts`
- [x] Engine test in `reviewer-core/test/` passes a literal string — no file fixtures
- [x] Server test that exercises the new wiring lives in `server/src/modules/reviews/*.it.test.ts` (it touches the real filesystem layout)
