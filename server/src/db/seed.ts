import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { seedEvalCases } from './seed-eval-cases.js';
import { seedSkillBenchmark } from './seed-skill-benchmark.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Flags uncovered branches, missed edge cases, excessive mocking, and flake patterns in test changes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- A1 example skills + Test Quality Reviewer wiring -----------------
  // Seed 3 rubrics relevant to the TQR demo; the 4th (flake-patterns) is
  // imported via the UI in `docs/agent-prompts/skills/flake-patterns.md` so
  // the import-flow can be walked end-to-end on camera.
  const seedSkills: Array<typeof t.skills.$inferInsert> = [
    {
      workspaceId,
      name: 'branch-coverage-rubric',
      description:
        'For each new conditional branch in the diff (if/switch/early-return/throw), check that a test covers both sides. Flag the uncovered branch with file:line.',
      type: 'rubric',
      source: 'manual',
      body: `# Branch coverage

For every conditional branch added or modified in the diff, verify that at
least one test exercises EACH side:
- \`if (x)\` / \`else\`
- \`switch\` cases (including the default)
- early returns and \`throw\` statements
- optional chaining short-circuits (\`a?.b\`)
- ternaries (\`a ? b : c\`)

If a side has no covering test, flag the exact \`file:line\` of the unreached
branch. Bug-fix branches without a regression test are CRITICAL — without a
guard the fix rots on the next refactor.`,
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'corner-case-checklist',
      description:
        'For each new public function/handler, verify tests exercise common edge cases: empty/null/undefined, boundary numerics, unicode, large input.',
      type: 'rubric',
      source: 'manual',
      body: `# Corner case checklist

For every new public function, handler, hook, or route in the diff, ask:
- Empty / null / undefined / zero / negative / NaN
- Empty string vs whitespace-only string
- Boundary numerics: 0, 1, -1, MAX_SAFE_INTEGER
- Unicode / multibyte / RTL characters
- Very large input (long arrays, big strings) where complexity matters
- Concurrency: same input twice in flight, cancellation, retry
- Time: midnight rollover, DST, leap year

If a relevant edge case is unexercised, flag it specifically — not "more tests
needed". Cite which input shape would expose the gap.`,
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'mocking-discipline',
      description:
        'Mock only I/O boundaries (network, fs, time, randomness, LLM). Flag mocks that replace business logic or pre-bake outputs so the assertion is tautological.',
      type: 'convention',
      source: 'manual',
      body: `# Mocking discipline

Mocks belong at I/O boundaries: network, filesystem, time, randomness, LLM,
external APIs. Business logic — the thing the test claims to verify — must
NOT be mocked.

Flag the following:
- A function-under-test mocked away (its real behaviour never runs).
- A mock that pre-bakes the production code's output, making the assertion
  tautological ("returns 'ok'" → "expect 'ok'").
- A mock with no behaviour (\`vi.fn()\` returning undefined) used where the
  production code's branching depends on the return — the test passes by
  accident, not by design.
- DB code tested against a mocked Drizzle / query builder instead of
  testcontainers Postgres. Mock/prod divergence has burned this repo before.`,
      enabled: true,
      version: 1,
    },
  ];

  // Upsert skills (idempotent by name+workspace) and remember their ids.
  const skillIds: Record<string, string> = {};
  for (const sk of seedSkills) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, sk.name)));
    if (existing) {
      skillIds[sk.name] = existing.id;
    } else {
      const [row] = await db.insert(t.skills).values(sk).returning();
      if (row) {
        skillIds[sk.name] = row.id;
        await db
          .insert(t.skillVersions)
          .values({ skillId: row.id, version: 1, body: sk.body as string })
          .onConflictDoNothing();
      }
    }
  }

  // Link the three seeded skills to Test Quality Reviewer in a stable order
  // (idempotent: skipped when any link already exists for this agent).
  const [tqr] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Test Quality Reviewer')));
  if (tqr) {
    const existingLinks = await db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, tqr.id));
    if (existingLinks.length === 0) {
      const linkOrder = ['branch-coverage-rubric', 'corner-case-checklist', 'mocking-discipline'];
      const links = linkOrder
        .map((name, i) => ({ name, id: skillIds[name], order: i }))
        .filter((l): l is { name: string; id: string; order: number } => !!l.id)
        .map((l) => ({ agentId: tqr.id, skillId: l.id, order: l.order }));
      if (links.length > 0) await db.insert(t.agentSkills).values(links);
    }
  }

  // L06: five demo eval cases for the General Reviewer (idempotent by
  // (workspace_id, owner_id, name) — see seed-eval-cases.ts).
  await seedEvalCases(db);

  // L06: skill benchmark cases + one done run for the "Skill Editor · Evals"
  // tab (idempotent — see seed-skill-benchmark.ts).
  await seedSkillBenchmark(db);

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
