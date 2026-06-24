/**
 * T2 unit tests:
 *
 * 1. assemblePrompt — intent slot:
 *    - intent supplied → `## Derived intent / scope` block + scope-discipline
 *      rule appear in the user message; `assembly.intent` is set.
 *    - intent absent/empty → section omitted; `assembly.intent === null`.
 *
 * 2. formatChangedFilesWithHunkHeaders:
 *    - Output contains file paths and `@@` hunk headers.
 *    - Output does NOT contain any added/removed/context line bodies.
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';
import { formatChangedFilesWithHunkHeaders } from '../src/intent-input.js';
import type { UnifiedDiff } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// assemblePrompt — intent slot
// ---------------------------------------------------------------------------

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[1]!.content;
}

describe('assemblePrompt — ## Derived intent / scope', () => {
  const BASE = { system: 'sys', diff: 'DIFF' } as const;

  it('renders the intent block (untrusted-wrapped) and scope-discipline rule when intent is supplied', () => {
    const intent = 'Add OAuth2 login via GitHub';
    const { messages, assembly } = assemblePrompt({ ...BASE, intent });

    const user = messages[1]!.content;

    // Section header present
    expect(user).toContain('## Derived intent / scope');
    // Untrusted delimiter wraps the intent text
    expect(user).toContain('<untrusted source="derived-intent">');
    expect(user).toContain(intent);
    // Scope-discipline rule is present in the same section
    expect(user).toContain('Stay within the stated intent/scope');
    expect(user).toContain('emit ONE signal finding');

    // Section appears BEFORE the diff
    expect(user.indexOf('## Derived intent / scope')).toBeLessThan(
      user.indexOf('## Diff to review'),
    );

    // assembly.intent is set
    expect(assembly.intent).toBe(intent);
  });

  it('section appears AFTER ## PR description when both are present', () => {
    const user = userOf({
      ...BASE,
      prDescription: 'some PR body',
      intent: 'fix memory leak in connection pool',
    });

    const descIdx = user.indexOf('## PR description');
    const intentIdx = user.indexOf('## Derived intent / scope');
    const diffIdx = user.indexOf('## Diff to review');

    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(intentIdx).toBeGreaterThan(descIdx);
    expect(intentIdx).toBeLessThan(diffIdx);
  });

  it('omits the section when intent is undefined (no behaviour change)', () => {
    const user = userOf(BASE);
    expect(user).not.toContain('## Derived intent / scope');
    expect(assemblePrompt(BASE).assembly.intent).toBeNull();
  });

  it('omits the section when intent is an empty string', () => {
    const user = userOf({ ...BASE, intent: '' });
    expect(user).not.toContain('## Derived intent / scope');
    expect(assemblePrompt({ ...BASE, intent: '' }).assembly.intent).toBeNull();
  });

  it('omits the section when intent is whitespace-only', () => {
    const user = userOf({ ...BASE, intent: '   ' });
    expect(user).not.toContain('## Derived intent / scope');
  });

  it('assembly.intent is null when intent is absent', () => {
    expect(assemblePrompt(BASE).assembly.intent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatChangedFilesWithHunkHeaders
// ---------------------------------------------------------------------------

/**
 * A realistic UnifiedDiff where the hunks carry newLineNumbers and the raw
 * string includes actual diff lines (added/removed/context). The formatter
 * must emit paths + @@ lines and NOTHING from the line bodies.
 */
const SAMPLE_DIFF: UnifiedDiff = {
  raw:
    'diff --git a/src/auth.ts b/src/auth.ts\n' +
    '--- a/src/auth.ts\n' +
    '+++ b/src/auth.ts\n' +
    '@@ -12,3 +12,5 @@\n' +
    ' const foo = 1;\n' +
    '-const bar = 2;\n' +
    '+const bar = 3;\n' +
    '+const baz = 4;\n' +
    '\n' +
    'diff --git a/src/util.ts b/src/util.ts\n' +
    '--- a/src/util.ts\n' +
    '+++ b/src/util.ts\n' +
    '@@ -1,2 +1,3 @@\n' +
    '+import x from "x";\n' +
    ' import y from "y";\n',
  files: [
    {
      path: 'src/auth.ts',
      additions: 2,
      deletions: 1,
      hunks: [
        {
          file: 'src/auth.ts',
          oldStart: 12,
          oldLines: 3,
          newStart: 12,
          newLines: 5,
          newLineNumbers: [12, 13, 14, 15, 16],
        },
      ],
    },
    {
      path: 'src/util.ts',
      additions: 1,
      deletions: 0,
      hunks: [
        {
          file: 'src/util.ts',
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 3,
          newLineNumbers: [1, 2, 3],
        },
      ],
    },
  ],
};

describe('formatChangedFilesWithHunkHeaders', () => {
  it('includes file paths in the output', () => {
    const result = formatChangedFilesWithHunkHeaders(SAMPLE_DIFF);
    expect(result).toContain('src/auth.ts');
    expect(result).toContain('src/util.ts');
  });

  it('includes reconstructed @@ hunk headers', () => {
    const result = formatChangedFilesWithHunkHeaders(SAMPLE_DIFF);
    expect(result).toContain('@@ -12,3 +12,5 @@');
    expect(result).toContain('@@ -1,2 +1,3 @@');
  });

  it('does NOT contain any added-line content (+)', () => {
    const result = formatChangedFilesWithHunkHeaders(SAMPLE_DIFF);
    expect(result).not.toContain('const bar = 3');
    expect(result).not.toContain('const baz = 4');
    expect(result).not.toContain('import x from');
  });

  it('does NOT contain any removed-line content (-)', () => {
    const result = formatChangedFilesWithHunkHeaders(SAMPLE_DIFF);
    expect(result).not.toContain('const bar = 2');
  });

  it('does NOT contain context lines', () => {
    const result = formatChangedFilesWithHunkHeaders(SAMPLE_DIFF);
    expect(result).not.toContain('const foo = 1');
    expect(result).not.toContain('import y from');
  });

  it('does NOT include diff.raw or any line prefixes (+ / - / space)', () => {
    const result = formatChangedFilesWithHunkHeaders(SAMPLE_DIFF);
    // The raw diff header lines start with "diff --git" — should not appear
    expect(result).not.toContain('diff --git');
    // No --- or +++ headers
    expect(result).not.toContain('--- a/');
    expect(result).not.toContain('+++ b/');
  });

  it('returns an empty string for a diff with no files', () => {
    const empty: UnifiedDiff = { raw: '', files: [] };
    expect(formatChangedFilesWithHunkHeaders(empty)).toBe('');
  });

  it('handles a file with no hunks gracefully', () => {
    const noHunks: UnifiedDiff = {
      raw: '',
      files: [{ path: 'src/empty.ts', additions: 0, deletions: 0, hunks: [] }],
    };
    const result = formatChangedFilesWithHunkHeaders(noHunks);
    expect(result).toContain('src/empty.ts');
    expect(result).not.toContain('@@');
  });
});
