import { z } from "zod";

export const Severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
export type Severity = z.infer<typeof Severity>;

export const Finding = z.object({
  severity: Severity,
  rule: z.string().regex(/^[\w\-]+\/[\w\-\.]+$/, "rule must be '<skill>/<rule-id>'"),
  file: z.string().min(1),
  lines: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  summary: z.string().min(1),
  evidence_snippet: z.string().min(1),
  suggested_fix: z.string().min(1),
  ci_would_catch: z.boolean(),
  insights_md_match: z.string().optional(),
  suppressed_by: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const BucketReport = z.object({
  bucket: z.string().min(1),
  consulted_skills: z.array(z.string().min(1)),
  files_reviewed: z.array(z.string()),
  files_skipped_budget: z.array(z.string()),
  findings: z.array(Finding),
  notes: z.string().optional(),
});
export type BucketReport = z.infer<typeof BucketReport>;

export const Verdict = z.enum([
  "PASS",
  "BLOCK_CRITICAL",
  "BLOCK_INCOMPLETE",
  "WARN_DRAFT",
]);
export type Verdict = z.infer<typeof Verdict>;

export const ReviewArtifact = z.object({
  schema_version: z.literal(1),
  skill_version: z.string(),
  base_sha: z.string(),
  head_sha: z.string(),
  branch: z.string(),
  diff_hash: z.string(),
  generated_at: z.string(),
  duration_ms: z.number().int().nonnegative(),
  draft_mode: z.boolean(),
  strict: z.boolean(),
  cached: z.boolean(),
  consulted_skills: z.array(z.object({ name: z.string(), version: z.string() })),
  buckets: z.array(
    z.object({
      report: BucketReport.optional(),
      incomplete_reason: z.string().optional(),
    }),
  ),
  cross_bucket_findings: z.array(Finding),
  counts: z.object({
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
    suppressed: z.number().int().nonnegative(),
  }),
  verdict: Verdict,
  verdict_reason: z.string(),
});
export type ReviewArtifact = z.infer<typeof ReviewArtifact>;
