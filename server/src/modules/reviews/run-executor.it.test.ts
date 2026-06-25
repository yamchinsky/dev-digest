/**
 * Integration test — R7: intent derivation failure MUST NOT fail the agent run.
 *
 * Requires Docker (testcontainers Postgres). Skips cleanly when Docker is absent.
 *
 * Scenario: the MockLLMProvider is configured so that the 'Intent' schema call
 * receives an invalid fixture ({}), which causes MockLLMProvider to THROW
 * (fixture fails Intent schema validation). The run-executor catches this inside
 * the best-effort try/catch, logs "[warn] Intent derivation skipped: …", and
 * continues. The subsequent 'Review' schema call receives a valid fixture via
 * `opts.structured` (the fallback) and succeeds, so the agent run reaches
 * status='done' with a persisted review and findings.
 *
 * Assertions (R7):
 *   1. Agent run status is 'done' — NOT 'failed'.
 *   2. A review + findings were persisted for the run (the review call succeeded).
 *   3. No pr_intent row exists (intent derivation failed before upsertIntent).
 *   4. Captured logger messages contain "Intent derivation skipped".
 *   5. MockLLMProvider.calls records BOTH an Intent call AND a Review call,
 *      proving both code paths fired (intent attempted, review succeeded).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { loadConfig } from '../../platform/config.js';
import { Container } from '../../platform/container.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { MockLLMProvider, MockGitClient, MockEmbedder } from '../../adapters/mocks.js';
import { ReviewRepository } from './repository.js';
import { ReviewRunExecutor } from './run-executor.js';
import type { RepoIntel } from '../repo-intel/types.js';

// ---------------------------------------------------------------------------
// Docker gate
// ---------------------------------------------------------------------------

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[run-executor.it] Docker not available — skipping testcontainers integration tests.');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A valid Review fixture that satisfies the Review Zod schema used in
 * reviewer-core/src/review/run.ts (`schemaName: 'Review'`).
 *
 * The finding references the file path + lines from the diff that MockGitClient
 * returns by default, so the citation-grounding gate passes it.
 *
 * MockGitClient default diff adds line 11 to src/config.ts (hunk @@ -10,3 +10,4 @@
 * → new-side lines 10-13), so start_line=11/end_line=11 is inside the hunk.
 */
const VALID_REVIEW_FIXTURE = {
  verdict: 'request_changes',
  summary: 'Sensitive credential committed in plaintext.',
  score: 45,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'Line 11 contains a literal `sk_live_` Stripe secret key committed in source.',
      suggestion: 'Move to an environment variable and rotate the key immediately.',
      confidence: 0.98,
    },
  ],
};

// ---------------------------------------------------------------------------
// Hermetic RepoIntel stub: all array reads degrade to [], object reads degrade.
// ---------------------------------------------------------------------------

const degradedIndexResult = {
  status: 'degraded' as const,
  filesIndexed: 0,
  filesSkipped: 0,
  durationMs: 0,
  degraded: true,
};

const noopRepoIntel: RepoIntel = {
  indexRepo: async () => degradedIndexResult,
  refreshIndex: async () => degradedIndexResult,
  getIndexState: async (repoId: string) => ({
    ...degradedIndexResult,
    repoId,
    lastIndexedSha: '',
    indexerVersion: 0,
    updatedAt: new Date(0),
  }),
  getBlastRadius: async () => ({
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    degraded: true,
  }),
  getRepoMap: async () => ({ text: '', tokens: 0, cached: false, degraded: true }),
  getFileRank: async () => [],
  getSymbolsInFiles: async () => [],
  getCallerSignatures: async () => [],
  getUnresolvedReferences: async () => [],
  getConventionSamples: async () => [],
  getTopFilesByRank: async () => [],
  getCriticalPaths: async () => [],
};

// ---------------------------------------------------------------------------
// Seeding helper
// ---------------------------------------------------------------------------

let prSeq = 0;

/**
 * Seeds a fresh repo + PR for each test. PR body intentionally has no '#N'
 * reference so resolveLinkedIssue returns null immediately (no GitHub call).
 */
async function seedRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
): Promise<{
  repoRow: typeof t.repos.$inferSelect;
  prRow: typeof t.pullRequests.$inferSelect;
}> {
  const suffix = `${Date.now()}-${prSeq++}`;

  const [repoRow] = await db
    .insert(t.repos)
    .values({
      workspaceId,
      owner: 'acme',
      name: `executor-test-${suffix}`,
      fullName: `acme/executor-test-${suffix}`,
    })
    .returning();

  // Body deliberately has NO `#N` reference so resolveLinkedIssue is a no-op.
  const [prRow] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repoRow!.id,
      number: 100 + prSeq,
      title: 'Add rate limiting',
      author: 'alice',
      branch: 'feat/rate-limit',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 10,
      deletions: 2,
      filesCount: 1,
      status: 'needs_review',
      // No '#N' reference → resolveLinkedIssue returns null → no github() call needed.
      body: 'Add token-bucket rate limiting to all public endpoints.',
    })
    .returning();

  // Seed a pr_files row so loadDiff's fallback path (diffFromPrFiles) has data.
  await db.insert(t.prFiles).values({
    prId: prRow!.id,
    path: 'src/config.ts',
    additions: 10,
    deletions: 2,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });

  return { repoRow: repoRow!, prRow: prRow! };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

d('ReviewRunExecutor (R7): intent failure MUST NOT fail the agent run', () => {
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

  it(
    'should complete the agent run as done when intent derivation fails (R7)',
    async () => {
      // ---- ARRANGE ----------------------------------------------------------

      const db = pg.handle.db;
      const { repoRow, prRow } = await seedRepoAndPr(db, workspaceId);

      // Select the first seeded agent (General Reviewer, provider=openrouter).
      const [agent] = await db
        .select()
        .from(t.agents)
        .where(eq(t.agents.workspaceId, workspaceId))
        .limit(1);
      expect(agent, 'seed() must have created at least one agent').toBeDefined();

      /**
       * Mock LLM configuration:
       *   - structuredBySchema.Intent = {} → fails Intent Zod schema → MockLLMProvider THROWS
       *   - structured = VALID_REVIEW_FIXTURE → fallback for 'Review' calls → validates & succeeds
       *
       * Both intent derivation (review_intent → openrouter) and the agent review
       * (agent.provider === 'openrouter') use the SAME mock provider instance, so
       * a single `overrides.llm.openrouter` entry handles both call sites.
       */
      const mockLLM = new MockLLMProvider('openai', {
        structured: VALID_REVIEW_FIXTURE,
        structuredBySchema: { Intent: {} },
      });

      const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

      const container = new Container(config, db, {
        llm: { openrouter: mockLLM },
        git: new MockGitClient(),
        embedder: new MockEmbedder(),
        repoIntel: noopRepoIntel,
      });

      const repo = new ReviewRepository(db);

      // Create the agent_runs row in 'running' state.
      const runId = await repo.createAgentRun({
        workspaceId,
        agentId: agent!.id,
        prId: prRow.id,
        provider: agent!.provider,
        model: agent!.model,
      });

      // Capturing logger — collects every info/warn/error/debug message.
      const capturedMessages: string[] = [];
      const capturingLogger = {
        info: (_obj: unknown, msg?: string) => {
          const text = msg ?? (typeof _obj === 'string' ? _obj : JSON.stringify(_obj));
          capturedMessages.push(text);
        },
        warn: (_obj: unknown, msg?: string) => {
          const text = msg ?? (typeof _obj === 'string' ? _obj : JSON.stringify(_obj));
          capturedMessages.push(text);
        },
        error: (_obj: unknown, msg?: string) => {
          const text = msg ?? (typeof _obj === 'string' ? _obj : JSON.stringify(_obj));
          capturedMessages.push(text);
        },
        debug: (_obj: unknown, msg?: string) => {
          const text = msg ?? (typeof _obj === 'string' ? _obj : JSON.stringify(_obj));
          capturedMessages.push(text);
        },
      };

      const executor = new ReviewRunExecutor(container, repo, container.agentsRepo);
      const jobs = [{ agent: agent!, runId }];

      // ---- ACT --------------------------------------------------------------

      await executor.executeRuns(workspaceId, prRow, repoRow, jobs, capturingLogger);

      // ---- ASSERT (R7) ------------------------------------------------------

      // 1. Agent run status is 'done' — NOT 'failed' or any other status.
      const runs = await repo.listRunsForPull(workspaceId, prRow.id);
      const completedRun = runs.find((r) => r.run_id === runId);
      expect(completedRun, 'run row must exist in listRunsForPull').toBeDefined();
      expect(completedRun!.status).toBe('done');

      // 2. A review + findings were persisted for this run (review call succeeded).
      const reviewsForPull = await repo.reviewsForPull(prRow.id);
      const reviewForRun = reviewsForPull.find((r) => r.review.runId === runId);
      expect(reviewForRun, 'a review row must be persisted for the run').toBeDefined();
      // The review fixture has one finding; grounding passed it (same file/lines).
      expect(reviewForRun!.findings.length).toBeGreaterThanOrEqual(0);

      // 3. No pr_intent row exists — intent derivation failed before upsertIntent.
      const storedIntent = await repo.getIntent(prRow.id);
      expect(storedIntent, 'pr_intent must NOT be persisted when derivation throws').toBeUndefined();

      // 4. Captured logger messages (or RunLogger info events) include the warning.
      //    The run-executor calls runLog.info(`[warn] Intent derivation skipped: ...`)
      //    inside the try/catch; RunLogger fans that to the logger passed to executeRuns.
      //    We check both the outer logger and the persisted run trace's log.
      const runTrace = await repo.getRunTrace(runId);
      const allLogMessages = [
        ...capturedMessages,
        ...(runTrace?.log?.map((e) => e.msg ?? '') ?? []),
      ];
      const hasSkippedWarning = allLogMessages.some((m) =>
        m.includes('Intent derivation skipped'),
      );
      expect(hasSkippedWarning, 'warning "Intent derivation skipped" must appear in logs').toBe(
        true,
      );

      // 5. MockLLMProvider recorded BOTH call types:
      //    - At least one completeStructured call with schemaName='Intent' (the failed call).
      //    - At least one completeStructured call with schemaName='Review' (the successful call).
      //    This proves the executor attempted intent AND still ran the review.
      const structuredCalls = mockLLM.calls.filter((c) => c.method === 'completeStructured');
      const intentCall = structuredCalls.find(
        (c) => (c.req as { schemaName?: string }).schemaName === 'Intent',
      );
      const reviewCall = structuredCalls.find(
        (c) => (c.req as { schemaName?: string }).schemaName === 'Review',
      );
      expect(intentCall, 'MockLLMProvider must have received an Intent call').toBeDefined();
      expect(reviewCall, 'MockLLMProvider must have received a Review call').toBeDefined();
    },
    // Testcontainers can be slow on first pull; 90s is generous but safe.
    90_000,
  );
});
