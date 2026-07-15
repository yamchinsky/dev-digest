import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import type { AgentPerf, AgentStats } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-performance] Docker not available — skipping integration tests.');
}

/**
 * Agent Performance aggregation — the global dashboard (`GET /agents/performance`)
 * and the per-agent Stats tab (`GET /agents/:id/stats`) share ONE service
 * aggregation, so their numbers must reconcile exactly for the same agent+window.
 * We seed deterministic runs + findings (no network, so PriceBook uses its static
 * fallback → stable costs) and assert: cost breakdowns sum to the headline total,
 * avg = total/runs, accept_rate = accepted/(accepted+dismissed), the dashboard row
 * equals the Stats endpoint, zero-run agents still appear, and the default sort is
 * accept-rate descending.
 */
d('Agent Performance: dashboard ⇄ per-agent Stats reconcile', () => {
  let pg: PgFixture;
  let wsId: string;
  let prId: string;
  let agentA: string; // gets runs + findings (2 accepted, 1 dismissed)
  let agentB: string; // no runs → must still appear as a zero row

  // gpt-4.1 fallback price: in 2.0, out 8.0 (USD / 1M tokens).
  // Per run: (1000*2.0 + 500*8.0)/1e6 = 0.006 USD. Three runs → 0.018 total.
  const TOKENS_IN = 1000;
  const TOKENS_OUT = 500;
  const PER_RUN_COST = (TOKENS_IN * 2.0 + TOKENS_OUT * 8.0) / 1_000_000;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;

    const [ws] = await db.select().from(t.workspaces);
    wsId = ws!.id;
    const [pr] = await db.select().from(t.pullRequests);
    prId = pr!.id;
    const agents = await db.select().from(t.agents).where(eq(t.agents.workspaceId, wsId));
    agentA = agents[0]!.id;
    agentB = agents[1]!.id;

    // Three done runs for agentA within the default 30d window.
    const runs = await db
      .insert(t.agentRuns)
      .values(
        [2, 0, 3].map((findingsCount) => ({
          workspaceId: wsId,
          agentId: agentA,
          prId,
          provider: 'openai',
          model: 'gpt-4.1',
          durationMs: 6200,
          tokensIn: TOKENS_IN,
          tokensOut: TOKENS_OUT,
          status: 'done',
          findingsCount,
        })),
      )
      .returning();

    // One review for agentA with findings: 2 accepted, 1 dismissed, 2 pending.
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId: wsId,
        prId,
        agentId: agentA,
        runId: runs[0]!.id,
        kind: 'review',
        model: 'gpt-4.1',
      })
      .returning();

    const now = new Date();
    const base = {
      reviewId: review!.id,
      file: 'src/x.ts',
      startLine: 1,
      endLine: 2,
      category: 'correctness',
      title: 'x',
      rationale: 'y',
      confidence: 0.9,
    };
    await db.insert(t.findings).values([
      { ...base, severity: 'CRITICAL', acceptedAt: now },
      { ...base, severity: 'WARNING', acceptedAt: now },
      { ...base, severity: 'WARNING', dismissedAt: now },
      { ...base, severity: 'SUGGESTION' }, // pending
      { ...base, severity: 'SUGGESTION' }, // pending
    ]);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  it('reconciles the dashboard row with the per-agent Stats endpoint', async () => {
    const app = await makeApp();

    const perfRes = await app.inject({ method: 'GET', url: '/agents/performance' });
    expect(perfRes.statusCode).toBe(200);
    const perf = perfRes.json() as AgentPerf;

    const statsRes = await app.inject({ method: 'GET', url: `/agents/${agentA}/stats` });
    expect(statsRes.statusCode).toBe(200);
    const stats = statsRes.json() as AgentStats;

    const rowA = perf.agents.find((r) => r.agent_id === agentA)!;
    expect(rowA).toBeTruthy();

    // Deterministic (price-independent) fields must be IDENTICAL across surfaces.
    expect(rowA.runs).toBe(3);
    expect(rowA.runs).toBe(stats.runs);
    expect(rowA.findings_total).toBe(5);
    expect(rowA.findings_total).toBe(stats.findings_total);
    expect(rowA.accepted).toBe(2);
    expect(rowA.accepted).toBe(stats.accepted);
    expect(rowA.dismissed).toBe(1);
    expect(rowA.dismissed).toBe(stats.dismissed);
    expect(stats.pending).toBe(2);
    expect(rowA.avg_latency_ms).toBe(6200);
    expect(rowA.avg_latency_ms).toBe(stats.avg_latency_ms);
    expect(rowA.findings_by_severity).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 2 });
    expect(rowA.findings_by_severity).toEqual(stats.findings_by_severity);

    // accept_rate = accepted / (accepted + dismissed) = 2/3.
    expect(rowA.accept_rate).toBeCloseTo(2 / 3, 6);
    expect(rowA.accept_rate).toBeCloseTo(stats.accept_rate!, 6);

    // Cost: avg = total / runs, and both endpoints agree (same PriceBook singleton).
    expect(rowA.total_cost_usd).toBeCloseTo(3 * PER_RUN_COST, 6);
    expect(rowA.avg_cost_usd).toBeCloseTo((3 * PER_RUN_COST) / 3, 6);
    expect(rowA.total_cost_usd).toBeCloseTo(stats.total_cost_usd!, 8);
    expect(rowA.avg_cost_usd).toBeCloseTo(stats.avg_cost_usd!, 8);

    await app.close();
  });

  it('cost breakdowns sum back to the headline total, and zero-run agents appear', async () => {
    const app = await makeApp();
    const perf = (await app.inject({ method: 'GET', url: '/agents/performance' })).json() as AgentPerf;

    const sumByAgent = perf.cost_by_agent.reduce((s, seg) => s + seg.value, 0);
    const sumByModel = perf.cost_by_model.reduce((s, seg) => s + seg.value, 0);
    expect(sumByAgent).toBeCloseTo(perf.summary.total_cost_usd!, 8);
    expect(sumByModel).toBeCloseTo(perf.summary.total_cost_usd!, 8);

    // most-active = the agent with the most runs.
    expect(perf.summary.runs).toBe(3);
    expect(perf.summary.most_active_agent).toBe(
      perf.agents.find((r) => r.agent_id === agentA)!.agent_name,
    );

    // agentB has no runs but must still be listed as a zero row.
    const rowB = perf.agents.find((r) => r.agent_id === agentB)!;
    expect(rowB).toBeTruthy();
    expect(rowB.runs).toBe(0);
    expect(rowB.accept_rate).toBeNull();

    // Default sort: accept-rate descending, nulls last.
    const rates = perf.agents.map((r) => r.accept_rate);
    const firstNull = rates.indexOf(null);
    const defined = (firstNull === -1 ? rates : rates.slice(0, firstNull)) as number[];
    const sorted = [...defined].sort((a, b) => b - a);
    expect(defined).toEqual(sorted);
    if (firstNull !== -1) expect(rates.slice(firstNull).every((r) => r === null)).toBe(true);

    await app.close();
  });
});
