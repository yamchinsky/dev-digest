/**
 * Integration tests for smartDiffForPull (T6 / R3, R4) against a real
 * Postgres container. Requires Docker — skips cleanly when unavailable.
 *
 * Covers:
 *   R3 — smartDiffForPull reads getPrFiles + latest kind='review' findings,
 *        groups them correctly (lockfile in boilerplate, core src in core).
 *   R4 — The service is constructed with NO LLM override, proving the code
 *        path is token-free (no container.llm call, no reviewPullRequest).
 *        A kind:'summary' review seeded alongside a kind:'review' review
 *        MUST NOT be chosen — only the kind:'review' findings appear.
 *
 * Seeding approach: replicates the seedRepoAndPr pattern from intent.it.test.ts.
 * Each test gets a unique repo+PR pair (suffix = Date.now()+seq) to prevent
 * cross-test collisions. No transaction wrapping needed because data is
 * naturally isolated by repoId/prId.
 *
 * NOTE: If Docker is unavailable this suite prints a warning and all tests are
 * skipped. The file is still committed and runs in CI where Docker is available.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { ReviewService } from './service.js';

// ---------------------------------------------------------------------------
// Docker gate
// ---------------------------------------------------------------------------

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[smart-diff.it] Docker not available — skipping testcontainers integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

let prSeq = 0;

/**
 * Seeds a unique repo + PR for each test (suffix prevents cross-test collisions).
 * Returns the PR's numeric id for building the service call.
 */
async function seedRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
): Promise<{ repoId: string; prId: string }> {
  const suffix = `${Date.now()}-${prSeq++}`;

  const [repo] = await db
    .insert(t.repos)
    .values({
      workspaceId,
      owner: 'acme',
      name: `smart-diff-test-${suffix}`,
      fullName: `acme/smart-diff-test-${suffix}`,
    })
    .returning();

  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + prSeq,
      title: 'Smart diff test PR',
      author: 'alice',
      branch: 'feat/smart-diff',
      base: 'main',
      headSha: 'deadbeef',
      additions: 50,
      deletions: 10,
      filesCount: 3,
      status: 'needs_review',
      body: 'No issue reference.',
    })
    .returning();

  return { repoId: repo!.id, prId: pr!.id };
}

// ---------------------------------------------------------------------------
// Suite: smartDiffForPull — lockfile, core file, finding_lines, kind filter
// ---------------------------------------------------------------------------

d('smart-diff: smartDiffForPull — Testcontainers pg', () => {
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

  // ----------------------------------------------------------------
  // Helper: build the Fastify app WITHOUT any LLM override. Proving
  // smartDiffForPull is token-free means the app must not need an LLM
  // adapter to construct or to service the call.
  // ----------------------------------------------------------------
  async function buildNoLlmApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      // intentionally no llm override — R4: smartDiffForPull must not touch llm
    });
  }

  it('should place the lockfile in the boilerplate group and the core src file in the core group', async () => {
    const { prId } = await seedRepoAndPr(pg.handle.db, workspaceId);

    await pg.handle.db.insert(t.prFiles).values([
      { prId, path: 'pnpm-lock.yaml', additions: 5, deletions: 5 },
      { prId, path: 'src/service.ts', additions: 20, deletions: 5 },
    ]);

    const app = await buildNoLlmApp();
    const service = new ReviewService(app.container);

    const result = await service.smartDiffForPull(workspaceId, prId);

    await app.close();

    const roles = result.groups.map((g) => g.role);
    expect(roles).toContain('boilerplate');
    expect(roles).toContain('core');

    const boilerplate = result.groups.find((g) => g.role === 'boilerplate');
    expect(boilerplate?.files.map((f) => f.path)).toContain('pnpm-lock.yaml');

    const core = result.groups.find((g) => g.role === 'core');
    expect(core?.files.map((f) => f.path)).toContain('src/service.ts');
  });

  it('should populate finding_lines on the core file from the seeded kind:review findings', async () => {
    const { prId } = await seedRepoAndPr(pg.handle.db, workspaceId);

    // Seed two prFiles: one core, one lockfile
    await pg.handle.db.insert(t.prFiles).values([
      { prId, path: 'src/auth.ts', additions: 30, deletions: 5 },
      { prId, path: 'pnpm-lock.yaml', additions: 2, deletions: 2 },
    ]);

    // Seed a kind:'review' review with findings on the core file
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'Security issue found.',
        score: 40,
        model: 'test-model',
      })
      .returning();

    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/auth.ts',
        startLine: 42,
        endLine: 45,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Auth bypass',
        rationale: 'No check.',
        suggestion: 'Add a guard.',
        confidence: 0.95,
      },
      {
        reviewId: review!.id,
        file: 'src/auth.ts',
        startLine: 10,
        endLine: 12,
        severity: 'WARNING',
        category: 'correctness',
        title: 'Off-by-one',
        rationale: 'Range issue.',
        suggestion: 'Fix the boundary.',
        confidence: 0.80,
      },
    ]);

    const app = await buildNoLlmApp();
    const service = new ReviewService(app.container);

    const result = await service.smartDiffForPull(workspaceId, prId);

    await app.close();

    const core = result.groups.find((g) => g.role === 'core');
    const authFile = core?.files.find((f) => f.path === 'src/auth.ts');

    // finding_lines = deduped, sorted start_lines
    expect(authFile?.finding_lines).toEqual([10, 42]);

    // lockfile gets no finding_lines
    const boilerplate = result.groups.find((g) => g.role === 'boilerplate');
    const lockFile = boilerplate?.files.find((f) => f.path === 'pnpm-lock.yaml');
    expect(lockFile?.finding_lines).toEqual([]);
  });

  it('should choose the kind:review findings over kind:summary when both are present', async () => {
    const { prId } = await seedRepoAndPr(pg.handle.db, workspaceId);

    await pg.handle.db.insert(t.prFiles).values([
      { prId, path: 'src/payments.ts', additions: 50, deletions: 10 },
    ]);

    // First: seed a kind:'summary' review with findings on src/payments.ts
    const [summaryReview] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        kind: 'summary',
        verdict: 'approve',
        summary: 'Summary only.',
        score: 90,
        model: 'test-model',
      })
      .returning();

    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: summaryReview!.id,
        file: 'src/payments.ts',
        startLine: 999, // distinct line — if chosen, we'd see 999
        endLine: 999,
        severity: 'INFO',
        category: 'style',
        title: 'Summary finding',
        rationale: 'From summary review.',
        suggestion: 'Ignore.',
        confidence: 0.5,
      },
    ]);

    // Second: seed a kind:'review' review with findings on src/payments.ts
    const [reviewReview] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'Full review.',
        score: 60,
        model: 'test-model',
      })
      .returning();

    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: reviewReview!.id,
        file: 'src/payments.ts',
        startLine: 42, // expected line when kind:'review' wins
        endLine: 44,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Review finding',
        rationale: 'From full review.',
        suggestion: 'Fix it.',
        confidence: 0.95,
      },
    ]);

    const app = await buildNoLlmApp();
    const service = new ReviewService(app.container);

    const result = await service.smartDiffForPull(workspaceId, prId);

    await app.close();

    const core = result.groups.find((g) => g.role === 'core');
    const paymentsFile = core?.files.find((f) => f.path === 'src/payments.ts');

    // Must contain line 42 (from kind:'review') — NOT 999 (from kind:'summary')
    expect(paymentsFile?.finding_lines).toContain(42);
    expect(paymentsFile?.finding_lines).not.toContain(999);
  });

  it('should return an empty groups array when the PR has no prFiles', async () => {
    const { prId } = await seedRepoAndPr(pg.handle.db, workspaceId);
    // Deliberately insert no prFiles

    const app = await buildNoLlmApp();
    const service = new ReviewService(app.container);

    const result = await service.smartDiffForPull(workspaceId, prId);

    await app.close();

    expect(result.groups).toEqual([]);
    expect(result.split_suggestion.total_lines).toBe(0);
    expect(result.split_suggestion.too_big).toBe(false);
  });

  it('should return empty finding_lines when there are no reviews at all', async () => {
    const { prId } = await seedRepoAndPr(pg.handle.db, workspaceId);

    await pg.handle.db.insert(t.prFiles).values([
      { prId, path: 'src/feature.ts', additions: 20, deletions: 5 },
    ]);
    // No reviews inserted

    const app = await buildNoLlmApp();
    const service = new ReviewService(app.container);

    const result = await service.smartDiffForPull(workspaceId, prId);

    await app.close();

    const core = result.groups.find((g) => g.role === 'core');
    expect(core?.files[0]?.finding_lines).toEqual([]);
  });

  it('should throw NotFoundError when the PR does not exist', async () => {
    const nonExistentPrId = '00000000-0000-0000-0000-000000000000';

    const app = await buildNoLlmApp();
    const service = new ReviewService(app.container);

    await expect(service.smartDiffForPull(workspaceId, nonExistentPrId)).rejects.toMatchObject({
      code: 'not_found',
    });

    await app.close();
  });
});
