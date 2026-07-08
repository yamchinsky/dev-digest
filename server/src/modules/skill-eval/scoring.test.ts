import { describe, it, expect } from 'vitest';
import { firstMatch, finalize, emptyAgg } from './scoring.js';

describe('skill-eval scoring — firstMatch (code-only grading)', () => {
  it('matches a regex pattern case-insensitively and returns a snippet', () => {
    const text = 'The uncovered ELSE branch at discount.ts:4 needs a test.';
    const hit = firstMatch(text, ['else', 'branch']);
    expect(hit).not.toBeNull();
    expect(hit!.toLowerCase()).toContain('else');
  });

  it('returns null when no pattern matches', () => {
    expect(firstMatch('nothing relevant here', ['boundary', 'regression'])).toBeNull();
  });

  it('tries every pattern (matches on a later one)', () => {
    const hit = firstMatch('cites guard.ts:12', ['missing', 'guard\\.ts']);
    expect(hit).not.toBeNull();
    expect(hit).toContain('guard.ts');
  });

  it('falls back to a literal substring on an invalid regex source', () => {
    // '(' is an invalid RegExp; must not throw, must find the literal.
    const hit = firstMatch('call superRefine( here', ['superRefine(']);
    expect(hit).not.toBeNull();
  });
});

describe('skill-eval scoring — finalize', () => {
  it('computes pass_rate = passed / total', () => {
    const m = finalize({ checks_passed: 4, checks_total: 7, duration_ms: 66_000, tokens: 16_346 });
    expect(m.pass_rate).toBeCloseTo(4 / 7);
    expect(m.checks_passed).toBe(4);
    expect(m.tokens).toBe(16_346);
  });

  it('returns pass_rate 1 when there are no checks (no division by zero)', () => {
    expect(finalize(emptyAgg()).pass_rate).toBe(1);
  });
});
