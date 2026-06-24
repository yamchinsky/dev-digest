/**
 * Hermetic unit tests for `deriveIntent` (T7 / R1, R2, R3).
 *
 * No real DB or network: `resolveFeatureModel` is stubbed via vi.mock so
 * the container never touches Postgres, and the LLM is injected via
 * `MockLLMProvider` (from server/src/adapters/mocks.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { Intent } from '@devdigest/shared';
import { MockLLMProvider, MockSecretsProvider } from '../../adapters/mocks.js';
import { deriveIntent } from './intent.js';
import type { Container } from '../../platform/container.js';
import type { PullRow } from './repository.js';
import type * as schema from '../../db/schema.js';

// ---------------------------------------------------------------------------
// Stub resolveFeatureModel so the container never touches Postgres.
// The stub returns the registry default: openrouter / deepseek/deepseek-v4-flash.
// ---------------------------------------------------------------------------
vi.mock('../../platform/container.js', () => ({})); // prevent circular-import side-effects
vi.mock('../settings/feature-models.js', () => ({
  resolveFeatureModel: vi.fn().mockResolvedValue({
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A valid Intent fixture that passes the Zod schema. */
const INTENT_FIXTURE: Intent = {
  intent: 'Add rate limiting to public API endpoints to prevent abuse.',
  in_scope: ['src/middleware/ratelimit.ts', 'src/api/public/index.ts'],
  out_of_scope: ['authentication', 'payment processing'],
};

/**
 * A UnifiedDiff that carries BOTH hunk headers (which should appear in the
 * intent message) AND line body content (which must NOT appear). This lets R2
 * assert the positive and negative in one payload.
 */
const DIFF_WITH_BODIES: UnifiedDiff = {
  raw: `diff --git a/src/middleware/ratelimit.ts b/src/middleware/ratelimit.ts
--- a/src/middleware/ratelimit.ts
+++ b/src/middleware/ratelimit.ts
@@ -10,3 +10,7 @@
 import express from 'express';
+const SUPER_SECRET_BODY_LINE = 'must-not-appear';
+export function rateLimit() {}
 export default rateLimit;`,
  files: [
    {
      path: 'src/middleware/ratelimit.ts',
      additions: 2,
      deletions: 0,
      hunks: [
        {
          file: 'src/middleware/ratelimit.ts',
          oldStart: 10,
          oldLines: 3,
          newStart: 10,
          newLines: 7,
          newLineNumbers: [10, 11, 12, 13, 14, 15, 16],
        },
      ],
    },
    {
      path: 'src/api/public/index.ts',
      additions: 4,
      deletions: 1,
      hunks: [
        {
          file: 'src/api/public/index.ts',
          oldStart: 1,
          oldLines: 5,
          newStart: 1,
          newLines: 8,
          newLineNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
        },
      ],
    },
  ],
};

/** Minimal pull row with the fields deriveIntent reads. */
const PULL: PullRow = {
  id: 'pr-unit-test',
  workspaceId: 'ws-1',
  repoId: 'repo-1',
  number: 482,
  title: 'Add rate limiting',
  body: 'Adds rate limiting to public endpoints. Closes #471.',
  author: 'marisa.koch',
  branch: 'feat/rate-limit-public',
  base: 'main',
  headSha: 'a1b2c3d4',
  additions: 247,
  deletions: 38,
  filesCount: 9,
  status: 'needs_review',
  lastReviewedSha: null,
  openedAt: null,
  updatedAt: null,
};

/** Minimal repo row — deriveIntent only passes it through, never reads it. */
const REPO = {
  id: 'repo-1',
  workspaceId: 'ws-1',
  owner: 'acme',
  name: 'payments-api',
  fullName: 'acme/payments-api',
  defaultBranch: 'main',
  clonePath: null,
  lastPolledAt: null,
  createdBy: null,
  createdAt: new Date(),
} as unknown as typeof schema.repos.$inferSelect;

// ---------------------------------------------------------------------------
// Build a minimal container-like object for the unit tests. The container only
// needs `llm(id)` and (implicitly) `db` via `resolveFeatureModel` — but since
// `resolveFeatureModel` is mocked, `db` is never accessed.
// ---------------------------------------------------------------------------
function buildMockContainer(mockProvider: MockLLMProvider): Container {
  return {
    secrets: new MockSecretsProvider(),
    llm: async (_id: string) => mockProvider,
  } as unknown as Container;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveIntent (hermetic unit)', () => {
  let mockLLM: MockLLMProvider;
  let container: Container;

  beforeEach(() => {
    mockLLM = new MockLLMProvider('openai', {
      structured: INTENT_FIXTURE,
    });
    container = buildMockContainer(mockLLM);
  });

  // -------------------------------------------------------------------------
  // R1 — model resolution
  // -------------------------------------------------------------------------

  it('should resolve model deepseek/deepseek-v4-flash and provider openrouter when no workspace override is set', async () => {
    const result = await deriveIntent(container, 'ws-1', PULL, REPO, DIFF_WITH_BODIES);

    // The stub returns openrouter/deepseek-v4-flash (registry default).
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('deepseek/deepseek-v4-flash');
  });

  it('should call completeStructured with the Intent Zod schema', async () => {
    await deriveIntent(container, 'ws-1', PULL, REPO, DIFF_WITH_BODIES);

    const call = mockLLM.calls.find((c) => c.method === 'completeStructured');
    expect(call).toBeDefined();

    // The schema passed must be the Intent Zod object — verify it parses the fixture.
    const req = call!.req as { schema: typeof Intent; schemaName: string };
    expect(req.schemaName).toBe('Intent');
    const parsed = req.schema.safeParse(INTENT_FIXTURE);
    expect(parsed.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // R2 — intent input excludes diff line bodies
  // -------------------------------------------------------------------------

  it('should include @@ hunk headers and file paths in the LLM user message', async () => {
    await deriveIntent(container, 'ws-1', PULL, REPO, DIFF_WITH_BODIES);

    const call = mockLLM.calls.find((c) => c.method === 'completeStructured');
    const messages = (call!.req as { messages: { role: string; content: string }[] }).messages;
    const userMessage = messages.find((m) => m.role === 'user')!.content;

    // File paths must be present.
    expect(userMessage).toContain('src/middleware/ratelimit.ts');
    expect(userMessage).toContain('src/api/public/index.ts');

    // Reconstructed @@ hunk headers must be present.
    expect(userMessage).toContain('@@ -10,3 +10,7 @@');
    expect(userMessage).toContain('@@ -1,5 +1,8 @@');
  });

  it('should NOT include diff line bodies in the LLM user message (R2)', async () => {
    await deriveIntent(container, 'ws-1', PULL, REPO, DIFF_WITH_BODIES);

    const call = mockLLM.calls.find((c) => c.method === 'completeStructured');
    const messages = (call!.req as { messages: { role: string; content: string }[] }).messages;
    const userMessage = messages.find((m) => m.role === 'user')!.content;

    // The line body that only exists in diff.raw / DiffHunk.newLineNumbers context
    // must not appear.
    expect(userMessage).not.toContain('SUPER_SECRET_BODY_LINE');
    expect(userMessage).not.toContain('must-not-appear');
    // The raw diff field must not appear verbatim.
    expect(userMessage).not.toContain('import express from');
    expect(userMessage).not.toContain('export function rateLimit');
  });

  it('should include PR title and body in the LLM user message', async () => {
    await deriveIntent(container, 'ws-1', PULL, REPO, DIFF_WITH_BODIES);

    const call = mockLLM.calls.find((c) => c.method === 'completeStructured');
    const messages = (call!.req as { messages: { role: string; content: string }[] }).messages;
    const userMessage = messages.find((m) => m.role === 'user')!.content;

    expect(userMessage).toContain('Add rate limiting');
    expect(userMessage).toContain('Closes #471.');
  });

  // -------------------------------------------------------------------------
  // R3 — tokensIn / tokensOut are surfaced
  // -------------------------------------------------------------------------

  it('should surface tokensIn and tokensOut from the provider result', async () => {
    // MockLLMProvider always returns tokensIn=100, tokensOut=50.
    const result = await deriveIntent(container, 'ws-1', PULL, REPO, DIFF_WITH_BODIES);

    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(50);
  });

  // -------------------------------------------------------------------------
  // Linked-issue inclusion / omission
  // -------------------------------------------------------------------------

  it('should include linked-issue title and body in the user message when provided', async () => {
    await deriveIntent(container, 'ws-1', PULL, REPO, DIFF_WITH_BODIES, {
      linkedIssue: {
        title: 'Rate limiting requirements',
        body: 'We need to throttle requests at 100 req/min per IP.',
      },
    });

    const call = mockLLM.calls.find((c) => c.method === 'completeStructured');
    const messages = (call!.req as { messages: { role: string; content: string }[] }).messages;
    const userMessage = messages.find((m) => m.role === 'user')!.content;

    expect(userMessage).toContain('Rate limiting requirements');
    expect(userMessage).toContain('throttle requests at 100 req/min');
  });

  it('should omit the linked-issue section when no linkedIssue is provided', async () => {
    await deriveIntent(container, 'ws-1', PULL, REPO, DIFF_WITH_BODIES);

    const call = mockLLM.calls.find((c) => c.method === 'completeStructured');
    const messages = (call!.req as { messages: { role: string; content: string }[] }).messages;
    const userMessage = messages.find((m) => m.role === 'user')!.content;

    expect(userMessage).not.toContain('## Linked Issue');
  });

  // -------------------------------------------------------------------------
  // Return shape
  // -------------------------------------------------------------------------

  it('should return the structured Intent from the mock LLM', async () => {
    const result = await deriveIntent(container, 'ws-1', PULL, REPO, DIFF_WITH_BODIES);

    expect(result.intent.intent).toBe(INTENT_FIXTURE.intent);
    expect(result.intent.in_scope).toEqual(INTENT_FIXTURE.in_scope);
    expect(result.intent.out_of_scope).toEqual(INTENT_FIXTURE.out_of_scope);
  });
});
