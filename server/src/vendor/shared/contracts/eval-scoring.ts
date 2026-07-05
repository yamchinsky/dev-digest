import { z } from 'zod';
import { Provider } from './knowledge.js';

/**
 * Eval Pipeline scoring contracts — SPEC-04.
 *
 * These extend the barrel; do NOT modify eval-ci.ts, knowledge.ts, or findings.ts.
 * EvalCase and EvalRun (legacy aggregate) live in knowledge.ts and are unchanged.
 * EvalRunRecord (persisted run row) lives in eval-ci.ts and is unchanged.
 */

export const EvalExpectationType = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationType = z.infer<typeof EvalExpectationType>;

/** Structured expectation embedded in an eval case's expected_output. */
export const EvalExpectation = z.object({
  type: EvalExpectationType,
  /** File path the finding must (or must not) appear in. */
  file: z.string().min(1),
  /** Inclusive start line (1-based). */
  start_line: z.number().int().min(1),
  /** Inclusive end line (≥ start_line). Enforced at route level; here for typing only. */
  end_line: z.number().int().min(1),
  /** Optional human note — not used in scoring. */
  note: z.string().nullish(),
  /** Finding that originated this case (null for manual cases). */
  source_finding_id: z.string().uuid().nullish(),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

export const EvalBatchStatus = z.enum(['running', 'done', 'failed']);
export type EvalBatchStatus = z.infer<typeof EvalBatchStatus>;

/** A batch execution record (one run of all cases for an agent). */
export const EvalBatch = z.object({
  id: z.string().uuid(),
  agent_id: z.string().uuid().nullable(),
  workspace_id: z.string().uuid(),
  status: EvalBatchStatus,
  agent_version: z.number().int().nullable(),
  system_prompt: z.string(),
  provider: z.string(),
  model: z.string(),
  strategy: z.string(),
  skill_bodies: z.array(z.string()).nullable(),
  cases_total: z.number().int(),
  cases_passed: z.number().int().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type EvalBatch = z.infer<typeof EvalBatch>;

/** Batch record plus all associated per-case run rows. Used for polling + compare. */
export const EvalBatchDetail = z.object({
  batch: EvalBatch,
  runs: z.array(
    z.object({
      id: z.string().uuid(),
      case_id: z.string().uuid(),
      case_name: z.string().nullish(),
      batch_id: z.string().uuid().nullable(),
      ran_at: z.string(),
      pass: z.boolean().nullable(),
      actual_output: z.unknown(),
      recall: z.number().nullable(),
      precision: z.number().nullable(),
      citation_accuracy: z.number().nullable(),
      duration_ms: z.number().int().nullable(),
      cost_usd: z.number().nullable(),
    })
  ),
});
export type EvalBatchDetail = z.infer<typeof EvalBatchDetail>;

/** Optional provider/model override for a batch run. */
export const EvalStartBatchInput = z.object({
  provider: Provider.optional(),
  model: z.string().optional(),
});
export type EvalStartBatchInput = z.infer<typeof EvalStartBatchInput>;
