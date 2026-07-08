import type { SkillBenchmarkExpectation } from '@devdigest/shared';

/**
 * A normalized benchmark case: a diff to review plus the aspects a skilled
 * reviewer should surface (code-graded). Seeded skill cases (eval_cases with
 * owner_kind='skill') are converted to this shape; skills WITHOUT seeded cases
 * fall back to DEFAULT_BENCHMARK_CASES so "Run benchmark" works for any skill.
 */
export interface BenchCase {
  name: string;
  inputDiff: string;
  expectation: SkillBenchmarkExpectation;
}

// A generic, reviewable diff: an HTTP handler with several latent issues
// (unvalidated body, no error handling, a magic-number boundary, ignored
// insert result). Skill-agnostic — any skill's body should make the review
// MORE specific/grounded than the bare model, which is what the aspects probe.
const GENERIC_HANDLER_DIFF = `diff --git a/src/handlers/createUser.ts b/src/handlers/createUser.ts
index 1111111..2222222 100644
--- a/src/handlers/createUser.ts
+++ b/src/handlers/createUser.ts
@@ -1,3 +1,9 @@
 export async function createUser(req, res) {
+  const { email, age } = req.body;
+  const user = await db.insert(users).values({ email, age });
+  if (age > 18) {
+    grantAdultAccess(user);
+  }
+  res.json(user);
   return;
 }`;

/**
 * Default benchmark used when a skill has no seeded cases. The aspects are
 * intentionally generic — they measure whether the review got MORE specific
 * (cites a line, names a concrete problem, proposes a concrete fix) with the
 * skill injected. They are NOT skill-specific; for a sharper benchmark, seed
 * `eval_cases` rows with owner_kind='skill' for that skill.
 */
export const DEFAULT_BENCHMARK_CASES: BenchCase[] = [
  {
    name: 'createUser handler (generic review)',
    inputDiff: GENERIC_HANDLER_DIFF,
    expectation: {
      aspects: [
        {
          aspect: 'Cites a concrete file:line',
          patterns: ['createUser\\.ts', ':\\d', 'line \\d'],
        },
        {
          aspect: 'Names a concrete problem',
          patterns: [
            'unvalidated',
            'validat',
            'missing',
            'no error handling',
            'not handled',
            '\\bnull\\b',
            'undefined',
            'edge case',
            'boundary',
          ],
        },
        {
          aspect: 'Proposes a concrete fix',
          patterns: ['add ', 'use ', 'guard', 'wrap', 'validate', 'instead', 'should ', 'consider '],
        },
      ],
    },
  },
];
