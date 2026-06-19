/* seed-demo-prs.ts — idempotent demo PRs for yamchinsky/dev-digest.
 *
 * The lab homework (L01) says local PRs may not survive a fork sync; users
 * can ask Claude to "recreate them manually". This script adds 5 PRs (#101–#105)
 * with varied severity distributions so the FINDINGS column on the PR list
 * has something visible. Each PR gets exactly one 'review' kind review whose
 * findings drive both the score ring and the FINDINGS column.
 *
 * Usage:
 *   cd server && ./node_modules/.bin/tsx src/db/seed-demo-prs.ts
 *
 * Idempotent: re-running is a no-op for PR rows (skipped via existing-row
 * lookup by (repo_id, number)). Skips entirely if the target repo isn't
 * found — never touches other repos.
 */

import 'dotenv/config';
import { createDb } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';

const TARGET_REPO_FULL_NAME = 'yamchinsky/dev-digest';

type DemoFinding = {
  file: string;
  startLine: number;
  endLine?: number;
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  category: 'bug' | 'security' | 'perf' | 'style' | 'test';
  title: string;
  rationale: string;
  suggestion?: string;
  confidence: number;
};

type DemoPr = {
  number: number;
  title: string;
  author: string;
  branch: string;
  headSha: string;
  additions: number;
  deletions: number;
  filesCount: number;
  status: 'needs_review' | 'reviewed' | 'stale' | 'open' | 'merged' | 'closed';
  body: string;
  review?: {
    verdict: 'approve' | 'request_changes' | 'comment';
    summary: string;
    score: number;
    findings: DemoFinding[];
  };
};

const DEMO_PRS: DemoPr[] = [
  {
    number: 101,
    title: 'Hot-path auth middleware refactor',
    author: 'demo.maria',
    branch: 'demo/auth-refactor',
    headSha: 'demo101a',
    additions: 142,
    deletions: 27,
    filesCount: 4,
    status: 'needs_review',
    body: 'Splits the auth middleware into compose-able guards.',
    review: {
      verdict: 'request_changes',
      summary:
        'Refactor reads well but introduces a missed `await` on the audit log and removes Retry-After on the rate-limit branch.',
      score: 54,
      findings: [
        {
          file: 'src/auth/middleware.ts',
          startLine: 42,
          endLine: 47,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Missing auth check on session refresh',
          rationale:
            'After the refactor, `refreshSession` is reachable without the `requireUser` guard. Any holder of a stale token can mint a new one.',
          suggestion: 'Re-add `requireUser` to the refresh handler or move the call into the same guard chain.',
          confidence: 0.93,
        },
        {
          file: 'src/auth/audit.ts',
          startLine: 18,
          severity: 'WARNING',
          category: 'bug',
          title: 'Audit log promise is not awaited',
          rationale:
            'The `auditLogin` call returns a Promise but is dropped. Failures vanish and the audit row may be missing under load.',
          confidence: 0.81,
        },
        {
          file: 'src/middleware/ratelimit.ts',
          startLine: 52,
          severity: 'WARNING',
          category: 'bug',
          title: 'Retry-After header omitted on 429',
          rationale:
            '429 is returned without a Retry-After header. Well-behaved clients can\'t back off correctly.',
          confidence: 0.78,
        },
      ],
    },
  },
  {
    number: 102,
    title: 'Migrate sessions table to UUID primary key',
    author: 'demo.deepak',
    branch: 'demo/sessions-uuid',
    headSha: 'demo102a',
    additions: 312,
    deletions: 88,
    filesCount: 7,
    status: 'needs_review',
    body: 'Move sessions.id from serial to uuid + backfill.',
    review: {
      verdict: 'request_changes',
      summary:
        'Backfill is online but the migration is non-reversible, two SSRF-shaped callbacks remain, and the worker swallows promise rejections.',
      score: 38,
      findings: [
        {
          file: 'db/migrations/0007_sessions_uuid.sql',
          startLine: 1,
          severity: 'CRITICAL',
          category: 'bug',
          title: 'Irreversible migration with no rollback path',
          rationale:
            'Migration drops the integer id without writing the mapping table; a botched cutover can\'t be reversed without restoring from backup.',
          suggestion: 'Keep the legacy column for one release and add a down migration.',
          confidence: 0.9,
        },
        {
          file: 'src/api/webhooks.ts',
          startLine: 73,
          endLine: 80,
          severity: 'CRITICAL',
          category: 'security',
          title: 'SSRF via user-supplied callback_url',
          rationale:
            'An untrusted `callback_url` drives an outbound request carrying account credentials — classic SSRF/exfil shape.',
          suggestion: 'Allowlist hosts and strip credentials before the outbound fetch.',
          confidence: 0.85,
        },
        {
          file: 'src/jobs/worker.ts',
          startLine: 34,
          severity: 'WARNING',
          category: 'bug',
          title: 'Unhandled promise rejection',
          rationale: 'Awaited call lacks try/catch; a throw will crash the worker process.',
          confidence: 0.78,
        },
        {
          file: 'src/api/admin.ts',
          startLine: 21,
          severity: 'WARNING',
          category: 'security',
          title: 'Missing auth check on mutation',
          rationale: 'Endpoint mutates state without verifying the caller\'s role.',
          confidence: 0.82,
        },
        {
          file: 'src/api/users.ts',
          startLine: 46,
          endLine: 52,
          severity: 'WARNING',
          category: 'perf',
          title: 'N+1 query under load',
          rationale: 'A per-row query inside a loop; batch it with a single IN clause.',
          confidence: 0.86,
        },
        {
          file: 'src/lib/cache.ts',
          startLine: 19,
          severity: 'WARNING',
          category: 'perf',
          title: 'Cache key collision risk',
          rationale: 'Composite key omits the workspace id; cross-tenant reads may collide.',
          confidence: 0.7,
        },
        {
          file: 'src/util/time.ts',
          startLine: 8,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Extract magic number',
          rationale: 'Unexplained constant repeated twice; give it a named binding.',
          confidence: 0.62,
        },
      ],
    },
  },
  {
    number: 103,
    title: 'Fix flaky checkout integration test',
    author: 'demo.tomek',
    branch: 'demo/checkout-flake',
    headSha: 'demo103a',
    additions: 24,
    deletions: 11,
    filesCount: 2,
    status: 'reviewed',
    body: 'Stabilize the checkout integration test by waiting on the network idle event.',
    review: {
      verdict: 'approve',
      summary: 'Fix is sound. Minor: add an assertion for the failure path.',
      score: 92,
      findings: [
        {
          file: 'test/handler.test.ts',
          startLine: 1,
          severity: 'SUGGESTION',
          category: 'test',
          title: 'Add test for error path',
          rationale: 'The new branch has no assertions covering its failure case.',
          confidence: 0.7,
        },
      ],
    },
  },
  {
    number: 104,
    title: 'Refactor invoice PDF renderer',
    author: 'demo.sara',
    branch: 'demo/invoice-refactor',
    headSha: 'demo104a',
    additions: 188,
    deletions: 96,
    filesCount: 5,
    status: 'reviewed',
    body: 'Split renderer into header / body / footer composers.',
    review: {
      verdict: 'comment',
      summary: 'Refactor is mostly stylistic — a few perf observations and dead-import cleanups.',
      score: 73,
      findings: [
        {
          file: 'src/invoice/render.ts',
          startLine: 14,
          severity: 'WARNING',
          category: 'perf',
          title: 'Synchronous fs.readFileSync in request path',
          rationale: 'Blocks the event loop under concurrent invoice rendering.',
          confidence: 0.75,
        },
        {
          file: 'src/invoice/footer.ts',
          startLine: 33,
          severity: 'WARNING',
          category: 'bug',
          title: 'Lossy cast Number(price)',
          rationale: 'Loses fractional cents for values stored as decimals.',
          confidence: 0.79,
        },
        {
          file: 'src/invoice/index.ts',
          startLine: 7,
          severity: 'WARNING',
          category: 'style',
          title: 'Mixed default + named exports in barrel',
          rationale: 'Mixing default and named exports complicates the consumer side.',
          confidence: 0.6,
        },
        {
          file: 'src/lib/fetch.ts',
          startLine: 14,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Prefer async/await',
          rationale: 'Replace the `.then()` chain with async/await per the repo house style.',
          confidence: 0.6,
        },
        {
          file: 'src/api/index.ts',
          startLine: 19,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Tighten return type',
          rationale: 'Return a typed `Result<T>` instead of `any`.',
          confidence: 0.58,
        },
        {
          file: 'src/app.ts',
          startLine: 3,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Remove dead import',
          rationale: 'The imported symbol is never referenced.',
          confidence: 0.66,
        },
        {
          file: 'src/invoice/header.ts',
          startLine: 22,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Rename `i` to a descriptive name',
          rationale: 'The loop variable is used outside the loop body.',
          confidence: 0.55,
        },
        {
          file: 'src/invoice/body.ts',
          startLine: 41,
          severity: 'SUGGESTION',
          category: 'test',
          title: 'Add snapshot test for body layout',
          rationale: 'A snapshot would catch accidental layout regressions.',
          confidence: 0.6,
        },
      ],
    },
  },
  {
    number: 105,
    title: 'Bump node 18 → 20 in CI',
    author: 'demo.deepak',
    branch: 'demo/node-20',
    headSha: 'demo105a',
    additions: 18,
    deletions: 4,
    filesCount: 2,
    status: 'stale',
    body: 'Bump CI runner to node 20.',
    // No review → FINDINGS cell renders "—".
  },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  const { db } = handle;

  const [repo] = await db
    .select()
    .from(t.repos)
    .where(eq(t.repos.fullName, TARGET_REPO_FULL_NAME));
  if (!repo) {
    console.error(`✗ repo ${TARGET_REPO_FULL_NAME} not found — nothing to seed.`);
    process.exit(1);
  }

  const workspaceId = repo.workspaceId;
  let inserted = 0;
  let skipped = 0;

  for (const dpr of DEMO_PRS) {
    const [existing] = await db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repo.id), eq(t.pullRequests.number, dpr.number)));

    if (existing) {
      skipped++;
      continue;
    }

    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo.id,
        number: dpr.number,
        title: dpr.title,
        author: dpr.author,
        branch: dpr.branch,
        base: 'main',
        headSha: dpr.headSha,
        additions: dpr.additions,
        deletions: dpr.deletions,
        filesCount: dpr.filesCount,
        status: dpr.status,
        body: dpr.body,
      })
      .returning();

    if (dpr.review) {
      const [review] = await db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: pr!.id,
          kind: 'review',
          verdict: dpr.review.verdict,
          summary: dpr.review.summary,
          score: dpr.review.score,
          model: 'seed-demo',
        })
        .returning();

      if (dpr.review.findings.length > 0) {
        await db.insert(t.findings).values(
          dpr.review.findings.map((f) => ({
            reviewId: review!.id,
            file: f.file,
            startLine: f.startLine,
            endLine: f.endLine ?? f.startLine,
            severity: f.severity,
            category: f.category,
            title: f.title,
            rationale: f.rationale,
            suggestion: f.suggestion ?? null,
            confidence: f.confidence,
          })),
        );
      }
    }

    inserted++;
  }

  console.log(`✓ demo PRs done — inserted ${inserted}, already present ${skipped}.`);
  await handle.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
