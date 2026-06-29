/**
 * Tests for the get_conventions MCP tool handler.
 *
 * Hermetic: api/client mocked, no real HTTP. wrapUntrusted subpath mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@devdigest/reviewer-core/prompt.js', () => ({
  wrapUntrusted: (label: string, content: string): string =>
    `<untrusted source="${label}">\n${content}\n</untrusted>`,
}));

vi.mock('../src/api/client.js', () => {
  class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
      public readonly details?: unknown,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return {
    ApiError,
    getAgents: vi.fn(),
    getRepos: vi.fn(),
    getPulls: vi.fn(),
    startReview: vi.fn(),
    getRuns: vi.fn(),
    getReviews: vi.fn(),
    getConventions: vi.fn(),
    resolveRepoId: vi.fn(),
    resolvePullId: vi.fn(),
  };
});

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetConventions } from '../src/tools/get-conventions.js';
import { ApiError, resolveRepoId, getConventions } from '../src/api/client.js';
import { makeConventionRow } from './setup.js';

// ---------------------------------------------------------------------------
// Capture shim
// ---------------------------------------------------------------------------

type CapturedHandler = (args: unknown, extra?: unknown) => Promise<unknown>;

function captureGetConventions(): CapturedHandler {
  const captured: Record<string, { handler: CapturedHandler }> = {};
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: CapturedHandler) => {
      captured[name] = { handler };
    },
  };
  registerGetConventions(fakeServer as unknown as McpServer);
  const tool = captured['get_conventions'];
  if (!tool) throw new Error('get_conventions was not registered');
  return tool.handler;
}

interface HandlerResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: {
    repoId: string;
    conventions: Array<{ category: string; rule: string; description: string | null; confidence: number }>;
    count: number;
  };
  isError?: boolean;
}

const fakeExtra = { sendNotification: vi.fn() };

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('get_conventions tool — happy path', () => {
  let handler: CapturedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureGetConventions();
    vi.mocked(resolveRepoId).mockResolvedValue('repo-uuid-1');
  });

  it('returns structuredContent with repoId, conventions array, and count', async () => {
    const conv = makeConventionRow({ category: 'naming', rule: 'Use camelCase', description: 'All vars.' });
    vi.mocked(getConventions).mockResolvedValue([conv]);

    const result = (await handler({ repo: 'owner/repo', status: 'approved' }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      repoId: 'repo-uuid-1',
      count: 1,
      conventions: [
        { category: 'naming', rule: 'Use camelCase', description: 'All vars.' },
      ],
    });
  });

  it('wraps rule and description in wrapUntrusted fence markers in the text mirror', async () => {
    const conv = makeConventionRow({ rule: 'Never use eval()', description: 'eval is dangerous.' });
    vi.mocked(getConventions).mockResolvedValue([conv]);

    const result = (await handler({ repo: 'owner/repo', status: 'approved' }, fakeExtra)) as HandlerResult;

    // Rule text should be wrapped.
    expect(result.content[0]?.text).toContain('<untrusted source="convention-rule">');
    expect(result.content[0]?.text).toContain('Never use eval()');
    // Description text should also be wrapped.
    expect(result.content[0]?.text).toContain('<untrusted source="convention-description">');
    expect(result.content[0]?.text).toContain('eval is dangerous.');
  });

  it('handles conventions with null description gracefully (no fence for null)', async () => {
    const conv = makeConventionRow({ rule: 'Short functions', description: null });
    vi.mocked(getConventions).mockResolvedValue([conv]);

    const result = (await handler({ repo: 'owner/repo', status: 'approved' }, fakeExtra)) as HandlerResult;

    // No description fence, no null in output.
    expect(result.content[0]?.text).not.toContain('convention-description');
    expect(result.isError).toBeUndefined();
  });

  it('passes the status parameter to getConventions', async () => {
    vi.mocked(getConventions).mockResolvedValue([]);

    await handler({ repo: 'owner/repo', status: 'pending' }, fakeExtra);

    expect(vi.mocked(getConventions)).toHaveBeenCalledWith('repo-uuid-1', 'pending');
  });

  it('returns graceful empty state message when no conventions are found', async () => {
    vi.mocked(getConventions).mockResolvedValue([]);

    const result = (await handler({ repo: 'owner/repo', status: 'approved' }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.count).toBe(0);
    expect(result.content[0]?.text).toContain('No approved conventions');
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('get_conventions tool — error paths', () => {
  let handler: CapturedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureGetConventions();
  });

  it('returns isError:true when resolveRepoId fails', async () => {
    vi.mocked(resolveRepoId).mockRejectedValue(
      new ApiError(404, 'repo_not_found', 'Repository "owner/repo" not found in DevDigest.'),
    );

    const result = (await handler({ repo: 'owner/repo', status: 'approved' }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('repo_not_found');
  });

  it('returns isError:true when getConventions fails', async () => {
    vi.mocked(resolveRepoId).mockResolvedValue('repo-uuid-1');
    vi.mocked(getConventions).mockRejectedValue(
      new ApiError(500, 'server_error', 'DB is unavailable'),
    );

    const result = (await handler({ repo: 'owner/repo', status: 'approved' }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('server_error');
  });

  it('never throws to the MCP protocol', async () => {
    vi.mocked(resolveRepoId).mockRejectedValue(new Error('boom'));

    await expect(handler({ repo: 'owner/repo', status: 'approved' }, fakeExtra)).resolves.toBeDefined();
  });
});
