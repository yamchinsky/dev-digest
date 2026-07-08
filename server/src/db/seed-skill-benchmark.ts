import { type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import { DEFAULT_WORKSPACE_NAME } from './seed.js';
import type {
  SkillBenchmarkExpectation,
  SkillBenchmarkMetrics,
  SkillBenchmarkCaseDiff,
} from '@devdigest/shared';

/**
 * Seed the "Skill Editor · Evals" demo — a with_skill-vs-without_skill benchmark
 * for the seeded `branch-coverage-rubric` skill.
 *
 * Two things are seeded, both idempotently:
 *   1. Benchmark CASES — `eval_cases` rows with owner_kind='skill'. Each carries
 *      a diff + a set of aspects (literal patterns) a branch-coverage reviewer
 *      should surface. A LIVE run (POST /skills/:id/benchmarks) replays these
 *      through the model with and without the skill body.
 *   2. One DONE `skill_eval_runs` row with representative metrics, so the tab
 *      shows the design's summary + qualitative diff on a fresh DB even with no
 *      API key configured.
 *
 * Same pass rate ≠ same value: the seeded run mirrors the lesson — the skill
 * lifts quality and citation on the harder aspects, at ~2× the tokens/time.
 */

// Valid unified diffs (hunk arithmetic checked by parseUnifiedDiff at runtime).
const DISCOUNT_DIFF = `diff --git a/src/pricing/discount.ts b/src/pricing/discount.ts
index aaaaaaa..bbbbbbb 100644
--- a/src/pricing/discount.ts
+++ b/src/pricing/discount.ts
@@ -1,3 +1,8 @@
 export function discount(total: number): number {
+  if (total > 100) {
+    return total * 0.9;
+  } else {
+    return total;
+  }
   return total;
 }`;

const AUTH_GUARD_DIFF = `diff --git a/src/auth/guard.ts b/src/auth/guard.ts
index ccccccc..ddddddd 100644
--- a/src/auth/guard.ts
+++ b/src/auth/guard.ts
@@ -1,3 +1,9 @@
 export function canAccess(user: User, res: Resource): boolean {
+  if (user.role === 'admin') {
+    return true;
+  }
+  if (res.ownerId === user.id) {
+    return true;
+  }
   return false;
 }`;

interface BenchCase {
  name: string;
  diff: string;
  expectation: SkillBenchmarkExpectation;
}

const CASES: BenchCase[] = [
  {
    name: 'discount-boundary-branch',
    diff: DISCOUNT_DIFF,
    expectation: {
      aspects: [
        { aspect: 'Uncovered else branch', patterns: ['else', 'both sides', 'uncovered', 'branch'] },
        { aspect: 'Boundary value (100) tested', patterns: ['boundary', '\\b100\\b', 'threshold', 'edge'] },
        { aspect: 'Cites file:line', patterns: ['discount\\.ts', ':\\d', 'line \\d'] },
      ],
    },
  },
  {
    name: 'auth-guard-branches',
    diff: AUTH_GUARD_DIFF,
    expectation: {
      aspects: [
        { aspect: 'Each guard branch covered', patterns: ['branch', 'both', 'each', 'admin'] },
        { aspect: 'Regression test for the guard', patterns: ['regression', 'test', 'coverage'] },
        { aspect: 'Cites file:line', patterns: ['guard\\.ts', ':\\d', 'line \\d'] },
        { aspect: 'Early-return path noted', patterns: ['early return', 'return true', 'short-circuit'] },
      ],
    },
  },
];

// Hand-crafted qualitative diff for the seeded DONE run (representative demo).
const SEED_CASE_DIFFS: SkillBenchmarkCaseDiff[] = [
  {
    name: 'discount-boundary-branch',
    aspects: [
      { aspect: 'Uncovered else branch', with_skill: 'flags the untested else at discount.ts:4', without_skill: 'mentions "add more tests" generically', with_pass: true, without_pass: true },
      { aspect: 'Boundary value (100) tested', with_skill: 'calls out the total===100 boundary', without_skill: '—', with_pass: true, without_pass: false },
      { aspect: 'Cites file:line', with_skill: 'discount.ts:2–6', without_skill: 'names the file only', with_pass: true, without_pass: true },
    ],
  },
  {
    name: 'auth-guard-branches',
    aspects: [
      { aspect: 'Each guard branch covered', with_skill: 'admin + owner branches both flagged', without_skill: 'flags the admin branch only', with_pass: true, without_pass: true },
      { aspect: 'Regression test for the guard', with_skill: 'asks for a regression test on the fix', without_skill: 'suggests a test', with_pass: true, without_pass: true },
      { aspect: 'Cites file:line', with_skill: 'guard.ts:2–7', without_skill: '—', with_pass: true, without_pass: false },
      { aspect: 'Early-return path noted', with_skill: 'notes the early return true short-circuit', without_skill: 'no mention', with_pass: true, without_pass: false },
    ],
  },
];

const WITH_METRICS: SkillBenchmarkMetrics = {
  checks_passed: 7,
  checks_total: 7,
  pass_rate: 1,
  duration_ms: 112_000,
  tokens: 33_268,
};

const WITHOUT_METRICS: SkillBenchmarkMetrics = {
  checks_passed: 4,
  checks_total: 7,
  pass_rate: 4 / 7,
  duration_ms: 66_000,
  tokens: 16_346,
};

export async function seedSkillBenchmark(db: Db): Promise<void> {
  const [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) return;

  const [skill] = await db
    .select()
    .from(t.skills)
    .where(and(eq(t.skills.workspaceId, ws.id), eq(t.skills.name, 'branch-coverage-rubric')));
  if (!skill) return;

  // 1. Benchmark cases (idempotent by the eval_cases (workspace, owner, name) uidx).
  for (const c of CASES) {
    await db
      .insert(t.evalCases)
      .values({
        workspaceId: ws.id,
        ownerKind: 'skill',
        ownerId: skill.id,
        name: c.name,
        inputDiff: c.diff,
        expectedOutput: c.expectation as object,
      })
      .onConflictDoNothing();
  }

  // 2. One DONE benchmark run (skip if the skill already has one).
  const existing = await db
    .select({ id: t.skillEvalRuns.id })
    .from(t.skillEvalRuns)
    .where(
      and(
        eq(t.skillEvalRuns.workspaceId, ws.id),
        eq(t.skillEvalRuns.skillId, skill.id),
        eq(t.skillEvalRuns.status, 'done'),
      ),
    );
  if (existing.length === 0) {
    await db.insert(t.skillEvalRuns).values({
      workspaceId: ws.id,
      skillId: skill.id,
      status: 'done',
      skillVersion: skill.version,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      withMetrics: WITH_METRICS as object,
      withoutMetrics: WITHOUT_METRICS as object,
      cases: SEED_CASE_DIFFS as object,
      costUsd: 0.0123,
      finishedAt: new Date(),
    });
  }
}
