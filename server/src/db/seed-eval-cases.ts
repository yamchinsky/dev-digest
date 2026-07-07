import { type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import { DEFAULT_WORKSPACE_NAME } from './seed.js';

// ---------------------------------------------------------------------------
// Diff strings — full valid unified diffs for each eval case.
// Hunk-header arithmetic is verified in seed-eval-cases.it.test.ts via
// parseUnifiedDiff so any corruption surfaces as a test failure.
// ---------------------------------------------------------------------------

/**
 * Case: stripe-key-leak
 * File: src/config.ts — added a literal sk_live_ key at new-side line 12.
 *
 * @@ -9,6 +9,7 @@
 *   old: 6 lines (3 ctx + 3 ctx, no deletions)
 *   new: 7 lines (3 ctx + 1 added + 3 ctx)
 * Added line → new-side line 12.
 */
const STRIPE_KEY_LEAK_DIFF = `diff --git a/src/config.ts b/src/config.ts
index 2a3b4c5..9d0e1f2 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -9,6 +9,7 @@
 export const config = {
   port: process.env.PORT ?? 3000,
   nodeEnv: process.env.NODE_ENV ?? 'development',
+  stripeKey: 'sk_live_DUMMY_PLACEHOLDER_DO_NOT_USE',
   redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
   dbUrl: process.env.DATABASE_URL,
 };`;

/**
 * Case: n-plus-one-users
 * File: src/api/users.ts — DB queries inside a for-loop, new-side lines 45–52.
 *
 * @@ -42,6 +42,14 @@
 *   old: 6 lines (3 ctx + 3 ctx, no deletions)
 *   new: 14 lines (3 ctx + 8 added + 3 ctx)
 * Added lines → new-side lines 45–52.
 */
const N_PLUS_ONE_USERS_DIFF = `diff --git a/src/api/users.ts b/src/api/users.ts
index 3c5d7a1..8f2e4b9 100644
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -42,6 +42,14 @@
   const users = await db.query('SELECT * FROM users WHERE active = true');
   const results = [];
   for (const user of users.rows) {
+    const orders = await db.query(
+      'SELECT * FROM orders WHERE user_id = $1',
+      [user.id]
+    );
+    const payments = await db.query(
+      'SELECT * FROM payments WHERE user_id = $1',
+      [user.id]
+    );
     results.push({ ...user });
   }
   return results;`;

/**
 * Case: ratelimit-comparison-bug
 * File: src/middleware/rate-limit.ts — '=' (assignment) instead of '<='
 * in a condition, new-side line 29.
 *
 * @@ -26,7 +26,7 @@
 *   old: 7 lines (3 ctx + 1 deleted + 3 ctx)
 *   new: 7 lines (3 ctx + 1 added + 3 ctx)
 * Added line → new-side line 29.
 */
const RATELIMIT_BUG_DIFF = `diff --git a/src/middleware/rate-limit.ts b/src/middleware/rate-limit.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/middleware/rate-limit.ts
+++ b/src/middleware/rate-limit.ts
@@ -26,7 +26,7 @@
 function checkRateLimit(req: Request): boolean {
   const key = \`\${req.ip}:\${req.path}\`;
   const entry = store.get(key);
-  if (entry && entry.count > MAX_REQUESTS) {
+  if (entry && (entry.count = MAX_REQUESTS)) {
   return false;
   }
   entry ? entry.count++ : store.set(key, { count: 1, ts: Date.now() });`;

/**
 * Case: readme-docs-noise
 * File: README.md — documentation-only paragraph added, new-side lines 4–9.
 *
 * @@ -1,5 +1,11 @@
 *   old: 5 lines (3 ctx + 2 ctx, no deletions)
 *   new: 11 lines (3 ctx + 6 added + 2 ctx)
 * Added lines → new-side lines 4–9.
 */
const README_DOCS_NOISE_DIFF = `diff --git a/README.md b/README.md
index 4e5f6a7..2b3c8d9 100644
--- a/README.md
+++ b/README.md
@@ -1,5 +1,11 @@
 # Payments API

 A RESTful API for processing payments.
+
+## Rate Limiting
+
+All public endpoints are protected by a token-bucket rate limiter. Each
+client IP is limited to 100 requests per minute. Exceeding this limit
+returns a 429 status code with an error message.

 ## Getting Started`;

/**
 * Case: missing-await-async
 * File: src/api/payments.ts — chargeCard() called without await; result
 * immediately used as if resolved. New-side lines 17–18.
 *
 * @@ -14,6 +14,8 @@
 *   old: 6 lines (3 ctx + 3 ctx, no deletions)
 *   new: 8 lines (3 ctx + 2 added + 3 ctx)
 * Added lines → new-side lines 17–18.
 */
const MISSING_AWAIT_ASYNC_DIFF = `diff --git a/src/api/payments.ts b/src/api/payments.ts
index 5a1b2c3..7d4e5f6 100644
--- a/src/api/payments.ts
+++ b/src/api/payments.ts
@@ -14,6 +14,8 @@
 async function processPayment(amount: number, customerId: string) {
   const customer = await getCustomer(customerId);
   const invoice = await createInvoice(customer, amount);
+  const res = chargeCard(customer.paymentMethodId, invoice.total);
+  await recordTransaction({ chargeId: res.id, invoiceId: invoice.id });
   return { success: true, invoiceId: invoice.id };
 }
 `;

/**
 * Case: sql-string-concat
 * File: src/db/queries.ts — new query function builds SQL via string
 * concatenation with a request param (SQL injection smell). New-side lines 11–13.
 *
 * @@ -8,6 +8,9 @@
 *   old: 6 lines (3 ctx + 3 ctx, no deletions)
 *   new: 9 lines (3 ctx + 3 added + 3 ctx)
 * Added lines → new-side lines 11–13 (injection on line 12).
 */
const SQL_STRING_CONCAT_DIFF = `diff --git a/src/db/queries.ts b/src/db/queries.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/db/queries.ts
+++ b/src/db/queries.ts
@@ -8,6 +8,9 @@
   const result = await db.query('SELECT * FROM payments WHERE id = $1', [id]);
   return result.rows[0] ?? null;
 }
+export async function getPaymentsByNote(db: Pool, req: Request) {
+  const result = await db.query('SELECT * FROM payments WHERE note = ' + req.query.note);
+}

 export async function getPaymentsByStatus(db: Pool, status: string) {
   const result = await db.query('SELECT * FROM payments WHERE status = $1', [status]);`;

/**
 * Case: whitespace-format-noise
 * File: src/utils/format.ts — pure indentation fix (4-space → 2-space) with
 * zero logic change. New-side lines 8–9.
 *
 * @@ -5,8 +5,8 @@
 *   old: 8 lines (3 ctx + 2 deleted + 3 ctx)
 *   new: 8 lines (3 ctx + 2 added + 3 ctx)
 * Added lines → new-side lines 8–9.
 */
const WHITESPACE_FORMAT_NOISE_DIFF = `diff --git a/src/utils/format.ts b/src/utils/format.ts
index 2c3d4e5..6f7a8b9 100644
--- a/src/utils/format.ts
+++ b/src/utils/format.ts
@@ -5,8 +5,8 @@
 const LOCALE = 'en-US';

 function pad(n: number): string {
-    if (n < 10) { return '0' + n; }
-    return String(n);
+  if (n < 10) { return '0' + n; }
+  return String(n);
 }

 export function formatDate(date: Date): string {`;

/**
 * Case: safe-var-rename
 * File: src/utils/helpers.ts — local variable rename, all usages updated,
 * zero logic change. New-side lines 17–18.
 *
 * @@ -14,8 +14,8 @@
 *   old: 8 lines (3 ctx + 2 deleted + 3 ctx)
 *   new: 8 lines (3 ctx + 2 added + 3 ctx)
 * Added lines → new-side lines 17–18.
 */
const SAFE_VAR_RENAME_DIFF = `diff --git a/src/utils/helpers.ts b/src/utils/helpers.ts
index 7c8d9e0..1f2a3b4 100644
--- a/src/utils/helpers.ts
+++ b/src/utils/helpers.ts
@@ -14,8 +14,8 @@
 export function formatDate(date: Date): string {
   const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
   const formatter = new Intl.DateTimeFormat('en-US', opts);
-  const result = formatter.format(date);
-  return result;
+  const formatted = formatter.format(date);
+  return formatted;
 }

 export function clamp(value: number, min: number, max: number): number {`;

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

/**
 * Idempotently inserts eight eval cases for the General Reviewer agent,
 * themed on demo PR #482 (acme/payments-api).
 *
 * If the default workspace or the General Reviewer agent does not yet exist
 * (i.e. seed() has not been called), the function returns without error.
 * Use onConflictDoNothing on the unique index (workspaceId, ownerId, name)
 * to make repeated calls safe.
 *
 * NOT a Fastify plugin — call directly from CLI or test scaffolding.
 */
export async function seedEvalCases(db: Db): Promise<void> {
  // ---- 1. resolve workspace ----
  const [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) return; // seed() not yet run

  // ---- 2. resolve General Reviewer agent ----
  const [agent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, ws.id), eq(t.agents.name, 'General Reviewer')));
  if (!agent) return; // agent not seeded yet

  // ---- 3. insert eight cases (idempotent) ----
  const prMeta = { pr_number: 482, repo: 'acme/payments-api' };

  await db
    .insert(t.evalCases)
    .values([
      // ------------------------------------------------------------------ must_find cases
      {
        workspaceId: ws.id,
        ownerKind: 'agent' as const,
        ownerId: agent.id,
        name: 'stripe-key-leak',
        inputDiff: STRIPE_KEY_LEAK_DIFF,
        inputMeta: {
          title: 'Add rate limiting to public API endpoints',
          body: 'Adds token-bucket rate limiting. Includes config changes.',
          source: prMeta,
        },
        expectedOutput: {
          type: 'must_find',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          note: 'sk_live_ literal committed in plaintext — must be caught as CRITICAL security finding',
        },
        notes:
          'Validates that the General Reviewer detects a hardcoded Stripe secret key ' +
          '(sk_live_ prefix) added to src/config.ts. This is the canonical CRITICAL ' +
          'security finding from PR #482.',
      },
      {
        workspaceId: ws.id,
        ownerKind: 'agent' as const,
        ownerId: agent.id,
        name: 'n-plus-one-users',
        inputDiff: N_PLUS_ONE_USERS_DIFF,
        inputMeta: {
          title: 'Add rate limiting to public API endpoints',
          body: 'Iterates over user list with per-user DB queries.',
          source: prMeta,
        },
        expectedOutput: {
          type: 'must_find',
          file: 'src/api/users.ts',
          start_line: 45,
          end_line: 52,
          note: 'Two awaited DB queries inside a for-loop — classic N+1 pattern',
        },
        notes:
          'Validates detection of an N+1 query introduced in the user-list handler: ' +
          'two db.query() calls (orders + payments) are awaited inside a for-loop, ' +
          'issuing O(n) round-trips to the database.',
      },
      {
        workspaceId: ws.id,
        ownerKind: 'agent' as const,
        ownerId: agent.id,
        name: 'ratelimit-comparison-bug',
        inputDiff: RATELIMIT_BUG_DIFF,
        inputMeta: {
          title: 'Add rate limiting to public API endpoints',
          body: 'Implements the checkRateLimit guard for the middleware.',
          source: prMeta,
        },
        expectedOutput: {
          type: 'must_find',
          file: 'src/middleware/rate-limit.ts',
          start_line: 29,
          end_line: 29,
          note: 'Assignment (=) instead of comparison (<=) in rate-limit condition — always truthy',
        },
        notes:
          'Validates that the reviewer catches a subtle comparison-to-assignment typo ' +
          '(entry.count = MAX_REQUESTS instead of entry.count <= MAX_REQUESTS) that ' +
          'makes the rate-limit guard always trigger regardless of actual count.',
      },
      {
        workspaceId: ws.id,
        ownerKind: 'agent' as const,
        ownerId: agent.id,
        name: 'missing-await-async',
        inputDiff: MISSING_AWAIT_ASYNC_DIFF,
        inputMeta: {
          title: 'Add rate limiting to public API endpoints',
          body: 'Extends processPayment to charge the card and record the transaction.',
          source: prMeta,
        },
        expectedOutput: {
          type: 'must_find',
          file: 'src/api/payments.ts',
          start_line: 17,
          end_line: 17,
          note: 'chargeCard() called without await — res is a Promise, res.id is undefined',
        },
        notes:
          'Validates detection of a missing await on an async call: chargeCard() returns ' +
          'a Promise but is assigned without await, so res.id resolves to undefined and ' +
          'the recordTransaction call silently stores a null chargeId.',
      },
      {
        workspaceId: ws.id,
        ownerKind: 'agent' as const,
        ownerId: agent.id,
        name: 'sql-string-concat',
        inputDiff: SQL_STRING_CONCAT_DIFF,
        inputMeta: {
          title: 'Add rate limiting to public API endpoints',
          body: 'Adds getPaymentsByNote query helper for searching by memo field.',
          source: prMeta,
        },
        expectedOutput: {
          type: 'must_find',
          file: 'src/db/queries.ts',
          start_line: 12,
          end_line: 12,
          note: 'SQL built via string concatenation with req.query.note — SQL injection risk',
        },
        notes:
          'Validates detection of SQL injection: getPaymentsByNote() builds a raw query ' +
          'by concatenating req.query.note directly into the SQL string instead of using ' +
          'a parameterised placeholder, exposing the DB to arbitrary SQL from the request.',
      },
      // ------------------------------------------------------------------ must_not_flag cases
      {
        workspaceId: ws.id,
        ownerKind: 'agent' as const,
        ownerId: agent.id,
        name: 'whitespace-format-noise',
        inputDiff: WHITESPACE_FORMAT_NOISE_DIFF,
        inputMeta: {
          title: 'Add rate limiting to public API endpoints',
          body: 'Fix indentation in pad() helper to match project style guide (2-space).',
          source: prMeta,
        },
        expectedOutput: {
          type: 'must_not_flag',
          file: 'src/utils/format.ts',
          start_line: 8,
          end_line: 9,
          note: 'Pure indentation change (4→2 spaces) with zero logic change — must produce zero findings',
        },
        notes:
          'Validates precision: a mechanical reindentation of the pad() helper body ' +
          '(4-space to 2-space) with no logic change must not trigger any finding. ' +
          'Flagging pure formatting changes is a false positive that erodes developer trust.',
      },
      {
        workspaceId: ws.id,
        ownerKind: 'agent' as const,
        ownerId: agent.id,
        name: 'readme-docs-noise',
        inputDiff: README_DOCS_NOISE_DIFF,
        inputMeta: {
          title: 'Add rate limiting to public API endpoints',
          body: 'Documentation update only — adds Rate Limiting section to README.',
          source: prMeta,
        },
        expectedOutput: {
          type: 'must_not_flag',
          file: 'README.md',
          start_line: 4,
          end_line: 9,
          note: 'Pure documentation addition — no logic, no secrets, must produce zero findings',
        },
        notes:
          'Validates precision: a documentation-only paragraph added to README.md must ' +
          'not produce any findings. Noisy reviewers that flag doc changes hurt developer ' +
          'trust and inflate false-positive rates.',
      },
      {
        workspaceId: ws.id,
        ownerKind: 'agent' as const,
        ownerId: agent.id,
        name: 'safe-var-rename',
        inputDiff: SAFE_VAR_RENAME_DIFF,
        inputMeta: {
          title: 'Add rate limiting to public API endpoints',
          body: 'Renames local variable `result` to `formatted` in formatDate helper.',
          source: prMeta,
        },
        expectedOutput: {
          type: 'must_not_flag',
          file: 'src/utils/helpers.ts',
          start_line: 17,
          end_line: 18,
          note: 'Local variable rename with all usages updated — zero logic change',
        },
        notes:
          'Validates precision: a mechanical local-variable rename (result → formatted) ' +
          'with all usages updated in the same hunk must not trigger any finding. ' +
          'Flagging such changes is a false positive that erodes reviewer credibility.',
      },
    ])
    .onConflictDoNothing();
}
