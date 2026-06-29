/**
 * Hermetic unit tests for composeBlast() — compose.ts
 *
 * Pure mapper: BlastResult (repo-intel facade) + IndexState + PriorPr[]
 * → BlastRadius (the shared contract).
 *
 * No DB, no network, no Docker. All inputs are hand-crafted fixtures.
 *
 * Scenarios covered:
 *   C1 — callers grouped per changed symbol (viaSymbol routing)
 *   C2 — input order preserved through filter
 *   C3 — all callers passed through (no cap in compose)
 *   C4 — endpoints_affected / crons_affected from factsByFile (persistent path)
 *   C5 — factsByFile endpoint deduplication across caller files for one symbol
 *   C6 — degraded path: callers present → impactedEndpoints; callers absent → []
 *   C7 — summary exact format including singular/plural
 *   C8 — summary endpoint count from new Set(impactedEndpoints) (deduped)
 *   C9 — status passthrough from state.status
 *   C10 — degraded_reason from state.degradedReason → state.reason → null (full)
 *   C11 — empty input → valid minimal BlastRadius
 *   C12 — prior_prs passthrough
 *   C13 — Zod schema conformance (full / degraded / empty)
 */
import { describe, it, expect } from 'vitest';
import { BlastRadius } from '@devdigest/shared';
import type { BlastResult, IndexState } from '../repo-intel/types.js';
import type { PriorPr } from '@devdigest/shared';
import { composeBlast } from './compose.js';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function mkState(
  overrides: Partial<IndexState> = {},
): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'abc123',
    indexerVersion: 1,
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function mkBlast(overrides: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    ...overrides,
  };
}

function mkPriorPr(overrides: Partial<PriorPr> = {}): PriorPr {
  return {
    number: 1,
    title: 'Some PR',
    pull_id: 'pr-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// C1 — Callers grouped per changed symbol
// ---------------------------------------------------------------------------

describe('composeBlast: callers grouped per changed symbol (C1)', () => {
  it('should assign each caller only to the downstream entry for its viaSymbol', () => {
    const blast = mkBlast({
      changedSymbols: [
        { name: 'foo', file: 'src/foo.ts', kind: 'function' },
        { name: 'bar', file: 'src/bar.ts', kind: 'class' },
      ],
      callers: [
        { file: 'src/a.ts', symbol: 'useFoo', viaSymbol: 'foo', line: 10, rank: 2 },
        { file: 'src/b.ts', symbol: 'useBar', viaSymbol: 'bar', line: 20, rank: 1 },
        { file: 'src/c.ts', symbol: 'alsoFoo', viaSymbol: 'foo', line: 30, rank: 3 },
      ],
      impactedEndpoints: [],
    });

    const result = composeBlast(blast, mkState(), []);

    const fooDn = result.downstream.find((d) => d.symbol === 'foo');
    const barDn = result.downstream.find((d) => d.symbol === 'bar');

    // foo gets its two callers only
    expect(fooDn?.callers.map((c) => c.name)).toEqual(['useFoo', 'alsoFoo']);
    // bar gets its one caller only
    expect(barDn?.callers.map((c) => c.name)).toEqual(['useBar']);
  });

  it('should produce zero callers for a symbol with no callers', () => {
    const blast = mkBlast({
      changedSymbols: [
        { name: 'unused', file: 'src/unused.ts', kind: 'function' },
      ],
      callers: [],
      impactedEndpoints: [],
    });

    const result = composeBlast(blast, mkState(), []);

    expect(result.downstream[0]?.callers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C2 — Input order preserved
// ---------------------------------------------------------------------------

describe('composeBlast: input order preserved (C2)', () => {
  it('should preserve the order of callers as they appear in blast.callers', () => {
    // Ranks intentionally NOT ascending to confirm compose does not re-sort.
    const blast = mkBlast({
      changedSymbols: [{ name: 'fn', file: 'src/fn.ts', kind: 'function' }],
      callers: [
        { file: 'src/z.ts', symbol: 'callZ', viaSymbol: 'fn', line: 99, rank: 1 },
        { file: 'src/a.ts', symbol: 'callA', viaSymbol: 'fn', line: 1,  rank: 5 },
        { file: 'src/m.ts', symbol: 'callM', viaSymbol: 'fn', line: 50, rank: 3 },
      ],
      impactedEndpoints: [],
    });

    const result = composeBlast(blast, mkState(), []);
    const names = result.downstream[0]?.callers.map((c) => c.name);

    // order must match blast.callers, not be sorted by rank/file/line
    expect(names).toEqual(['callZ', 'callA', 'callM']);
  });
});

// ---------------------------------------------------------------------------
// C3 — No cap in compose (all callers pass through)
// ---------------------------------------------------------------------------

describe('composeBlast: no caller cap in compose (C3)', () => {
  it('should pass through all callers when there are more than 20', () => {
    const manyCallers = Array.from({ length: 25 }, (_, i) => ({
      file: `src/caller${i}.ts`,
      symbol: `caller${i}`,
      viaSymbol: 'bigFn',
      line: i + 1,
      rank: i,
    }));

    const blast = mkBlast({
      changedSymbols: [{ name: 'bigFn', file: 'src/big.ts', kind: 'function' }],
      callers: manyCallers,
      impactedEndpoints: [],
    });

    const result = composeBlast(blast, mkState(), []);

    // All 25 callers survive — compose has no cap
    expect(result.downstream[0]?.callers).toHaveLength(25);
  });
});

// ---------------------------------------------------------------------------
// C4 — endpoints_affected / crons_affected from factsByFile (persistent path)
// ---------------------------------------------------------------------------

describe('composeBlast: factsByFile path — endpoints and crons attributed (C4)', () => {
  it('should populate endpoints_affected from factsByFile for each caller file', () => {
    const blast = mkBlast({
      changedSymbols: [{ name: 'service', file: 'src/service.ts', kind: 'class' }],
      callers: [
        { file: 'src/routes/api.ts', symbol: 'apiRoute', viaSymbol: 'service', line: 5, rank: 1 },
      ],
      impactedEndpoints: ['GET /api/users'],
      factsByFile: {
        'src/routes/api.ts': {
          endpoints: ['POST /api/users', 'GET /api/users'],
          crons: [],
        },
      },
    });

    const result = composeBlast(blast, mkState(), []);
    const dn = result.downstream[0];

    expect(dn?.endpoints_affected).toContain('POST /api/users');
    expect(dn?.endpoints_affected).toContain('GET /api/users');
    expect(dn?.crons_affected).toEqual([]);
  });

  it('should populate crons_affected from factsByFile for each caller file', () => {
    const blast = mkBlast({
      changedSymbols: [{ name: 'job', file: 'src/job.ts', kind: 'function' }],
      callers: [
        { file: 'src/scheduler.ts', symbol: 'scheduleJob', viaSymbol: 'job', line: 12, rank: 1 },
      ],
      impactedEndpoints: [],
      factsByFile: {
        'src/scheduler.ts': {
          endpoints: [],
          crons: ['0 * * * * digest', '30 2 * * * cleanup'],
        },
      },
    });

    const result = composeBlast(blast, mkState(), []);
    const dn = result.downstream[0];

    expect(dn?.crons_affected).toContain('0 * * * * digest');
    expect(dn?.crons_affected).toContain('30 2 * * * cleanup');
    expect(dn?.endpoints_affected).toEqual([]);
  });

  it('should produce empty arrays when caller file has no matching entry in factsByFile', () => {
    const blast = mkBlast({
      changedSymbols: [{ name: 'util', file: 'src/util.ts', kind: 'function' }],
      callers: [
        { file: 'src/helper.ts', symbol: 'help', viaSymbol: 'util', line: 1, rank: 0 },
      ],
      impactedEndpoints: ['GET /api/things'],
      factsByFile: {
        // 'src/helper.ts' is NOT in factsByFile
        'src/routes.ts': { endpoints: ['GET /api/things'], crons: [] },
      },
    });

    const result = composeBlast(blast, mkState(), []);
    const dn = result.downstream[0];

    // factsByFile path but caller file absent → empty, not falling through to impactedEndpoints
    expect(dn?.endpoints_affected).toEqual([]);
    expect(dn?.crons_affected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C5 — factsByFile endpoint deduplication across caller files
// ---------------------------------------------------------------------------

describe('composeBlast: factsByFile deduplication (C5)', () => {
  it('should deduplicate endpoints that appear in multiple caller files for the same symbol', () => {
    const blast = mkBlast({
      changedSymbols: [{ name: 'fn', file: 'src/fn.ts', kind: 'function' }],
      callers: [
        { file: 'src/a.ts', symbol: 'callA', viaSymbol: 'fn', line: 1, rank: 1 },
        { file: 'src/b.ts', symbol: 'callB', viaSymbol: 'fn', line: 2, rank: 2 },
      ],
      impactedEndpoints: [],
      factsByFile: {
        'src/a.ts': { endpoints: ['GET /shared', 'POST /a-only'], crons: [] },
        'src/b.ts': { endpoints: ['GET /shared', 'POST /b-only'], crons: [] },
      },
    });

    const result = composeBlast(blast, mkState(), []);
    const endpoints = result.downstream[0]?.endpoints_affected ?? [];

    // 'GET /shared' appears in both files; deduplicated to one entry
    const sharedCount = endpoints.filter((e) => e === 'GET /shared').length;
    expect(sharedCount).toBe(1);
    expect(endpoints).toContain('POST /a-only');
    expect(endpoints).toContain('POST /b-only');
    expect(endpoints).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// C6 — Degraded path (no factsByFile)
// ---------------------------------------------------------------------------

describe('composeBlast: degraded path — no factsByFile (C6)', () => {
  it('should use impactedEndpoints when the symbol has callers and factsByFile is absent', () => {
    const blast = mkBlast({
      changedSymbols: [{ name: 'fn', file: 'src/fn.ts', kind: 'function' }],
      callers: [
        { file: 'src/a.ts', symbol: 'callA', viaSymbol: 'fn', line: 5, rank: 0 },
      ],
      impactedEndpoints: ['GET /api/v1/users', 'POST /api/v1/users'],
      // factsByFile absent
    });

    const result = composeBlast(blast, mkState({ status: 'degraded' }), []);
    const dn = result.downstream[0];

    expect(dn?.endpoints_affected).toContain('GET /api/v1/users');
    expect(dn?.endpoints_affected).toContain('POST /api/v1/users');
    expect(dn?.crons_affected).toEqual([]);
  });

  it('should return empty endpoints_affected when a symbol has no callers (degraded path)', () => {
    const blast = mkBlast({
      changedSymbols: [{ name: 'leaf', file: 'src/leaf.ts', kind: 'function' }],
      callers: [], // no callers
      impactedEndpoints: ['GET /api/x'],
      // factsByFile absent
    });

    const result = composeBlast(blast, mkState({ status: 'degraded' }), []);
    const dn = result.downstream[0];

    // Zero callers → empty, to avoid false positives
    expect(dn?.endpoints_affected).toEqual([]);
    expect(dn?.crons_affected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C7 — Summary exact format including singular/plural
// ---------------------------------------------------------------------------

describe('composeBlast: summary format (C7)', () => {
  it('should format singular counts correctly (1 symbol, 1 caller, 1 endpoint)', () => {
    const blast = mkBlast({
      changedSymbols: [{ name: 'fn', file: 'src/fn.ts', kind: 'function' }],
      callers: [
        { file: 'src/a.ts', symbol: 'callA', viaSymbol: 'fn', line: 1, rank: 0 },
      ],
      impactedEndpoints: ['GET /api/users'],
    });

    const result = composeBlast(blast, mkState(), []);

    expect(result.summary).toBe('1 symbol · 1 caller · 1 endpoint (index: full)');
  });

  it('should format plural counts correctly (2 symbols, 3 callers, 2 endpoints)', () => {
    const blast = mkBlast({
      changedSymbols: [
        { name: 'fn1', file: 'src/fn1.ts', kind: 'function' },
        { name: 'fn2', file: 'src/fn2.ts', kind: 'function' },
      ],
      callers: [
        { file: 'src/a.ts', symbol: 'callA', viaSymbol: 'fn1', line: 1, rank: 0 },
        { file: 'src/b.ts', symbol: 'callB', viaSymbol: 'fn2', line: 2, rank: 0 },
        { file: 'src/c.ts', symbol: 'callC', viaSymbol: 'fn1', line: 3, rank: 0 },
      ],
      impactedEndpoints: ['GET /a', 'POST /b'],
    });

    const result = composeBlast(blast, mkState(), []);

    expect(result.summary).toBe('2 symbols · 3 callers · 2 endpoints (index: full)');
  });

  it('should include the index status in the summary', () => {
    const blast = mkBlast({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
    });

    const result = composeBlast(blast, mkState({ status: 'partial' }), []);

    expect(result.summary).toMatch('(index: partial)');
  });

  it('should be deterministic — same input produces same summary', () => {
    const blast = mkBlast({
      changedSymbols: [{ name: 'fn', file: 'src/fn.ts', kind: 'function' }],
      callers: [
        { file: 'src/a.ts', symbol: 'callA', viaSymbol: 'fn', line: 1, rank: 0 },
      ],
      impactedEndpoints: ['GET /api'],
    });
    const state = mkState();

    const r1 = composeBlast(blast, state, []);
    const r2 = composeBlast(blast, state, []);

    expect(r1.summary).toBe(r2.summary);
  });
});

// ---------------------------------------------------------------------------
// C8 — Summary endpoint count from new Set(impactedEndpoints)
// ---------------------------------------------------------------------------

describe('composeBlast: summary endpoint count is deduplicated (C8)', () => {
  it('should count unique endpoints in the summary even when impactedEndpoints has duplicates', () => {
    const blast = mkBlast({
      changedSymbols: [{ name: 'fn', file: 'src/fn.ts', kind: 'function' }],
      callers: [],
      // Duplicate endpoints — should count as 2, not 3
      impactedEndpoints: ['GET /api/users', 'POST /api/users', 'GET /api/users'],
    });

    const result = composeBlast(blast, mkState(), []);

    // 2 unique endpoints
    expect(result.summary).toContain('2 endpoints');
  });
});

// ---------------------------------------------------------------------------
// C9 — status passthrough from state.status
// ---------------------------------------------------------------------------

describe('composeBlast: status passthrough (C9)', () => {
  it.each(['full', 'partial', 'degraded', 'failed'] as const)(
    'should pass through status "%s" from state',
    (status) => {
      const result = composeBlast(mkBlast(), mkState({ status }), []);
      expect(result.status).toBe(status);
    },
  );
});

// ---------------------------------------------------------------------------
// C10 — degraded_reason resolution
// ---------------------------------------------------------------------------

describe('composeBlast: degraded_reason resolution (C10)', () => {
  it('should be null when status is full', () => {
    const state = mkState({
      status: 'full',
      degradedReason: undefined,
      reason: undefined,
    });

    const result = composeBlast(mkBlast(), state, []);

    expect(result.degraded_reason).toBeNull();
  });

  it('should be null when status is full even if state has a reason string', () => {
    const state = mkState({
      status: 'full',
      reason: 'some reason that should be ignored',
    });

    const result = composeBlast(mkBlast(), state, []);

    expect(result.degraded_reason).toBeNull();
  });

  it('should use state.degradedReason when non-full and degradedReason is set', () => {
    const state = mkState({
      status: 'partial',
      degradedReason: 'index_partial',
    });

    const result = composeBlast(mkBlast(), state, []);

    expect(result.degraded_reason).toBe('index_partial');
  });

  it('should fall back to state.reason when degradedReason is absent and status is non-full', () => {
    const state = mkState({
      status: 'degraded',
      degradedReason: undefined,
      reason: 'ripgrep fallback active',
    });

    const result = composeBlast(mkBlast(), state, []);

    expect(result.degraded_reason).toBe('ripgrep fallback active');
  });

  it('should be null when status is failed and neither degradedReason nor reason is set', () => {
    const state = mkState({
      status: 'failed',
      degradedReason: undefined,
      reason: undefined,
    });

    const result = composeBlast(mkBlast(), state, []);

    expect(result.degraded_reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C11 — Empty input → valid minimal BlastRadius
// ---------------------------------------------------------------------------

describe('composeBlast: empty input (C11)', () => {
  it('should return a valid BlastRadius with empty arrays when blast has no symbols or callers', () => {
    const result = composeBlast(mkBlast(), mkState(), []);

    expect(result.changed_symbols).toEqual([]);
    expect(result.downstream).toEqual([]);
    expect(result.prior_prs).toEqual([]);
    expect(result.degraded_reason).toBeNull();
    expect(result.status).toBe('full');
  });

  it('should produce the correct summary for all-zero counts', () => {
    const result = composeBlast(mkBlast(), mkState(), []);

    expect(result.summary).toBe('0 symbols · 0 callers · 0 endpoints (index: full)');
  });

  it('should not throw when blast has degraded=true but empty arrays', () => {
    const blast = mkBlast({ degraded: true, reason: 'flag_off' });
    const state = mkState({ status: 'degraded', degradedReason: 'flag_off' });

    expect(() => composeBlast(blast, state, [])).not.toThrow();
    const result = composeBlast(blast, state, []);
    expect(result.downstream).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C12 — prior_prs passthrough
// ---------------------------------------------------------------------------

describe('composeBlast: prior_prs passthrough (C12)', () => {
  it('should include prior PRs verbatim in the result', () => {
    const priorPrs: PriorPr[] = [
      { number: 123, title: 'Add auth middleware', pull_id: 'pr-123' },
      { number: 456, title: 'Fix rate limiter', pull_id: 'pr-456' },
    ];

    const result = composeBlast(mkBlast(), mkState(), priorPrs);

    expect(result.prior_prs).toHaveLength(2);
    expect(result.prior_prs[0]).toMatchObject({ number: 123, title: 'Add auth middleware' });
    expect(result.prior_prs[1]).toMatchObject({ number: 456, title: 'Fix rate limiter' });
  });

  it('should return empty prior_prs when none are provided', () => {
    const result = composeBlast(mkBlast(), mkState(), []);

    expect(result.prior_prs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C13 — Zod schema conformance
// ---------------------------------------------------------------------------

describe('composeBlast: Zod schema conformance (C13)', () => {
  it('should produce output that passes BlastRadius.parse() for empty input', () => {
    const result = composeBlast(mkBlast(), mkState(), []);
    expect(() => BlastRadius.parse(result)).not.toThrow();
  });

  it('should produce output that passes BlastRadius.parse() for a full result', () => {
    const blast = mkBlast({
      changedSymbols: [
        { name: 'rateLimit', file: 'src/middleware/rateLimit.ts', kind: 'function' },
      ],
      callers: [
        { file: 'src/app.ts', symbol: 'applyMiddleware', viaSymbol: 'rateLimit', line: 42, rank: 5 },
      ],
      impactedEndpoints: ['POST /api/checkout'],
      factsByFile: {
        'src/app.ts': { endpoints: ['POST /api/checkout'], crons: [] },
      },
    });
    const priorPrs: PriorPr[] = [
      { number: 480, title: 'Add rate limiting', pull_id: 'pr-480' },
    ];

    const result = composeBlast(blast, mkState(), priorPrs);
    expect(() => BlastRadius.parse(result)).not.toThrow();
  });

  it('should produce output that passes BlastRadius.parse() for a degraded result', () => {
    const blast = mkBlast({
      changedSymbols: [{ name: 'fn', file: 'src/fn.ts', kind: 'function' }],
      callers: [
        { file: 'src/a.ts', symbol: 'callA', viaSymbol: 'fn', line: 1, rank: 0 },
      ],
      impactedEndpoints: ['GET /api'],
      degraded: true,
      reason: 'index_failed',
    });
    const state = mkState({
      status: 'degraded',
      degradedReason: 'index_failed',
    });

    const result = composeBlast(blast, state, []);
    expect(() => BlastRadius.parse(result)).not.toThrow();
    expect(result.status).toBe('degraded');
    expect(result.degraded_reason).toBe('index_failed');
  });

  it('should produce output that passes BlastRadius.parse() for a partial result', () => {
    const blast = mkBlast({
      changedSymbols: [{ name: 'fn', file: 'src/fn.ts', kind: 'function' }],
      callers: [],
      impactedEndpoints: [],
    });
    const state = mkState({
      status: 'partial',
      degradedReason: 'index_partial',
    });

    const result = composeBlast(blast, state, []);
    expect(() => BlastRadius.parse(result)).not.toThrow();
    expect(result.status).toBe('partial');
  });
});
