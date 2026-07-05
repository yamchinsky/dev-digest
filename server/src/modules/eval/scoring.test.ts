/**
 * Hermetic unit tests for the eval scoring functions — no DB, no Docker, no LLM.
 * Covers ACs 18–22 of SPEC-04.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  matchesExpectation,
  scoreEvalCase,
  aggregateEvalMetrics,
  type CaseScore,
} from './scoring.js';

import type { EvalExpectation, Finding } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Helpers — minimal valid Finding and EvalExpectation builders
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<Finding> & { file: string; start_line: number; end_line: number }): Finding {
  return {
    id: 'f-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'test finding',
    rationale: 'rationale',
    confidence: 0.9,
    // Required fields and all other overrides applied last so callers can
    // override defaults (e.g. severity, id) without duplication.
    ...overrides,
  };
}

function makeExp(overrides: Partial<EvalExpectation> & { file: string; start_line: number; end_line: number }): EvalExpectation {
  return {
    type: 'must_find',
    // All required fields come from overrides; type default above can be overridden.
    ...overrides,
  };
}

function makeCaseScore(overrides: Partial<CaseScore>): CaseScore {
  return {
    pass: true,
    isMustFind: true,
    isMustNotFlag: false,
    matched: true,
    survivors: 0,
    dropped: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC-18 — matchesExpectation: inclusive line-range intersection
// ---------------------------------------------------------------------------

describe('matchesExpectation', () => {
  const file = 'src/foo.ts';

  it('returns true when ranges fully overlap', () => {
    const exp = makeExp({ file, start_line: 10, end_line: 20 });
    const finding = makeFinding({ file, start_line: 12, end_line: 18 });
    expect(matchesExpectation(exp, finding)).toBe(true);
  });

  it('returns true when finding spans wider than expectation', () => {
    const exp = makeExp({ file, start_line: 10, end_line: 20 });
    const finding = makeFinding({ file, start_line: 5, end_line: 25 });
    expect(matchesExpectation(exp, finding)).toBe(true);
  });

  it('returns true when expectation spans wider than finding', () => {
    const exp = makeExp({ file, start_line: 5, end_line: 25 });
    const finding = makeFinding({ file, start_line: 10, end_line: 20 });
    expect(matchesExpectation(exp, finding)).toBe(true);
  });

  it('returns true when ranges partially overlap (finding before)', () => {
    const exp = makeExp({ file, start_line: 15, end_line: 25 });
    const finding = makeFinding({ file, start_line: 10, end_line: 18 });
    expect(matchesExpectation(exp, finding)).toBe(true);
  });

  it('returns true when ranges partially overlap (finding after)', () => {
    const exp = makeExp({ file, start_line: 10, end_line: 20 });
    const finding = makeFinding({ file, start_line: 18, end_line: 30 });
    expect(matchesExpectation(exp, finding)).toBe(true);
  });

  it('returns true when ranges touch at a boundary — finding.end_line === exp.start_line (inclusive)', () => {
    const exp = makeExp({ file, start_line: 20, end_line: 30 });
    const finding = makeFinding({ file, start_line: 10, end_line: 20 });
    // finding.end_line (20) === exp.start_line (20) → inclusive touch
    expect(matchesExpectation(exp, finding)).toBe(true);
  });

  it('returns true when ranges touch at a boundary — exp.end_line === finding.start_line (inclusive)', () => {
    const exp = makeExp({ file, start_line: 10, end_line: 20 });
    const finding = makeFinding({ file, start_line: 20, end_line: 30 });
    // exp.end_line (20) === finding.start_line (20) → inclusive touch
    expect(matchesExpectation(exp, finding)).toBe(true);
  });

  it('returns false when ranges are disjoint (finding is before expectation)', () => {
    const exp = makeExp({ file, start_line: 20, end_line: 30 });
    const finding = makeFinding({ file, start_line: 5, end_line: 15 });
    expect(matchesExpectation(exp, finding)).toBe(false);
  });

  it('returns false when ranges are disjoint (finding is after expectation)', () => {
    const exp = makeExp({ file, start_line: 5, end_line: 15 });
    const finding = makeFinding({ file, start_line: 20, end_line: 30 });
    expect(matchesExpectation(exp, finding)).toBe(false);
  });

  it('returns false when same line numbers but different file', () => {
    const exp = makeExp({ file: 'src/foo.ts', start_line: 10, end_line: 20 });
    const finding = makeFinding({ file: 'src/bar.ts', start_line: 10, end_line: 20 });
    expect(matchesExpectation(exp, finding)).toBe(false);
  });

  it('returns false when ranges overlap but different file', () => {
    const exp = makeExp({ file: 'src/foo.ts', start_line: 10, end_line: 20 });
    const finding = makeFinding({ file: 'src/baz.ts', start_line: 15, end_line: 25 });
    expect(matchesExpectation(exp, finding)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scoreEvalCase
// ---------------------------------------------------------------------------

describe('scoreEvalCase', () => {
  const file = 'src/foo.ts';

  it('must_find: pass=true when a finding matches', () => {
    const exp = makeExp({ type: 'must_find', file, start_line: 10, end_line: 20 });
    const finding = makeFinding({ file, start_line: 12, end_line: 18 });
    const score = scoreEvalCase(exp, { findings: [finding], droppedCount: 0 });
    expect(score.pass).toBe(true);
    expect(score.matched).toBe(true);
    expect(score.isMustFind).toBe(true);
    expect(score.isMustNotFlag).toBe(false);
  });

  it('must_find: pass=false when no finding matches', () => {
    const exp = makeExp({ type: 'must_find', file, start_line: 10, end_line: 20 });
    const finding = makeFinding({ file, start_line: 50, end_line: 60 });
    const score = scoreEvalCase(exp, { findings: [finding], droppedCount: 0 });
    expect(score.pass).toBe(false);
    expect(score.matched).toBe(false);
  });

  it('must_not_flag: pass=true when no finding matches', () => {
    const exp = makeExp({ type: 'must_not_flag', file, start_line: 10, end_line: 20 });
    const finding = makeFinding({ file, start_line: 50, end_line: 60 });
    const score = scoreEvalCase(exp, { findings: [finding], droppedCount: 0 });
    expect(score.pass).toBe(true);
    expect(score.matched).toBe(false);
    expect(score.isMustNotFlag).toBe(true);
    expect(score.isMustFind).toBe(false);
  });

  it('must_not_flag: pass=false when a finding matches', () => {
    const exp = makeExp({ type: 'must_not_flag', file, start_line: 10, end_line: 20 });
    const finding = makeFinding({ file, start_line: 12, end_line: 18 });
    const score = scoreEvalCase(exp, { findings: [finding], droppedCount: 0 });
    expect(score.pass).toBe(false);
    expect(score.matched).toBe(true);
  });

  it('multiple findings matching one expectation → matched=true counted once (case-level)', () => {
    const exp = makeExp({ type: 'must_find', file, start_line: 1, end_line: 100 });
    const findings = [
      makeFinding({ file, start_line: 10, end_line: 20 }),
      makeFinding({ file, start_line: 30, end_line: 40 }),
      makeFinding({ file, start_line: 50, end_line: 60 }),
    ];
    const score = scoreEvalCase(exp, { findings, droppedCount: 0 });
    // matched is a single boolean — not a count
    expect(score.matched).toBe(true);
    expect(score.pass).toBe(true);
    // survivors reflects all findings passed through
    expect(score.survivors).toBe(3);
  });

  it('records survivors and dropped from outcome', () => {
    const exp = makeExp({ type: 'must_find', file, start_line: 10, end_line: 20 });
    const finding = makeFinding({ file, start_line: 12, end_line: 18 });
    const score = scoreEvalCase(exp, { findings: [finding], droppedCount: 4 });
    expect(score.survivors).toBe(1);
    expect(score.dropped).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// AC-19 — recall
// ---------------------------------------------------------------------------

describe('aggregateEvalMetrics — recall (AC-19)', () => {
  it('recall = 0.5 when two must_find cases, one matched', () => {
    const scores: CaseScore[] = [
      makeCaseScore({ isMustFind: true, isMustNotFlag: false, matched: true, pass: true }),
      makeCaseScore({ isMustFind: true, isMustNotFlag: false, matched: false, pass: false }),
    ];
    const metrics = aggregateEvalMetrics(scores);
    expect(metrics.recall).toBe(0.5);
  });

  it('recall = 1.0 when all must_find cases matched', () => {
    const scores: CaseScore[] = [
      makeCaseScore({ isMustFind: true, matched: true, pass: true }),
      makeCaseScore({ isMustFind: true, matched: true, pass: true }),
    ];
    expect(aggregateEvalMetrics(scores).recall).toBe(1.0);
  });

  it('recall = 0.0 when no must_find cases matched', () => {
    const scores: CaseScore[] = [
      makeCaseScore({ isMustFind: true, matched: false, pass: false }),
    ];
    expect(aggregateEvalMetrics(scores).recall).toBe(0.0);
  });
});

// ---------------------------------------------------------------------------
// AC-20 — precision
// ---------------------------------------------------------------------------

describe('aggregateEvalMetrics — precision (AC-20)', () => {
  it('precision = 0.5 when TP=1 (matched must_find) and FP=1 (matched must_not_flag)', () => {
    const scores: CaseScore[] = [
      // TP: matched must_find
      makeCaseScore({ isMustFind: true, isMustNotFlag: false, matched: true, pass: true }),
      // FP: matched must_not_flag
      makeCaseScore({ isMustFind: false, isMustNotFlag: true, matched: true, pass: false }),
    ];
    const metrics = aggregateEvalMetrics(scores);
    expect(metrics.precision).toBe(0.5);
  });

  it('precision = 1.0 when TP > 0 and FP = 0 (no must_not_flag cases)', () => {
    const scores: CaseScore[] = [
      makeCaseScore({ isMustFind: true, isMustNotFlag: false, matched: true, pass: true }),
    ];
    expect(aggregateEvalMetrics(scores).precision).toBe(1.0);
  });

  it('extra findings outside labeled spans are NOT false positives (precision unchanged)', () => {
    // Only matched must_not_flag are FP — extra survivors without a matching exp do not count
    const scores: CaseScore[] = [
      // must_not_flag expectation that was NOT matched (= not FP)
      makeCaseScore({ isMustFind: false, isMustNotFlag: true, matched: false, pass: true, survivors: 5 }),
      // must_find matched
      makeCaseScore({ isMustFind: true, isMustNotFlag: false, matched: true, pass: true }),
    ];
    // TP=1, FP=0 → precision = 1.0
    expect(aggregateEvalMetrics(scores).precision).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// AC-21 — citation_accuracy (sum-based, not mean-of-ratios)
// ---------------------------------------------------------------------------

describe('aggregateEvalMetrics — citation_accuracy (AC-21)', () => {
  it('citation_accuracy = 5/8 for survivors [3,2,0] and dropped [1,0,2]', () => {
    // sum(survivors) = 3+2+0 = 5
    // sum(survivors+dropped) = (3+1)+(2+0)+(0+2) = 4+2+2 = 8
    // citation = 5/8 = 0.625
    const scores: CaseScore[] = [
      makeCaseScore({ survivors: 3, dropped: 1 }),
      makeCaseScore({ survivors: 2, dropped: 0 }),
      makeCaseScore({ survivors: 0, dropped: 2 }),
    ];
    const metrics = aggregateEvalMetrics(scores);
    expect(metrics.citation_accuracy).toBeCloseTo(5 / 8);
  });

  it('citation_accuracy differs from mean-of-ratios (verifies sum-based formula)', () => {
    // sum-based: 5/8 = 0.625
    // mean-of-ratios: (3/4 + 2/2 + 0/2) / 3 = (0.75 + 1 + 0) / 3 ≈ 0.583
    const scores: CaseScore[] = [
      makeCaseScore({ survivors: 3, dropped: 1 }),
      makeCaseScore({ survivors: 2, dropped: 0 }),
      makeCaseScore({ survivors: 0, dropped: 2 }),
    ];
    const { citation_accuracy } = aggregateEvalMetrics(scores);
    const meanOfRatios = (3 / 4 + 2 / 2 + 0 / 2) / 3;
    // They must NOT be equal — proves the implementation is sum-based
    expect(citation_accuracy).not.toBeCloseTo(meanOfRatios);
    expect(citation_accuracy).toBeCloseTo(0.625);
  });

  it('citation_accuracy = 1.0 when all findings survived (no drops)', () => {
    const scores: CaseScore[] = [
      makeCaseScore({ survivors: 3, dropped: 0 }),
      makeCaseScore({ survivors: 2, dropped: 0 }),
    ];
    expect(aggregateEvalMetrics(scores).citation_accuracy).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// 0/0 conventions — degenerate denominators must return 1.0 (never NaN or 0)
// ---------------------------------------------------------------------------

describe('aggregateEvalMetrics — 0/0 conventions', () => {
  it('empty scores array → recall=1, precision=1, citation=1, cases_total=0, cases_passed=0', () => {
    const metrics = aggregateEvalMetrics([]);
    expect(metrics.recall).toBe(1.0);
    expect(metrics.precision).toBe(1.0);
    expect(metrics.citation_accuracy).toBe(1.0);
    expect(metrics.cases_total).toBe(0);
    expect(metrics.cases_passed).toBe(0);
  });

  it('only unmatched must_not_flag cases → precision = 1.0 (TP=0, FP=0)', () => {
    const scores: CaseScore[] = [
      makeCaseScore({ isMustFind: false, isMustNotFlag: true, matched: false, pass: true }),
      makeCaseScore({ isMustFind: false, isMustNotFlag: true, matched: false, pass: true }),
    ];
    const metrics = aggregateEvalMetrics(scores);
    expect(metrics.precision).toBe(1.0);
    // recall is also 1.0 because there are zero must_find cases (0/0 → 1.0)
    expect(metrics.recall).toBe(1.0);
  });

  it('all cases have 0 survivors and 0 dropped → citation = 1.0', () => {
    const scores: CaseScore[] = [
      makeCaseScore({ survivors: 0, dropped: 0 }),
    ];
    expect(aggregateEvalMetrics(scores).citation_accuracy).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// cases_passed and cases_total
// ---------------------------------------------------------------------------

describe('aggregateEvalMetrics — cases_passed / cases_total', () => {
  it('counts passing and total cases correctly', () => {
    const scores: CaseScore[] = [
      makeCaseScore({ pass: true }),
      makeCaseScore({ pass: true }),
      makeCaseScore({ pass: false }),
    ];
    const metrics = aggregateEvalMetrics(scores);
    expect(metrics.cases_total).toBe(3);
    expect(metrics.cases_passed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC-22 — Zero-LLM proof: scoring.ts imports only @devdigest/shared
// ---------------------------------------------------------------------------

describe('AC-22 — scoring.ts import purity', () => {
  it('scoring.ts has no imports from container, adapters, or platform', () => {
    // Resolve scoring.ts path relative to this test file
    const testFilePath = fileURLToPath(import.meta.url);
    const testDir = path.dirname(testFilePath);
    const scoringPath = path.resolve(testDir, 'scoring.ts');

    const source = readFileSync(scoringPath, 'utf8');

    // Extract all top-level import lines
    const importLines = source
      .split('\n')
      .filter((line) => line.trimStart().startsWith('import'));

    // Must have at least one import (from @devdigest/shared)
    expect(importLines.length).toBeGreaterThan(0);

    // Must reference @devdigest/shared
    const hasSharedImport = importLines.some((line) => line.includes('@devdigest/shared'));
    expect(hasSharedImport).toBe(true);

    // Must NOT import from forbidden modules
    const forbidden = ['container', 'adapters/llm', 'platform/', 'adapters/mocks'];
    for (const line of importLines) {
      for (const forbiddenTerm of forbidden) {
        expect(line, `Import line "${line}" must not reference "${forbiddenTerm}"`).not.toContain(
          forbiddenTerm,
        );
      }
    }
  });

  it('scoring.ts has no runtime imports (only type imports from @devdigest/shared)', () => {
    const testFilePath = fileURLToPath(import.meta.url);
    const testDir = path.dirname(testFilePath);
    const scoringPath = path.resolve(testDir, 'scoring.ts');

    const source = readFileSync(scoringPath, 'utf8');

    const importLines = source
      .split('\n')
      .filter((line) => line.trimStart().startsWith('import'));

    // All non-type imports must only come from @devdigest/shared
    const runtimeImports = importLines.filter((line) => !line.includes('import type'));
    for (const line of runtimeImports) {
      // If it's not a type import, it must be from @devdigest/shared or have no from clause
      if (line.includes('from ')) {
        expect(line, `Runtime import "${line}" must come from @devdigest/shared`).toContain(
          '@devdigest/shared',
        );
      }
    }
  });
});
