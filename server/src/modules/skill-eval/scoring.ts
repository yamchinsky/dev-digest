import type { SkillBenchmarkMetrics } from '@devdigest/shared';

/**
 * Skill benchmark scoring — PURE, CODE-ONLY. No LLM, no I/O.
 *
 * A config "passes" an aspect if any of the aspect's literal patterns matches
 * the config's output text. Invalid regex sources fall back to a literal
 * (case-insensitive) substring test — so a hand-written pattern that isn't a
 * valid RegExp still does something sensible instead of throwing.
 */

/** Running aggregate for one configuration, folded into metrics by `finalize`. */
export interface BenchmarkAgg {
  checks_passed: number;
  checks_total: number;
  duration_ms: number;
  tokens: number;
}

export function emptyAgg(): BenchmarkAgg {
  return { checks_passed: 0, checks_total: 0, duration_ms: 0, tokens: 0 };
}

/**
 * Returns a short evidence snippet around the first matching pattern, or null
 * if none match. The snippet is whitespace-collapsed for display.
 */
export function firstMatch(text: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    let idx = -1;
    try {
      const m = new RegExp(pattern, 'i').exec(text);
      if (m) idx = m.index;
    } catch {
      idx = text.toLowerCase().indexOf(pattern.toLowerCase());
    }
    if (idx >= 0) {
      const start = Math.max(0, idx - 24);
      const snippet = text.slice(start, idx + 56).replace(/\s+/g, ' ').trim();
      return snippet.length > 0 ? snippet : pattern;
    }
  }
  return null;
}

/** Fold an aggregate into the public metrics shape (pass_rate is 1 on 0 checks). */
export function finalize(agg: BenchmarkAgg): SkillBenchmarkMetrics {
  return {
    checks_passed: agg.checks_passed,
    checks_total: agg.checks_total,
    pass_rate: agg.checks_total > 0 ? agg.checks_passed / agg.checks_total : 1,
    duration_ms: agg.duration_ms,
    tokens: agg.tokens,
  };
}
