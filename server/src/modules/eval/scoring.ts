/**
 * Eval Pipeline — pure arithmetic scoring functions (SPEC-04, ACs 18–21).
 *
 * Design notes:
 *
 * (a) Precision degenerates to 1.0 when the eval set has no must_not_flag
 *     expectations and at least one must_find case matched (TP > 0, FP = 0 →
 *     TP / (TP + FP) = 1.0). Seed sets MUST include must_not_flag cases to
 *     keep precision a live signal rather than a perpetual 1.0.
 *
 * (b) Batches snapshot the system prompt and model at the moment of execution,
 *     but they do NOT snapshot skill bodies. Updating a skill's text without
 *     bumping the agent version means a later batch re-run will silently use a
 *     different skill body — link skill versions to agent versions to keep the
 *     comparison meaningful.
 *
 * This file must remain pure: ZERO imports beyond `@devdigest/shared` types so
 * the scoring logic is runnable without any infrastructure (AC-22).
 */

import type { EvalExpectation, Finding } from '@devdigest/shared';

export interface CaseScore {
  pass: boolean;
  isMustFind: boolean;
  isMustNotFlag: boolean;
  /** True iff at least one finding matched the expectation. */
  matched: boolean;
  /** Number of findings that survived grounding (outcome.findings.length). */
  survivors: number;
  /** Number of findings dropped by grounding (outcome.droppedCount). */
  dropped: number;
}

/**
 * matchesExpectation — inclusive line-range intersection on the same file.
 *
 * AC-18: returns true iff
 *   finding.file === exp.file
 *   AND finding.start_line <= exp.end_line
 *   AND exp.start_line <= finding.end_line
 *
 * Boundary touching (finding.end_line === exp.start_line) is considered a
 * match (inclusive both sides).
 */
export function matchesExpectation(exp: EvalExpectation, finding: Finding): boolean {
  return (
    finding.file === exp.file &&
    finding.start_line <= exp.end_line &&
    exp.start_line <= finding.end_line
  );
}

/**
 * scoreEvalCase — compute a CaseScore for one expectation against an outcome.
 *
 * For must_find:      pass = any finding matched the expectation.
 * For must_not_flag:  pass = NO finding matched the expectation.
 *
 * Extra findings that fall outside all labeled spans are NOT counted as false
 * positives — only matched must_not_flag cases contribute FP in
 * aggregateEvalMetrics.
 */
export function scoreEvalCase(
  exp: EvalExpectation,
  outcome: { findings: Finding[]; droppedCount: number },
): CaseScore {
  const anyMatch = outcome.findings.some((f) => matchesExpectation(exp, f));
  const isMustFind = exp.type === 'must_find';
  const isMustNotFlag = exp.type === 'must_not_flag';
  return {
    pass: isMustFind ? anyMatch : !anyMatch,
    isMustFind,
    isMustNotFlag,
    matched: anyMatch,
    survivors: outcome.findings.length,
    dropped: outcome.droppedCount,
  };
}

export interface AggregatedMetrics {
  recall: number;
  precision: number;
  citation_accuracy: number;
  cases_passed: number;
  cases_total: number;
}

/**
 * aggregateEvalMetrics — roll up per-case scores into batch-level metrics.
 *
 * AC-19 — recall:
 *   matched must_find cases / total must_find cases
 *   Degenerate (0 must_find cases) → 1.0
 *
 * AC-20 — precision:
 *   TP / (TP + FP)
 *   where TP = count of matched must_find cases
 *         FP = count of matched must_not_flag cases
 *   Extra findings outside labeled spans are NOT false positives.
 *   Degenerate (TP + FP = 0) → 1.0
 *
 * AC-21 — citation_accuracy:
 *   sum(survivors) / sum(survivors + dropped)   — sum-based, NOT mean-of-ratios
 *   Degenerate (no findings at all) → 1.0
 *
 * All 0/0 denominators resolve to 1.0 — never NaN, never 0.
 */
export function aggregateEvalMetrics(scores: CaseScore[]): AggregatedMetrics {
  const cases_total = scores.length;
  const cases_passed = scores.filter((s) => s.pass).length;

  // Recall numerator / denominator
  const mustFindTotal = scores.filter((s) => s.isMustFind).length;
  const mustFindMatched = scores.filter((s) => s.isMustFind && s.matched).length;
  const recall = mustFindTotal === 0 ? 1.0 : mustFindMatched / mustFindTotal;

  // Precision: TP and FP are case-level (one expectation = one case)
  const tp = mustFindMatched;
  const fp = scores.filter((s) => s.isMustNotFlag && s.matched).length;
  const precision = tp + fp === 0 ? 1.0 : tp / (tp + fp);

  // Citation accuracy: aggregate survivor/dropped counts across all cases
  const totalSurvivors = scores.reduce((acc, s) => acc + s.survivors, 0);
  const totalProcessed = scores.reduce((acc, s) => acc + s.survivors + s.dropped, 0);
  const citation_accuracy = totalProcessed === 0 ? 1.0 : totalSurvivors / totalProcessed;

  return {
    recall,
    precision,
    citation_accuracy,
    cases_passed,
    cases_total,
  };
}
