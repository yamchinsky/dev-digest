/**
 * Hermetic unit tests for smart-diff.ts — classifyPath + composeSmartDiff.
 *
 * No DB, no Docker, no network. Covers:
 *   R1 — classifyPath: lockfiles, generated dirs, boilerplate extensions,
 *         wiring patterns, core fallback, precedence boilerplate>wiring>core.
 *   R2 — composeSmartDiff: group ordering, finding_lines join, split threshold,
 *         proposed_splits logic, SmartDiff Zod schema validation.
 */
import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { LOCKFILES, SPLIT_TOO_BIG_LINES } from './smart-diff.constants.js';
import { classifyPath, composeSmartDiff, type PrFileInput, type FindingInput } from './smart-diff.js';

/** Build a FindingInput with stable defaults; tests that care override id/severity. */
let findingSeq = 0;
function mkFinding(
  file: string,
  start_line: number,
  overrides: Partial<FindingInput> = {},
): FindingInput {
  return {
    id: overrides.id ?? `finding-${findingSeq++}`,
    file,
    start_line,
    end_line: overrides.end_line ?? null,
    severity: overrides.severity ?? 'WARNING',
  };
}

// ---------------------------------------------------------------------------
// classifyPath — lockfiles (R1: every entry in LOCKFILES → boilerplate)
// ---------------------------------------------------------------------------

describe('classifyPath: lockfiles', () => {
  it('should classify every lockfile basename as boilerplate', () => {
    for (const lockfile of LOCKFILES) {
      expect(classifyPath(lockfile), `lockfile: ${lockfile}`).toBe('boilerplate');
      // Also when nested in a directory
      expect(classifyPath(`packages/server/${lockfile}`), `nested: packages/server/${lockfile}`).toBe('boilerplate');
    }
  });

  it('should classify package-lock.json as boilerplate (spot-check)', () => {
    expect(classifyPath('package-lock.json')).toBe('boilerplate');
  });

  it('should classify pnpm-lock.yaml as boilerplate (spot-check)', () => {
    expect(classifyPath('pnpm-lock.yaml')).toBe('boilerplate');
  });

  it('should classify yarn.lock as boilerplate (spot-check)', () => {
    expect(classifyPath('yarn.lock')).toBe('boilerplate');
  });

  it('should classify Cargo.lock as boilerplate (spot-check)', () => {
    expect(classifyPath('Cargo.lock')).toBe('boilerplate');
  });

  it('should classify go.sum as boilerplate (spot-check)', () => {
    expect(classifyPath('go.sum')).toBe('boilerplate');
  });
});

// ---------------------------------------------------------------------------
// classifyPath — generated / artifact directories
// ---------------------------------------------------------------------------

describe('classifyPath: generated directory paths', () => {
  it('should classify dist/x.js as boilerplate', () => {
    expect(classifyPath('dist/x.js')).toBe('boilerplate');
  });

  it('should classify coverage/y.ts as boilerplate', () => {
    expect(classifyPath('coverage/y.ts')).toBe('boilerplate');
  });

  it('should classify build/index.js as boilerplate', () => {
    expect(classifyPath('build/index.js')).toBe('boilerplate');
  });

  it('should classify .next/server/app/page.js as boilerplate', () => {
    expect(classifyPath('.next/server/app/page.js')).toBe('boilerplate');
  });

  it('should classify src/vendor/node_modules/lib/index.js as boilerplate', () => {
    expect(classifyPath('src/vendor/node_modules/lib/index.js')).toBe('boilerplate');
  });

  it('should classify __generated__/types.ts as boilerplate', () => {
    expect(classifyPath('__generated__/types.ts')).toBe('boilerplate');
  });

  it('should classify __snapshots__/Button.snap as boilerplate', () => {
    expect(classifyPath('__snapshots__/Button.snap')).toBe('boilerplate');
  });
});

// ---------------------------------------------------------------------------
// classifyPath — boilerplate extensions (.snap, .svg, maps, etc.)
// ---------------------------------------------------------------------------

describe('classifyPath: boilerplate extensions', () => {
  it('should classify a.snap as boilerplate', () => {
    expect(classifyPath('a.snap')).toBe('boilerplate');
  });

  it('should classify logo.svg as boilerplate', () => {
    expect(classifyPath('logo.svg')).toBe('boilerplate');
  });

  it('should classify bundle.min.js as boilerplate', () => {
    expect(classifyPath('bundle.min.js')).toBe('boilerplate');
  });

  it('should classify styles.map as boilerplate', () => {
    expect(classifyPath('styles.map')).toBe('boilerplate');
  });

  it('should classify favicon.ico as boilerplate', () => {
    expect(classifyPath('favicon.ico')).toBe('boilerplate');
  });

  it('should classify banner.png as boilerplate', () => {
    expect(classifyPath('banner.png')).toBe('boilerplate');
  });

  it('should classify font.woff2 as boilerplate', () => {
    expect(classifyPath('font.woff2')).toBe('boilerplate');
  });
});

// ---------------------------------------------------------------------------
// classifyPath — wiring
// ---------------------------------------------------------------------------

describe('classifyPath: wiring', () => {
  it('should classify tsconfig.json as wiring', () => {
    expect(classifyPath('tsconfig.json')).toBe('wiring');
  });

  it('should classify tsconfig.base.json as wiring', () => {
    expect(classifyPath('tsconfig.base.json')).toBe('wiring');
  });

  it('should classify vite.config.ts as wiring', () => {
    expect(classifyPath('vite.config.ts')).toBe('wiring');
  });

  it('should classify eslint.config.js as wiring', () => {
    expect(classifyPath('eslint.config.js')).toBe('wiring');
  });

  it('should classify .github/workflows/ci.yml as wiring', () => {
    expect(classifyPath('.github/workflows/ci.yml')).toBe('wiring');
  });

  it('should classify src/foo.test.ts as wiring', () => {
    expect(classifyPath('src/foo.test.ts')).toBe('wiring');
  });

  it('should classify src/foo.spec.ts as wiring', () => {
    expect(classifyPath('src/foo.spec.ts')).toBe('wiring');
  });

  it('should classify src/foo.it.test.ts as wiring', () => {
    expect(classifyPath('src/foo.it.test.ts')).toBe('wiring');
  });

  it('should classify src/index.ts (barrel) as wiring', () => {
    expect(classifyPath('src/index.ts')).toBe('wiring');
  });

  it('should classify src/index.tsx (barrel) as wiring', () => {
    expect(classifyPath('src/index.tsx')).toBe('wiring');
  });

  it('should classify README.md as wiring', () => {
    expect(classifyPath('README.md')).toBe('wiring');
  });

  it('should classify docs/guide.mdx as wiring', () => {
    expect(classifyPath('docs/guide.mdx')).toBe('wiring');
  });

  it('should classify Dockerfile as wiring', () => {
    expect(classifyPath('Dockerfile')).toBe('wiring');
  });

  it('should classify docker-compose.yml as wiring', () => {
    expect(classifyPath('docker-compose.yml')).toBe('wiring');
  });

  it('should classify .env.example as wiring', () => {
    expect(classifyPath('.env.example')).toBe('wiring');
  });

  it('should classify package.json as wiring', () => {
    expect(classifyPath('package.json')).toBe('wiring');
  });

  it('should classify migrations/001_init.sql as wiring (migrations dir)', () => {
    expect(classifyPath('migrations/001_init.sql')).toBe('wiring');
  });

  it('should classify messages/en/common.json as wiring (messages dir)', () => {
    expect(classifyPath('messages/en/common.json')).toBe('wiring');
  });
});

// ---------------------------------------------------------------------------
// classifyPath — core
// ---------------------------------------------------------------------------

describe('classifyPath: core', () => {
  it('should classify server/src/modules/reviews/service.ts as core', () => {
    expect(classifyPath('server/src/modules/reviews/service.ts')).toBe('core');
  });

  it('should classify client/src/app/page.tsx as core', () => {
    expect(classifyPath('client/src/app/page.tsx')).toBe('core');
  });

  it('should classify src/middleware/ratelimit.ts as core', () => {
    expect(classifyPath('src/middleware/ratelimit.ts')).toBe('core');
  });

  it('should classify src/api/users.ts as core', () => {
    expect(classifyPath('src/api/users.ts')).toBe('core');
  });
});

// ---------------------------------------------------------------------------
// classifyPath — precedence (boilerplate > wiring > core)
// ---------------------------------------------------------------------------

describe('classifyPath: precedence', () => {
  it('should classify dist/index.ts as boilerplate (generated dir beats wiring barrel)', () => {
    // dist/ → GENERATED_DIRS matches before barrel logic for index.ts
    expect(classifyPath('dist/index.ts')).toBe('boilerplate');
  });

  it('should classify coverage/foo.test.ts as boilerplate (generated dir beats wiring test)', () => {
    // coverage/ → GENERATED_DIRS matches before TEST_RE
    expect(classifyPath('coverage/foo.test.ts')).toBe('boilerplate');
  });

  it('should classify dist/README.md as boilerplate (generated dir beats doc extension)', () => {
    expect(classifyPath('dist/README.md')).toBe('boilerplate');
  });

  it('should classify src/config.ts as core (not a wiring config basename)', () => {
    // config.ts does NOT match WIRING_CONFIG_RE which requires *.config.(js|ts|mjs|cjs)
    // src/config.ts has basename config.ts — it matches vite.config.ts style
    // but WIRING_CONFIG_RE is /^.*\.config\.(js|ts|...)$/ — "config.ts" matches
    // because "config" is not preceded by a dot → the regex requires "*.config.X"
    // so "config.ts" → the basename part before ".ts" is "config" not "*.config"
    // WIRING_CONFIG_RE: /^(tsconfig.*\.json|...|.*\.config\.(js|ts|mjs|cjs)|...)$/i
    // "config.ts" does NOT match ".*\.config\.(js|ts|mjs|cjs)" — ".*\.config" requires
    // a "." before "config", and "config.ts" starts with "config" not ".config"
    expect(classifyPath('src/config.ts')).toBe('core');
  });

  it('should classify .github/README.md as wiring (wiring dir wins, doc ext also wiring — consistent)', () => {
    // Both .github dir → wiring AND .md ext → wiring. Result is wiring regardless of order.
    expect(classifyPath('.github/README.md')).toBe('wiring');
  });
});

// ---------------------------------------------------------------------------
// composeSmartDiff — group ordering
// ---------------------------------------------------------------------------

describe('composeSmartDiff: group ordering', () => {
  it('should emit groups in core→wiring→boilerplate order when all roles are present', () => {
    const files: PrFileInput[] = [
      { path: 'pnpm-lock.yaml', additions: 5, deletions: 5 },
      { path: 'src/index.ts', additions: 3, deletions: 1 },
      { path: 'src/service.ts', additions: 20, deletions: 5 },
    ];
    const result = composeSmartDiff(files, []);

    expect(result.groups).toHaveLength(3);
    expect(result.groups[0]?.role).toBe('core');
    expect(result.groups[1]?.role).toBe('wiring');
    expect(result.groups[2]?.role).toBe('boilerplate');
  });

  it('should omit empty groups when some roles have no files', () => {
    const files: PrFileInput[] = [
      { path: 'src/service.ts', additions: 10, deletions: 2 },
    ];
    const result = composeSmartDiff(files, []);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.role).toBe('core');
  });

  it('should emit only wiring and boilerplate when no core files are present', () => {
    const files: PrFileInput[] = [
      { path: 'pnpm-lock.yaml', additions: 1, deletions: 0 },
      { path: 'tsconfig.json', additions: 2, deletions: 0 },
    ];
    const result = composeSmartDiff(files, []);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.role).toBe('wiring');
    expect(result.groups[1]?.role).toBe('boilerplate');
  });

  it('should sort files within a group by descending total lines, tie-break by path ascending', () => {
    const files: PrFileInput[] = [
      { path: 'src/a.ts', additions: 5, deletions: 5 },   // 10 total
      { path: 'src/b.ts', additions: 20, deletions: 0 },  // 20 total
      { path: 'src/c.ts', additions: 5, deletions: 5 },   // 10 total
    ];
    const result = composeSmartDiff(files, []);

    const coreFiles = result.groups[0]?.files ?? [];
    expect(coreFiles[0]?.path).toBe('src/b.ts');   // largest (20)
    expect(coreFiles[1]?.path).toBe('src/a.ts');   // tie (10), a < c
    expect(coreFiles[2]?.path).toBe('src/c.ts');   // tie (10), c > a
  });
});

// ---------------------------------------------------------------------------
// composeSmartDiff — finding_lines join
// ---------------------------------------------------------------------------

describe('composeSmartDiff: finding_lines', () => {
  it('should populate finding_lines with sorted deduped start_lines for matching file', () => {
    const files: PrFileInput[] = [{ path: 'src/service.ts', additions: 10, deletions: 2 }];
    const findings: FindingInput[] = [
      mkFinding('src/service.ts', 42),
      mkFinding('src/service.ts', 10),
      mkFinding('src/service.ts', 42), // duplicate line — deduped in finding_lines
    ];

    const result = composeSmartDiff(files, findings);
    const coreFile = result.groups[0]?.files[0];

    expect(coreFile?.finding_lines).toEqual([10, 42]);
  });

  it('should return empty finding_lines for files with no matching findings', () => {
    const files: PrFileInput[] = [
      { path: 'src/service.ts', additions: 10, deletions: 2 },
      { path: 'pnpm-lock.yaml', additions: 5, deletions: 5 },
    ];
    const findings: FindingInput[] = [
      mkFinding('src/service.ts', 15),
    ];

    const result = composeSmartDiff(files, findings);
    // boilerplate group
    const boilerplateGroup = result.groups.find((g) => g.role === 'boilerplate');
    expect(boilerplateGroup?.files[0]?.finding_lines).toEqual([]);
  });

  it('should not cross-contaminate finding_lines between different files', () => {
    const files: PrFileInput[] = [
      { path: 'src/a.ts', additions: 5, deletions: 0 },
      { path: 'src/b.ts', additions: 5, deletions: 0 },
    ];
    const findings: FindingInput[] = [
      mkFinding('src/a.ts', 7),
      mkFinding('src/b.ts', 99),
    ];

    const result = composeSmartDiff(files, findings);
    const coreFiles = result.groups[0]?.files ?? [];
    const fileA = coreFiles.find((f) => f.path === 'src/a.ts');
    const fileB = coreFiles.find((f) => f.path === 'src/b.ts');

    expect(fileA?.finding_lines).toEqual([7]);
    expect(fileB?.finding_lines).toEqual([99]);
  });

  it('should ignore findings whose file does not match any prFile path', () => {
    const files: PrFileInput[] = [{ path: 'src/service.ts', additions: 5, deletions: 0 }];
    const findings: FindingInput[] = [
      mkFinding('src/other.ts', 1), // different path
    ];

    const result = composeSmartDiff(files, findings);
    const coreFile = result.groups[0]?.files[0];
    expect(coreFile?.finding_lines).toEqual([]);
  });

  it('should always set pseudocode_summary to null', () => {
    const files: PrFileInput[] = [{ path: 'src/service.ts', additions: 5, deletions: 0 }];
    const result = composeSmartDiff(files, []);

    for (const group of result.groups) {
      for (const file of group.files) {
        expect(file.pseudocode_summary).toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// composeSmartDiff — findings (id + severity, for the clickable in-diff badge)
// ---------------------------------------------------------------------------

describe('composeSmartDiff: findings (id + severity)', () => {
  it('should carry id + severity per finding for the matching file', () => {
    const files: PrFileInput[] = [{ path: 'src/service.ts', additions: 10, deletions: 2 }];
    const findings: FindingInput[] = [
      mkFinding('src/service.ts', 42, { id: 'f-crit', severity: 'CRITICAL' }),
      mkFinding('src/service.ts', 10, { id: 'f-warn', severity: 'WARNING' }),
    ];

    const coreFile = composeSmartDiff(files, findings).groups[0]?.files[0];

    // Sorted by start_line: line 10 (warn) before line 42 (crit).
    expect(coreFile?.findings).toEqual([
      { id: 'f-warn', start_line: 10, severity: 'WARNING' },
      { id: 'f-crit', start_line: 42, severity: 'CRITICAL' },
    ]);
  });

  it('should NOT dedupe findings on the same line (unlike finding_lines)', () => {
    const files: PrFileInput[] = [{ path: 'src/service.ts', additions: 5, deletions: 0 }];
    const findings: FindingInput[] = [
      mkFinding('src/service.ts', 12, { id: 'a-second', severity: 'WARNING' }),
      mkFinding('src/service.ts', 12, { id: 'a-first', severity: 'CRITICAL' }),
    ];

    const coreFile = composeSmartDiff(files, findings).groups[0]?.files[0];

    // finding_lines dedupes the shared line; findings keeps BOTH, tie-broken by id.
    expect(coreFile?.finding_lines).toEqual([12]);
    expect(coreFile?.findings.map((f) => f.id)).toEqual(['a-first', 'a-second']);
  });

  it('should default findings to [] when a file has none (and pass Zod parse)', () => {
    const files: PrFileInput[] = [{ path: 'src/service.ts', additions: 5, deletions: 0 }];
    const result = composeSmartDiff(files, []);

    expect(result.groups[0]?.files[0]?.findings).toEqual([]);
    // .default([]) on the contract keeps payloads omitting `findings` parseable.
    const stripped = {
      ...result,
      groups: result.groups.map((g) => ({
        ...g,
        files: g.files.map(({ findings: _drop, ...rest }) => rest),
      })),
    };
    expect(() => SmartDiff.parse(stripped)).not.toThrow();
    expect(SmartDiff.parse(stripped).groups[0]?.files[0]?.findings).toEqual([]);
  });

  it('should not cross-contaminate findings between different files', () => {
    const files: PrFileInput[] = [
      { path: 'src/a.ts', additions: 5, deletions: 0 },
      { path: 'src/b.ts', additions: 5, deletions: 0 },
    ];
    const findings: FindingInput[] = [
      mkFinding('src/a.ts', 7, { id: 'a1' }),
      mkFinding('src/b.ts', 99, { id: 'b1' }),
    ];

    const coreFiles = composeSmartDiff(files, findings).groups[0]?.files ?? [];
    expect(coreFiles.find((f) => f.path === 'src/a.ts')?.findings.map((f) => f.id)).toEqual(['a1']);
    expect(coreFiles.find((f) => f.path === 'src/b.ts')?.findings.map((f) => f.id)).toEqual(['b1']);
  });
});

// ---------------------------------------------------------------------------
// composeSmartDiff — split_suggestion threshold (R2)
// ---------------------------------------------------------------------------

describe('composeSmartDiff: split_suggestion threshold', () => {
  it('should have too_big=false when total lines exactly equal SPLIT_TOO_BIG_LINES', () => {
    // total_lines = SPLIT_TOO_BIG_LINES is NOT too big (> threshold, not >=)
    const files: PrFileInput[] = [
      { path: 'src/a.ts', additions: SPLIT_TOO_BIG_LINES, deletions: 0 },
    ];
    const result = composeSmartDiff(files, []);

    expect(result.split_suggestion.total_lines).toBe(SPLIT_TOO_BIG_LINES);
    expect(result.split_suggestion.too_big).toBe(false);
  });

  it('should have too_big=false when total lines are just under SPLIT_TOO_BIG_LINES', () => {
    const files: PrFileInput[] = [
      { path: 'src/a.ts', additions: SPLIT_TOO_BIG_LINES - 1, deletions: 0 },
    ];
    const result = composeSmartDiff(files, []);

    expect(result.split_suggestion.too_big).toBe(false);
    expect(result.split_suggestion.total_lines).toBe(SPLIT_TOO_BIG_LINES - 1);
  });

  it('should have too_big=true when total lines are just over SPLIT_TOO_BIG_LINES', () => {
    const files: PrFileInput[] = [
      { path: 'src/a.ts', additions: SPLIT_TOO_BIG_LINES + 1, deletions: 0 },
    ];
    const result = composeSmartDiff(files, []);

    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.total_lines).toBe(SPLIT_TOO_BIG_LINES + 1);
  });

  it('should compute total_lines as sum of additions+deletions across all files', () => {
    const files: PrFileInput[] = [
      { path: 'src/a.ts', additions: 100, deletions: 50 },
      { path: 'pnpm-lock.yaml', additions: 200, deletions: 100 },
      { path: 'tsconfig.json', additions: 10, deletions: 0 },
    ];
    const result = composeSmartDiff(files, []);

    expect(result.split_suggestion.total_lines).toBe(460);
  });
});

// ---------------------------------------------------------------------------
// composeSmartDiff — proposed_splits logic (R2)
// ---------------------------------------------------------------------------

describe('composeSmartDiff: proposed_splits', () => {
  it('should emit proposed_splits when too_big AND ≥2 distinct top-dirs among core files', () => {
    // Build a set that exceeds the threshold and has core files in 2+ top-dirs
    const base = SPLIT_TOO_BIG_LINES + 10;
    const files: PrFileInput[] = [
      { path: 'server/service.ts', additions: Math.floor(base / 2), deletions: 0 },
      { path: 'client/page.tsx', additions: Math.ceil(base / 2), deletions: 0 },
    ];
    const result = composeSmartDiff(files, []);

    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.proposed_splits.length).toBeGreaterThanOrEqual(2);

    const names = result.split_suggestion.proposed_splits.map((s) => s.name);
    expect(names).toContain('server');
    expect(names).toContain('client');
  });

  it('should return proposed_splits=[] when too_big but only 1 top-dir among core files', () => {
    const files: PrFileInput[] = [
      { path: 'server/service.ts', additions: 300, deletions: 0 },
      { path: 'server/repository.ts', additions: 202, deletions: 0 },
      // total = 502 > 500, but both in 'server'
    ];
    const result = composeSmartDiff(files, []);

    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.proposed_splits).toEqual([]);
  });

  it('should return proposed_splits=[] when not too_big even with multiple top-dirs', () => {
    const files: PrFileInput[] = [
      { path: 'server/service.ts', additions: 50, deletions: 0 },
      { path: 'client/page.tsx', additions: 50, deletions: 0 },
    ];
    const result = composeSmartDiff(files, []);

    expect(result.split_suggestion.too_big).toBe(false);
    expect(result.split_suggestion.proposed_splits).toEqual([]);
  });

  it('should list files in each proposed split matching the top-dir', () => {
    const base = SPLIT_TOO_BIG_LINES + 10;
    const files: PrFileInput[] = [
      { path: 'server/service.ts', additions: 50, deletions: 0 },
      { path: 'server/repository.ts', additions: 50, deletions: 0 },
      { path: 'client/page.tsx', additions: base, deletions: 0 },
    ];
    const result = composeSmartDiff(files, []);

    expect(result.split_suggestion.too_big).toBe(true);

    const serverSplit = result.split_suggestion.proposed_splits.find((s) => s.name === 'server');
    const clientSplit = result.split_suggestion.proposed_splits.find((s) => s.name === 'client');

    expect(serverSplit?.files).toContain('server/service.ts');
    expect(serverSplit?.files).toContain('server/repository.ts');
    expect(clientSplit?.files).toContain('client/page.tsx');
  });

  it('should sort proposed_splits by descending total lines', () => {
    const base = SPLIT_TOO_BIG_LINES + 10;
    const files: PrFileInput[] = [
      { path: 'client/page.tsx', additions: 10, deletions: 0 },
      { path: 'server/service.ts', additions: base, deletions: 0 },
    ];
    const result = composeSmartDiff(files, []);

    const splits = result.split_suggestion.proposed_splits;
    // server has more lines — should come first
    expect(splits[0]?.name).toBe('server');
    expect(splits[1]?.name).toBe('client');
  });
});

// ---------------------------------------------------------------------------
// composeSmartDiff — SmartDiff Zod schema validation (R2)
// ---------------------------------------------------------------------------

describe('composeSmartDiff: Zod schema conformance', () => {
  it('should produce an output that passes SmartDiff.parse() — empty input', () => {
    const result = composeSmartDiff([], []);
    expect(() => SmartDiff.parse(result)).not.toThrow();
  });

  it('should produce an output that passes SmartDiff.parse() — mixed roles with findings', () => {
    const files: PrFileInput[] = [
      { path: 'src/service.ts', additions: 20, deletions: 5 },
      { path: 'tsconfig.json', additions: 2, deletions: 0 },
      { path: 'pnpm-lock.yaml', additions: 1, deletions: 0 },
    ];
    const findings: FindingInput[] = [
      mkFinding('src/service.ts', 10),
      mkFinding('src/service.ts', 30),
    ];
    const result = composeSmartDiff(files, findings);
    expect(() => SmartDiff.parse(result)).not.toThrow();
  });

  it('should produce an output that passes SmartDiff.parse() — too_big with proposed_splits', () => {
    const base = SPLIT_TOO_BIG_LINES + 10;
    const files: PrFileInput[] = [
      { path: 'server/service.ts', additions: Math.floor(base / 2), deletions: 0 },
      { path: 'client/page.tsx', additions: Math.ceil(base / 2), deletions: 0 },
    ];
    const result = composeSmartDiff(files, []);
    expect(() => SmartDiff.parse(result)).not.toThrow();
  });
});
