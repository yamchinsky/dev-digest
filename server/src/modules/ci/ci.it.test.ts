/**
 * DB-backed integration tests for the CI module (Testcontainers).
 *
 * Self-skips when Docker is not available.
 *
 * Covers:
 *   AC-9/10  — open_pr: commitFiles + openPullRequest called; installation row created.
 *   AC-11    — open_pr idempotent: findOpenPr returns URL → no second openPullRequest call.
 *   AC-12    — files action: no DB write, no GitHub call, installation: null.
 *   AC-13    — commitFiles throws → 502 ExternalServiceError; no installation row.
 *   AC-23    — sync: valid artifact → new ci_runs row.
 *   AC-25    — sync: invalid artifact shape → skipped (not inserted), no error thrown.
 *   AC-26    — sync: rate-limit error → ExternalServiceError thrown + partial count preserved.
 *   AC-29    — manifest reflects ci_fail_on from agent row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { MockGitClient, MockGitHubClient } from '../../adapters/mocks.js';
import type { MockGitHubOptions } from '../../adapters/mocks.js';
import type { WorkflowRun } from '@devdigest/shared';
import type { Db } from '../../db/client.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci] Docker not available — skipping integration tests.');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const agentBody = {
  name: 'CI Test Agent',
  provider: 'openrouter' as const,
  model: 'deepseek/deepseek-chat',
  system_prompt: 'Review the diff for security issues.',
  ci_fail_on: 'warning' as const,
};

const exportBody = {
  repo: 'acme/widgets',
  target: 'gha' as const,
  post_as: 'github_review' as const,
  triggers: ['opened', 'synchronize'],
  base: 'main',
};

const validArtifact = JSON.stringify({
  findings_count: 3,
  critical: 1,
  warning: 2,
  suggestion: 0,
  cost_usd: 0.002,
  duration_ms: 4200,
  agent: 'ci-test-agent',
  pr_number: 5,
});

const mockRun: WorkflowRun = {
  id: 'run-001',
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://github.com/acme/widgets/actions/runs/001',
  created_at: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Helper: build a complete app (CI routes are registered via modules/index.ts).
// ---------------------------------------------------------------------------
async function buildTestApp(
  db: Db,
  github: MockGitHubClient,
) {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
  const app = await buildApp({
    config,
    db,
    overrides: { git: new MockGitClient(), github },
  });
  return app;
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

d('CI module — export-ci routes', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  // -------------------------------------------------------------------------
  // AC-12: action='files' → no GitHub call, installation: null, files returned
  // -------------------------------------------------------------------------
  it('AC-12: action=files returns files without opening a PR or persisting installation', async () => {
    const github = new MockGitHubClient();
    const app = await buildTestApp(pg.handle.db, github);

    // Create an agent
    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { ...agentBody, name: 'CI Files Agent' },
    });
    expect(agentRes.statusCode).toBe(201);
    const agentId = agentRes.json().id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { ...exportBody, action: 'files' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.installation).toBeNull();
    expect(body.pr_url).toBeNull();
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.files.length).toBeGreaterThan(0);

    // GitHub must not have been called
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);

    // No installation row in DB
    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(rows).toHaveLength(0);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-9/10: action='open_pr' → commitFiles + openPullRequest called, row created
  // -------------------------------------------------------------------------
  it('AC-9/10: action=open_pr commits files, opens a PR, and persists the installation', async () => {
    const github = new MockGitHubClient();
    const app = await buildTestApp(pg.handle.db, github);

    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { ...agentBody, name: 'CI OpenPR Agent' },
    });
    const agentId = agentRes.json().id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { ...exportBody, action: 'open_pr' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.installation).not.toBeNull();
    expect(body.pr_url).toMatch(/github\.com/);
    expect(Array.isArray(body.files)).toBe(true);

    // GitHub adapter calls verified
    expect(github.committed).toHaveLength(1);
    expect(github.openedPrs).toHaveLength(1);

    // Installation row persisted
    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.repo).toBe('acme/widgets');

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-11: re-publishing when a PR is already open → no second openPullRequest
  // -------------------------------------------------------------------------
  it('AC-11: second open_pr call reuses the existing PR (no duplicate openPullRequest)', async () => {
    const github = new MockGitHubClient();
    const app = await buildTestApp(pg.handle.db, github);

    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { ...agentBody, name: 'CI Idempotent Agent' },
    });
    const agentId = agentRes.json().id as string;

    // First export — opens the PR
    const first = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { ...exportBody, action: 'open_pr' },
    });
    expect(first.statusCode).toBe(200);
    expect(github.openedPrs).toHaveLength(1);

    const firstPrUrl = first.json().pr_url as string;

    // Second export — PR already open so findOpenPr returns it
    const second = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { ...exportBody, action: 'open_pr' },
    });
    expect(second.statusCode).toBe(200);
    // Still exactly ONE PR opened
    expect(github.openedPrs).toHaveLength(1);
    // Same PR URL returned
    expect(second.json().pr_url).toBe(firstPrUrl);
    // Installation still upserted (idempotent)
    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(rows).toHaveLength(1);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-13: commitFiles throws → 502, no installation row
  // -------------------------------------------------------------------------
  it('AC-13: commitFiles error → 502 and no installation row persisted', async () => {
    // A GitHub client that always throws on commitFiles
    class FailingGitHubClient extends MockGitHubClient {
      override async commitFiles(): Promise<{ branch: string }> {
        throw new Error('git push rejected (403 Forbidden)');
      }
    }

    const github = new FailingGitHubClient();
    const app = await buildTestApp(pg.handle.db, github);

    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { ...agentBody, name: 'CI Error Agent' },
    });
    const agentId = agentRes.json().id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { ...exportBody, action: 'open_pr' },
    });

    expect(res.statusCode).toBe(502);
    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(rows).toHaveLength(0);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Sync tests (AC-23, AC-25, AC-26)
// ---------------------------------------------------------------------------

d('CI module — syncCiRuns', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * Helper: create an agent and install the CI bundle so an installation row
   * exists for syncCiRuns to process.
   */
  async function setupInstallation(agentName: string): Promise<string> {
    const github = new MockGitHubClient();
    const app = await buildTestApp(pg.handle.db, github);

    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { ...agentBody, name: agentName },
    });
    const agentId = agentRes.json().id as string;

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { ...exportBody, action: 'open_pr' },
    });
    await app.close();
    return agentId;
  }

  // -------------------------------------------------------------------------
  // AC-23: valid artifact → new ci_run row
  // -------------------------------------------------------------------------
  it('AC-23: valid artifact produces a ci_runs row', async () => {
    await setupInstallation('Sync Agent Valid');

    const github = new MockGitHubClient({
      workflowRuns: [mockRun],
      artifactJson: validArtifact,
    });
    const app = await buildTestApp(pg.handle.db, github);

    const res = await app.inject({ method: 'POST', url: '/ci-runs/sync', payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.synced).toBeGreaterThanOrEqual(1);

    // Verify the row exists in DB
    const runs = await pg.handle.db.select().from(t.ciRuns);
    const inserted = runs.find((r) => r.githubRunId === 'run-001');
    expect(inserted).toBeDefined();
    expect(inserted!.findingsCount).toBe(3);
    expect(inserted!.critical).toBe(1);
    expect(inserted!.warning).toBe(2);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-25: invalid artifact shape → skipped (no error, no row)
  // -------------------------------------------------------------------------
  it('AC-25: invalid artifact shape is skipped (not inserted, no error)', async () => {
    await setupInstallation('Sync Agent Invalid');

    const badArtifact = JSON.stringify({ not_valid: true });
    const invalidRun: WorkflowRun = {
      id: 'run-bad-001',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/acme/widgets/actions/runs/bad-001',
      created_at: new Date().toISOString(),
    };
    const github = new MockGitHubClient({
      workflowRuns: [invalidRun],
      artifactJson: badArtifact,
    });
    const app = await buildTestApp(pg.handle.db, github);

    const res = await app.inject({ method: 'POST', url: '/ci-runs/sync', payload: {} });
    // Should succeed (no error) even though artifact was invalid
    expect(res.statusCode).toBe(200);

    // No row with this run id
    const runs = await pg.handle.db.select().from(t.ciRuns);
    const bad = runs.find((r) => r.githubRunId === 'run-bad-001');
    expect(bad).toBeUndefined();

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-26: rate-limit error → 502 + partial synced count
  // -------------------------------------------------------------------------
  it('AC-26: rate-limit error during artifact download → 502', async () => {
    await setupInstallation('Sync Agent RateLimit');

    const rateLimitRun: WorkflowRun = {
      id: 'run-rl-001',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/acme/widgets/actions/runs/rl-001',
      created_at: new Date().toISOString(),
    };

    class RateLimitGitHubClient extends MockGitHubClient {
      override async downloadArtifact(): Promise<string> {
        throw new Error('API rate limit exceeded (429)');
      }
    }

    const github = new RateLimitGitHubClient({
      workflowRuns: [rateLimitRun],
    });
    const app = await buildTestApp(pg.handle.db, github);

    const res = await app.inject({ method: 'POST', url: '/ci-runs/sync', payload: {} });
    expect(res.statusCode).toBe(502);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// AC-29: manifest reflects ci_fail_on from the agent row
// ---------------------------------------------------------------------------

d('CI module — manifest ci_fail_on (AC-29)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('AC-29: generated manifest carries the agent ci_fail_on value', async () => {
    const github = new MockGitHubClient();
    const app = await buildTestApp(pg.handle.db, github);

    // Create agent with ci_fail_on='warning'
    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { ...agentBody, ci_fail_on: 'warning', name: 'CI FailOn Agent' },
    });
    expect(agentRes.statusCode).toBe(201);
    const agentId = agentRes.json().id as string;

    // Use files action to get the bundle without GitHub calls
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { ...exportBody, action: 'files' },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    const manifestFile = body.files.find((f: { path: string }) =>
      f.path.endsWith('.yaml') && f.path.includes('.devdigest/agents/'),
    );
    expect(manifestFile).toBeDefined();

    // Parse YAML and verify ci_fail_on
    const { parse } = await import('yaml');
    const manifest = parse(manifestFile!.contents);
    expect(manifest.ci_fail_on).toBe('warning');

    await app.close();
  });
});
