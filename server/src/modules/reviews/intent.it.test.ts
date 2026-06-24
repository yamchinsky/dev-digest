/**
 * Integration tests for intent persistence (T7 / R4, R5) against a real
 * Postgres container. Requires Docker — skips cleanly when unavailable.
 *
 * Covers:
 *   R4 — `getIntent` returns the persisted Intent after `upsertIntent`.
 *   R5 — A second `upsertIntent` (or `recomputeIntent` call) updates the row
 *        IN PLACE: one row, latest values, no duplicates.
 *
 * R7 (intent-derivation failure does not fail agent runs) is left to manual
 * verification: testing it hermetically requires a full Fastify + background
 * executor + run lifecycle, which would duplicate the integration coverage in
 * reviews.it.test.ts and is prone to timing-dependent flakiness.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { MockLLMProvider, MockGitClient, MockEmbedder } from '../../adapters/mocks.js';
import type { Intent } from '@devdigest/shared';
import { ReviewRepository } from './repository.js';
import { ReviewService } from './service.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[intent.it] Docker not available — skipping testcontainers integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INTENT_V1: Intent = {
  intent: 'Add rate limiting to prevent API abuse.',
  in_scope: ['src/middleware/ratelimit.ts'],
  out_of_scope: ['authentication'],
};

const INTENT_V2: Intent = {
  intent: 'Implement token-bucket rate limiting on all public endpoints.',
  in_scope: ['src/middleware/ratelimit.ts', 'src/api/public/index.ts'],
  out_of_scope: ['authentication', 'billing'],
};

// ---------------------------------------------------------------------------
// Seeding helper — unique per test to avoid cross-test collisions.
// ---------------------------------------------------------------------------

let prSeq = 0;

async function seedRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
): Promise<{ repoId: string; prId: string }> {
  const suffix = `${Date.now()}-${prSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name: `intent-test-${suffix}`, fullName: `acme/intent-test-${suffix}` })
    .returning();

  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 10,
      deletions: 2,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();

  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/middleware/ratelimit.ts',
    additions: 10,
    deletions: 2,
    patch: '@@ -1,5 +1,15 @@\n export const limit = 100;\n+export function rateLimit() {}',
  });

  return { repoId: repo!.id, prId: pr!.id };
}

// ---------------------------------------------------------------------------
// Suite: Repository-level upsert (R4 + R5)
// ---------------------------------------------------------------------------

d('intent: repository upsert (R4 + R5) — Testcontainers pg', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repo: ReviewRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    repo = new ReviewRepository(pg.handle.db);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('should persist an intent and retrieve it via getIntent (R4)', async () => {
    const { prId } = await seedRepoAndPr(pg.handle.db, workspaceId);

    // Nothing stored yet.
    const before = await repo.getIntent(prId);
    expect(before).toBeUndefined();

    // Persist.
    await repo.upsertIntent(prId, INTENT_V1);

    // getIntent returns the stored shape.
    const stored = await repo.getIntent(prId);
    expect(stored).toEqual(INTENT_V1);
  });

  it('should update the pr_intent row IN PLACE on a second upsert — no duplicates (R5)', async () => {
    const { prId } = await seedRepoAndPr(pg.handle.db, workspaceId);

    // First derivation.
    await repo.upsertIntent(prId, INTENT_V1);

    // Second derivation with different content (simulates manual recompute).
    await repo.upsertIntent(prId, INTENT_V2);

    // Exactly one row exists.
    const rows = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, prId));
    expect(rows).toHaveLength(1);

    // The row reflects the SECOND derivation.
    const stored = await repo.getIntent(prId);
    expect(stored?.intent).toBe(INTENT_V2.intent);
    expect(stored?.in_scope).toEqual(INTENT_V2.in_scope);
    expect(stored?.out_of_scope).toEqual(INTENT_V2.out_of_scope);
  });
});

// ---------------------------------------------------------------------------
// Suite: Service-level recomputeIntent (R4 + R5 end-to-end)
// ---------------------------------------------------------------------------

d('intent: service.recomputeIntent (R4 + R5) — Testcontainers pg', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * Build an app that injects:
   *   - `MockLLMProvider` for openrouter (the default provider for review_intent)
   *   - `MockGitClient` (returns a minimal unified diff from pr_files)
   *   - `MockEmbedder` (in case embeddings path is triggered)
   *
   * The mock LLM returns `intentFixture` as the structured output.
   */
  function appWith(intentFixture: Intent) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { Intent: intentFixture },
          }),
        },
      },
    });
  }

  it('recomputeIntent persists the intent and getIntent returns it (R4)', async () => {
    const { prId } = await seedRepoAndPr(pg.handle.db, workspaceId);
    const app = await appWith(INTENT_V1);

    const service = new ReviewService(app.container);

    // No intent yet.
    const { intent: before } = await service.getIntent(workspaceId, prId);
    expect(before).toBeNull();

    // Derive and persist.
    const result = await service.recomputeIntent(workspaceId, prId);
    expect(result.intent.intent).toBe(INTENT_V1.intent);
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('deepseek/deepseek-v4-flash');
    expect(result.tokensIn).toBeGreaterThanOrEqual(0);
    expect(result.tokensOut).toBeGreaterThanOrEqual(0);

    // getIntent returns the persisted intent.
    const { intent: after } = await service.getIntent(workspaceId, prId);
    expect(after?.intent).toBe(INTENT_V1.intent);
    expect(after?.in_scope).toEqual(INTENT_V1.in_scope);
    expect(after?.out_of_scope).toEqual(INTENT_V1.out_of_scope);

    await app.close();
  });

  it('recomputeIntent called twice updates the row in place — one row, latest values (R5)', async () => {
    const { prId } = await seedRepoAndPr(pg.handle.db, workspaceId);

    // First call → INTENT_V1.
    const app1 = await appWith(INTENT_V1);
    const service1 = new ReviewService(app1.container);
    await service1.recomputeIntent(workspaceId, prId);
    await app1.close();

    // Second call → INTENT_V2 (different content, simulates the PR changing).
    const app2 = await appWith(INTENT_V2);
    const service2 = new ReviewService(app2.container);
    const result = await service2.recomputeIntent(workspaceId, prId);
    await app2.close();

    // Exactly one row in pr_intent.
    const rows = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, prId));
    expect(rows).toHaveLength(1);

    // The row reflects the SECOND derivation.
    expect(result.intent.intent).toBe(INTENT_V2.intent);
    const { intent: stored } = await new ReviewService(
      (await appWith(INTENT_V2)).container,
    ).getIntent(workspaceId, prId);
    expect(stored?.intent).toBe(INTENT_V2.intent);
    expect(stored?.in_scope).toEqual(INTENT_V2.in_scope);
  });

  it('getIntent returns intent: null when no intent has been derived (R4 empty state)', async () => {
    const { prId } = await seedRepoAndPr(pg.handle.db, workspaceId);
    const app = await appWith(INTENT_V1);
    const service = new ReviewService(app.container);

    const { intent } = await service.getIntent(workspaceId, prId);
    expect(intent).toBeNull();

    await app.close();
  });
});
