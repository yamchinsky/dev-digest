import { z } from 'zod';
import { Provider } from './knowledge.js';

/**
 * Skill benchmark contracts — the "Skill Editor · Evals" tab.
 *
 * A skill benchmark answers "is this skill worth its tokens?" by running the
 * SAME task twice — once WITH the skill body injected, once with the bare model
 * — and comparing the two. This mirrors the harness `eval:benchmark` tier, but
 * as a product feature persisted in Postgres.
 *
 * Grading is CODE-ONLY (substring / regex over the model output), never a judge:
 * the expectation here is a set of literal "aspects" a skilled reviewer should
 * surface, so a match is decided by `RegExp.test`, not an LLM. This keeps runs
 * across skill versions comparable and free of judge variance.
 *
 * Extends the barrel — do NOT edit eval-scoring.ts / eval-ci.ts / knowledge.ts.
 */

export const SkillBenchmarkStatus = z.enum(['running', 'done', 'failed']);
export type SkillBenchmarkStatus = z.infer<typeof SkillBenchmarkStatus>;

/** Aggregate metrics for ONE configuration (with_skill or without_skill). */
export const SkillBenchmarkMetrics = z.object({
  /** Aspects the config surfaced (a "check" = one aspect on one case). */
  checks_passed: z.number().int(),
  checks_total: z.number().int(),
  /** checks_passed / checks_total, 0..1 (1 when checks_total is 0). */
  pass_rate: z.number(),
  /** Wall-clock across all cases for this config. */
  duration_ms: z.number().int(),
  /** tokens_in + tokens_out across all cases for this config. */
  tokens: z.number().int(),
});
export type SkillBenchmarkMetrics = z.infer<typeof SkillBenchmarkMetrics>;

/** One row of the qualitative diff (design: Аспект | with_skill | without_skill). */
export const SkillBenchmarkAspect = z.object({
  aspect: z.string(),
  /** Short evidence/description of what the with_skill output did for this aspect. */
  with_skill: z.string(),
  /** Same, for the bare-model output. */
  without_skill: z.string(),
  /** Did the with_skill output satisfy this aspect (code-graded)? */
  with_pass: z.boolean(),
  /** Did the bare-model output satisfy this aspect? */
  without_pass: z.boolean(),
});
export type SkillBenchmarkAspect = z.infer<typeof SkillBenchmarkAspect>;

/** Per-case qualitative comparison. */
export const SkillBenchmarkCaseDiff = z.object({
  name: z.string(),
  aspects: z.array(SkillBenchmarkAspect),
});
export type SkillBenchmarkCaseDiff = z.infer<typeof SkillBenchmarkCaseDiff>;

/**
 * A full benchmark run. `with_skill` / `without_skill` are null until the run
 * reaches `done` (a `running` / `failed` run has no metrics yet).
 */
export const SkillBenchmarkRun = z.object({
  id: z.string().uuid(),
  skill_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  status: SkillBenchmarkStatus,
  skill_version: z.number().int().nullable(),
  provider: z.string(),
  model: z.string(),
  with_skill: SkillBenchmarkMetrics.nullable(),
  without_skill: SkillBenchmarkMetrics.nullable(),
  cases: z.array(SkillBenchmarkCaseDiff),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type SkillBenchmarkRun = z.infer<typeof SkillBenchmarkRun>;

/**
 * Expectation stored in a skill benchmark eval case's `expected_output`
 * (`eval_cases` row with `owner_kind = 'skill'`). Each aspect names a thing a
 * skilled reviewer should surface, with the literal patterns that prove it.
 */
export const SkillBenchmarkExpectation = z.object({
  aspects: z
    .array(
      z.object({
        /** Human label shown in the qualitative diff (e.g. "Uncovered branch"). */
        aspect: z.string().min(1),
        /** Regex sources; the output matches the aspect if ANY pattern hits. */
        patterns: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});
export type SkillBenchmarkExpectation = z.infer<typeof SkillBenchmarkExpectation>;

/** Optional provider/model override for a benchmark run. */
export const SkillBenchmarkStartInput = z.object({
  provider: Provider.optional(),
  model: z.string().optional(),
});
export type SkillBenchmarkStartInput = z.infer<typeof SkillBenchmarkStartInput>;
