import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

/** Repo-intel index completeness behind a blast result (drives the partial/degraded badge). */
export const BlastIndexStatus = z.enum(['full', 'partial', 'degraded', 'failed']);
export type BlastIndexStatus = z.infer<typeof BlastIndexStatus>;

/** A prior PR whose changed files overlap this PR's changed files. */
export const PriorPr = z.object({
  number: z.number().int(),
  title: z.string(),
  pull_id: z.string(),
});
export type PriorPr = z.infer<typeof PriorPr>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  /** repo-intel index completeness; non-'full' → show a badge, never an empty screen. */
  status: BlastIndexStatus.default('full'),
  /** Why the index is degraded/partial, when applicable. */
  degraded_reason: z.string().nullable().default(null),
  /** Prior PRs touching the same files (bonus section). */
  prior_prs: z.array(PriorPr).default([]),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

/** One finding anchored to a Smart Diff file, carrying the id needed to
 *  deep-link a clickable in-diff badge to its FindingCard. `finding_lines`
 *  (below) stays the deduped line-number list used for in-diff scroll anchors;
 *  this list keeps every finding distinct (two on the same line don't merge). */
export const SmartDiffFinding = z.object({
  id: z.string(),
  start_line: z.number().int(),
  severity: Severity,
});
export type SmartDiffFinding = z.infer<typeof SmartDiffFinding>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
  findings: z.array(SmartDiffFinding).default([]),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Brief: generated PR Why + Risk synthesis (SPEC-03) ----

export const ReviewFocusItem = z.object({
  file: z.string(),
  line: z.number().int().nullable(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

/**
 * Full PR brief DTO — stored in pr_brief.json and returned by both GET and POST.
 * Includes the LLM-generated fields (what/why/risk_level/risks/review_focus)
 * and the generation metadata (tokens_in/tokens_out/cost_usd/generated_at).
 */
export const BriefRecord = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: z.enum(['low', 'medium', 'high']),
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullable(),
  generated_at: z.string(), // ISO 8601
});
export type BriefRecord = z.infer<typeof BriefRecord>;
