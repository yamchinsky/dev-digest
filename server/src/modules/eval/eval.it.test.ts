/**
 * Integration tests — Eval module (SPEC-04).
 *
 * Requires Docker (testcontainers Postgres). Skips cleanly when Docker is absent.
 *
 * Coverage:
 *   AC-1/2  — 201 + correct expectation type for accepted/dismissed findings
 *   AC-3    — undecided finding → 422
 *   AC-4    — null-agent review without body agent_id → 422
 *   AC-5    — no diff available → 422
 *   AC-9    — start_line > end_line on manual case create → 422
 *   AC-12   — startBatch returns 202 + running + snapshotted system_prompt
 *   AC-13   — zero cases for agent → 422
 *   AC-14   — engine throw on a case → pass=false run row, batch done
 *   AC-15   — unknown provider → batch failed, zero run rows
 *   AC-16   — reaper flips running → failed 'orphaned by restart'
 *   AC-17   — completed batch has non-null recall/precision/citation_accuracy/cost_usd
 *   AC-23   — single-case run not in GET /agents/:id/eval-runs
 *   AC-30   — mock LLM captures messages; diff wrapped in <untrusted>, INJECTION_GUARD in system
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import {
  MockLLMProvider,
  MockGitClient,
  MockSecretsProvider,
} from '../../adapters/mocks.js';
import { INJECTION_GUARD } from '@devdigest/reviewer-core';
import { EvalService } from './service.js';
import { EvalRepository } from './repository.js';
import type { Db } from '../../db/client.js';
import type { EvalRunBatchRow } from './repository.js';

// ---------------------------------------------------------------------------
// Docker gate
// ---------------------------------------------------------------------------

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval.it] Docker not available — skipping testcontainers integration tests.');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A valid Review fixture that satisfies the Review Zod schema. No findings → grounding passes trivially. */
const VALID_REVIEW_FIXTURE = {
  verdict: 'comment',
  summary: 'No critical issues detected.',
  score: 92,
  findings: [],
};

/** A Review fixture that raises one finding at src/config.ts:11. Used in must_find tests. */
const REVIEW_WITH_FINDING = {
  verdict: 'request_changes',
  summary: 'Secret detected.',
  score: 30,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'Stripe key is committed in plaintext.',
      suggestion: 'Move to env var.',
      confidence: 0.99,
    },
  ],
};

// ---------------------------------------------------------------------------
// Poll helper — wait for a batch to leave 'running'
// ---------------------------------------------------------------------------

async function pollBatch(db: Db, batchId: string, timeoutMs = 20_000): Promise<EvalRunBatchRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.id, batchId));
    if (row && row.status !== 'running') return row;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Batch ${batchId} did not finish within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

d('EvalService integration (Docker required)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;
  let agentSystemPrompt: string;

  let prId: string;
  let repoId: string;

  // Shared mock LLM — we swap `.opts.structured` per-test via per-test MockLLMProvider instances.
  // The main app uses `mainMockLLM` which returns VALID_REVIEW_FIXTURE.
  let mainMockLLM: MockLLMProvider;

  // The main Fastify app under test
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Awaited<ReturnType<typeof buildApp>>;

  // A second app for the "empty git diff" scenario (AC-5)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let noGitApp: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    const db = pg.handle.db;

    // Grab the default workspace
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;

    // Grab the first seeded agent (General Reviewer, provider=openrouter)
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId))
      .limit(1);
    agentId = agent!.id;
    agentSystemPrompt = agent!.systemPrompt;

    // Grab the seeded repo and PR
    const [repo] = await db
      .select()
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId))
      .limit(1);
    repoId = repo!.id;

    const [pr] = await db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repoId))
      .limit(1);
    prId = pr!.id;

    // Seed a pr_files row with a valid patch so the fallback diff path has data
    await db.insert(t.prFiles).values({
      prId,
      path: 'src/config.ts',
      additions: 2,
      deletions: 0,
      patch:
        '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

    mainMockLLM = new MockLLMProvider('openai', { structured: VALID_REVIEW_FIXTURE });

    // Main app: openrouter mocked, git returns default diff
    app = await buildApp({
      config,
      db,
      overrides: {
        secrets: new MockSecretsProvider({}), // no real API keys
        llm: { openrouter: mainMockLLM },
        git: new MockGitClient(),
      },
    });

    // noGitApp: openrouter mocked, git returns empty diff (for AC-5)
    noGitApp = await buildApp({
      config,
      db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        llm: { openrouter: mainMockLLM },
        git: new MockGitClient({ diff: '' }), // empty diff → 0 files
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await noGitApp?.close();
    await pg?.stop();
  });

  // -------------------------------------------------------------------------
  // AC-9: start_line > end_line on POST /eval-cases → 422
  // -------------------------------------------------------------------------
  it('AC-9: POST /eval-cases with end_line < start_line returns 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'agent',
        owner_id: agentId,
        name: 'Bad lines case',
        input_diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n+line',
        expected_output: {
          type: 'must_find',
          file: 'src/foo.ts',
          start_line: 10,
          end_line: 5, // < start_line → should fail
        },
      },
    });

    expect(res.statusCode).toBe(422);
  });

  // -------------------------------------------------------------------------
  // AC-13: POST /agents/:id/eval-runs with zero cases → 422
  // -------------------------------------------------------------------------
  it('AC-13: POST /agents/:id/eval-runs with no cases returns 422', async () => {
    // Create a fresh agent with no eval cases
    const [newAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Eval-less Agent',
        description: 'Has no eval cases.',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt: 'You are a test reviewer.',
        enabled: true,
        version: 1,
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${newAgent!.id}/eval-runs`,
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.message).toMatch(/No eval cases/i);
  });

  // -------------------------------------------------------------------------
  // AC-3: undecided finding (no acceptedAt/dismissedAt) → 422
  // -------------------------------------------------------------------------
  it('AC-3: POST /findings/:id/eval-case with undecided finding returns 422', async () => {
    // Insert a review with agentId
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, kind: 'review', agentId, verdict: 'comment', summary: 'test' })
      .returning();

    // Finding with NO decision
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Undecided finding',
        rationale: 'test rationale',
        confidence: 0.9,
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/findings/${finding!.id}/eval-case`,
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/no decision/i);
  });

  // -------------------------------------------------------------------------
  // AC-4: null-agent review without body agent_id → 422
  // -------------------------------------------------------------------------
  it('AC-4: POST /findings/:id/eval-case with null-agent review and no body agent_id → 422', async () => {
    // Insert a review WITHOUT agentId (agentId is null)
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        kind: 'review',
        agentId: null,
        verdict: 'comment',
        summary: 'null agent review',
      })
      .returning();

    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Finding with null agent',
        rationale: 'rationale',
        confidence: 0.9,
        acceptedAt: new Date(), // has decision
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/findings/${finding!.id}/eval-case`,
      payload: {}, // no agent_id override
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/agent required/i);
  });

  // -------------------------------------------------------------------------
  // AC-1: accepted finding → must_find expectation
  // -------------------------------------------------------------------------
  it('AC-1: POST /findings/:id/eval-case with accepted finding creates must_find case', async () => {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, kind: 'review', agentId, verdict: 'comment', summary: 'test' })
      .returning();

    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'AC-1 accepted finding',
        rationale: 'test rationale',
        confidence: 0.95,
        acceptedAt: new Date(), // accepted → must_find
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/findings/${finding!.id}/eval-case`,
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.expected_output.type).toBe('must_find');
    expect(body.expected_output.source_finding_id).toBe(finding!.id);
    expect(body.owner_kind).toBe('agent');
    expect(body.owner_id).toBe(agentId);
  });

  // -------------------------------------------------------------------------
  // AC-2: dismissed finding → must_not_flag expectation
  // -------------------------------------------------------------------------
  it('AC-2: POST /findings/:id/eval-case with dismissed finding creates must_not_flag case', async () => {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, kind: 'review', agentId, verdict: 'comment', summary: 'test' })
      .returning();

    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'WARNING',
        category: 'perf',
        title: 'AC-2 dismissed finding',
        rationale: 'test rationale',
        confidence: 0.7,
        dismissedAt: new Date(), // dismissed → must_not_flag
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/findings/${finding!.id}/eval-case`,
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.expected_output.type).toBe('must_not_flag');
    expect(body.expected_output.source_finding_id).toBe(finding!.id);
  });

  // -------------------------------------------------------------------------
  // AC-5: no diff available (empty git diff + no usable pr_files patches) → 422
  // -------------------------------------------------------------------------
  it('AC-5: POST /findings/:id/eval-case with no diff available returns 422', async () => {
    // Insert a fresh PR with no pr_files
    const [freshPr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 9990,
        title: 'No diff PR',
        author: 'tester',
        branch: 'feat/no-diff',
        base: 'main',
        headSha: 'deadbeef',
        additions: 0,
        deletions: 0,
        filesCount: 0,
        status: 'needs_review',
      })
      .returning();

    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: freshPr!.id,
        kind: 'review',
        agentId,
        verdict: 'comment',
        summary: 'test',
      })
      .returning();

    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 1,
        endLine: 1,
        severity: 'CRITICAL',
        category: 'security',
        title: 'AC-5 finding',
        rationale: 'test',
        confidence: 0.9,
        acceptedAt: new Date(),
      })
      .returning();

    // noGitApp has MockGitClient({ diff: '' }) → 0 files → falls back to pr_files
    // freshPr has no pr_files → no patches → ValidationError
    const res = await noGitApp.inject({
      method: 'POST',
      url: `/findings/${finding!.id}/eval-case`,
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/diff unavailable/i);
  });

  // -------------------------------------------------------------------------
  // AC-12: POST /agents/:id/eval-runs → 202, status=running, system_prompt snapshotted
  // -------------------------------------------------------------------------
  it('AC-12: POST /agents/:id/eval-runs returns 202 with running batch and snapshotted system_prompt', async () => {
    // Seed an eval case for the agent
    await pg.handle.db.insert(t.evalCases).values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'AC-12 eval case',
      inputDiff:
        'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
      expectedOutput: {
        type: 'must_not_flag',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-runs`,
      payload: {},
    });

    expect(res.statusCode).toBe(202);
    const batch = res.json();
    expect(batch.status).toBe('running');
    expect(batch.system_prompt).toBe(agentSystemPrompt);
    expect(batch.agent_id).toBe(agentId);
    expect(typeof batch.id).toBe('string');

    // Poll until done so subsequent tests don't have leftover running batches
    await pollBatch(pg.handle.db, batch.id);
  });

  // -------------------------------------------------------------------------
  // AC-17: completed batch has non-null metrics + cost_usd
  // -------------------------------------------------------------------------
  it('AC-17: completed batch has non-null recall, precision, citation_accuracy, cost_usd', async () => {
    // Seed an eval case that is a must_not_flag (VALID_REVIEW_FIXTURE has no findings → pass=true)
    const [evalCase] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: 'AC-17 must_not_flag case',
        inputDiff:
          'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
        expectedOutput: {
          type: 'must_not_flag',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
        },
      })
      .returning();

    void evalCase; // only needed for setup

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-runs`,
      payload: {},
    });

    expect(res.statusCode).toBe(202);
    const batchId = res.json().id as string;

    // Wait for the batch to complete
    const completed = await pollBatch(pg.handle.db, batchId);

    expect(completed.status).toBe('done');
    expect(completed.recall).not.toBeNull();
    expect(completed.precision).not.toBeNull();
    expect(completed.citationAccuracy).not.toBeNull();
    expect(completed.casesPassed).toBeGreaterThanOrEqual(0);
    // MockLLMProvider returns costUsd=0.001 per call; the batch should aggregate it
    expect(completed.costUsd).not.toBeNull();
    expect(completed.finishedAt).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // AC-14: engine throws on one case → pass=false row + batch done
  // -------------------------------------------------------------------------
  it('AC-14: engine error on a case produces pass=false run row, batch still completes', async () => {
    // MockLLMProvider that throws for Review schema calls (invalid fixture)
    const throwingLLM = new MockLLMProvider('openai', {
      structuredBySchema: { Review: null }, // null → fails Review schema → throws
    });

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const throwApp = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        llm: { openrouter: throwingLLM },
        git: new MockGitClient(),
      },
    });

    try {
      // Insert a fresh agent + eval case
      const [throwAgent] = await pg.handle.db
        .insert(t.agents)
        .values({
          workspaceId,
          name: 'Throw Agent',
          description: 'For AC-14 test.',
          provider: 'openrouter',
          model: 'deepseek/deepseek-v4-flash',
          systemPrompt: 'You are a reviewer.',
          enabled: true,
          version: 1,
        })
        .returning();

      await pg.handle.db.insert(t.evalCases).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: throwAgent!.id,
        name: 'AC-14 case',
        inputDiff:
          'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
        expectedOutput: {
          type: 'must_not_flag',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
        },
      });

      const res = await throwApp.inject({
        method: 'POST',
        url: `/agents/${throwAgent!.id}/eval-runs`,
        payload: {},
      });
      expect(res.statusCode).toBe(202);
      const batchId = res.json().id as string;

      // Wait for completion
      const completed = await pollBatch(pg.handle.db, batchId);

      // Batch should finish (not stuck in running) — either done or failed
      // The per-case error is caught; the batch executor should still reach 'done'
      expect(completed.status).toBe('done');

      // Verify the run row for this case has pass=false
      const runs = await pg.handle.db
        .select()
        .from(t.evalRuns)
        .where(eq(t.evalRuns.batchId, batchId));

      expect(runs.length).toBeGreaterThanOrEqual(1);
      const failedRun = runs.find((r) => r.pass === false);
      expect(failedRun).toBeDefined();
    } finally {
      await throwApp.close();
    }
  });

  // -------------------------------------------------------------------------
  // AC-15: unknown provider → batch failed, zero run rows
  // -------------------------------------------------------------------------
  it('AC-15: unknown/unconfigured provider → batch immediately failed, zero run rows', async () => {
    // Create an agent with provider='openai' (no openai mock → ConfigError)
    const [openaiAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'OpenAI Agent',
        description: 'Uses openai provider.',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are a reviewer.',
        enabled: true,
        version: 1,
      })
      .returning();

    // Seed one case so the "no cases" check passes
    await pg.handle.db.insert(t.evalCases).values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: openaiAgent!.id,
      name: 'AC-15 case',
      inputDiff:
        'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1,2 @@\n+added',
      expectedOutput: {
        type: 'must_not_flag',
        file: 'src/x.ts',
        start_line: 1,
        end_line: 1,
      },
    });

    // main app has secrets = MockSecretsProvider({}) → no OPENAI_API_KEY → ConfigError
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${openaiAgent!.id}/eval-runs`,
      payload: {},
    });

    // The route always returns 202 for validation-passing requests
    expect(res.statusCode).toBe(202);
    const batch = res.json();

    // The batch should be immediately marked failed (ConfigError caught synchronously)
    expect(batch.status).toBe('failed');
    expect(batch.error).toBeTruthy();

    // Zero run rows must exist for this batch
    const runs = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.batchId, batch.id));
    expect(runs.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // AC-16: reaper flips running → failed 'orphaned by restart'
  // -------------------------------------------------------------------------
  it('AC-16: reapStaleBatches flips running batches to failed with orphaned error', async () => {
    // Insert a batch directly with status='running' (simulates an orphaned batch)
    const [orphanBatch] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({
        workspaceId,
        agentId,
        status: 'running',
        systemPrompt: 'test',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        strategy: 'auto',
        casesTotal: 1,
      })
      .returning();

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const container = new (await import('../../platform/container.js')).Container(
      config,
      pg.handle.db,
      {
        secrets: new MockSecretsProvider({}),
      },
    );
    const service = new EvalService(container);
    const reaped = await service.reapStaleBatches();

    expect(reaped).toBeGreaterThanOrEqual(1);

    // Verify the batch is now failed with the 'orphaned by restart' error
    const [updated] = await pg.handle.db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.id, orphanBatch!.id));

    expect(updated!.status).toBe('failed');
    expect(updated!.error).toBe('orphaned by restart');
  });

  // -------------------------------------------------------------------------
  // AC-23: single-case run (POST /eval-cases/:id/run) NOT in GET /agents/:id/eval-runs
  // -------------------------------------------------------------------------
  it('AC-23: single-case run result is absent from GET /agents/:id/eval-runs batch list', async () => {
    // Create a dedicated agent + eval case for this test
    const [scAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Single Case Agent',
        description: 'For AC-23.',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt: 'You are a reviewer.',
        enabled: true,
        version: 1,
      })
      .returning();

    const [scCase] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: scAgent!.id,
        name: 'AC-23 single run case',
        inputDiff:
          'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
        expectedOutput: {
          type: 'must_not_flag',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
        },
      })
      .returning();

    // Run a single case
    const runRes = await app.inject({
      method: 'POST',
      url: `/eval-cases/${scCase!.id}/run`,
      payload: {},
    });
    expect(runRes.statusCode).toBe(200);
    const runResult = runRes.json();
    expect(runResult.run_id).toBeTruthy();

    // The run row should exist with batchId=null
    const [runRow] = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.id, runResult.run_id));
    expect(runRow!.batchId).toBeNull();

    // GET /agents/:id/eval-runs must NOT include this run (it has no batch_id)
    const listRes = await app.inject({
      method: 'GET',
      url: `/agents/${scAgent!.id}/eval-runs`,
    });
    expect(listRes.statusCode).toBe(200);
    const batches = listRes.json() as unknown[];
    // No batch rows exist for this agent (only the single run, which has batchId=null)
    expect(batches.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // AC-30: prompt injection hardening — diff wrapped in <untrusted>, INJECTION_GUARD in system
  // -------------------------------------------------------------------------
  it('AC-30: LLM messages contain <untrusted> wrapper around diff and INJECTION_GUARD sentinel', async () => {
    // Create a dedicated agent + eval case so we can inspect exact LLM calls
    const capturingLLM = new MockLLMProvider('openai', { structured: VALID_REVIEW_FIXTURE });

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const captureApp = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        llm: { openrouter: capturingLLM },
        git: new MockGitClient(),
      },
    });

    try {
      const [ac30Agent] = await pg.handle.db
        .insert(t.agents)
        .values({
          workspaceId,
          name: 'AC-30 Agent',
          description: 'For injection guard test.',
          provider: 'openrouter',
          model: 'deepseek/deepseek-v4-flash',
          systemPrompt: 'You are a security reviewer.',
          enabled: true,
          version: 1,
        })
        .returning();

      await pg.handle.db.insert(t.evalCases).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: ac30Agent!.id,
        name: 'AC-30 injection test case',
        inputDiff:
          'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
        expectedOutput: {
          type: 'must_not_flag',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
        },
      });

      const res = await captureApp.inject({
        method: 'POST',
        url: `/agents/${ac30Agent!.id}/eval-runs`,
        payload: {},
      });
      expect(res.statusCode).toBe(202);
      const batchId = res.json().id as string;

      // Wait for the batch to complete so LLM calls are recorded
      await pollBatch(pg.handle.db, batchId);

      // Find the Review-schema call in capturingLLM.calls
      const reviewCall = capturingLLM.calls.find(
        (c) =>
          c.method === 'completeStructured' &&
          (c.req as { schemaName?: string }).schemaName === 'Review',
      );
      expect(reviewCall, 'capturingLLM must have received a Review call').toBeDefined();

      const messages = (reviewCall!.req as { messages: { role: string; content: string }[] })
        .messages;

      // System message must contain the INJECTION_GUARD sentinel (first segment is enough)
      const systemMsg = messages.find((m) => m.role === 'system');
      expect(systemMsg, 'System message must be present').toBeDefined();
      expect(systemMsg!.content).toContain(INJECTION_GUARD.slice(0, 40));

      // User message must wrap the diff in <untrusted ...> delimiters
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg, 'User message must be present').toBeDefined();
      expect(userMsg!.content).toContain('<untrusted');
      // Specifically, the diff section
      expect(userMsg!.content).toContain('Diff to review');
    } finally {
      await captureApp.close();
    }
  });

  // -------------------------------------------------------------------------
  // Sanity: GET /eval-runs/:id returns EvalBatchDetail with runs
  // -------------------------------------------------------------------------
  it('GET /eval-runs/:id returns EvalBatchDetail with run rows', async () => {
    // Seed a new case + run a batch
    const [batchCase] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: 'detail-check case',
        inputDiff:
          'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
        expectedOutput: {
          type: 'must_not_flag',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
        },
      })
      .returning();

    void batchCase; // used implicitly

    const startRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-runs`,
      payload: {},
    });
    expect(startRes.statusCode).toBe(202);
    const batchId = startRes.json().id as string;

    await pollBatch(pg.handle.db, batchId);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/eval-runs/${batchId}`,
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.batch.id).toBe(batchId);
    expect(Array.isArray(detail.runs)).toBe(true);
    expect(detail.runs.length).toBeGreaterThanOrEqual(1);
  });
});
