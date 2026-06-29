/**
 * Tests for the get_blast_radius MCP tool handler (real implementation).
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
    getBlast: vi.fn(),
    resolveRepoId: vi.fn(),
    resolvePullId: vi.fn(),
  };
});

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetBlastRadius } from '../src/tools/get-blast-radius.js';
import { ApiError, resolvePullId, getBlast } from '../src/api/client.js';
import type { BlastRadius } from '../src/types.js';

// ---------------------------------------------------------------------------
// Capture shim
// ---------------------------------------------------------------------------

type CapturedHandler = (args: unknown, extra?: unknown) => Promise<unknown>;

function captureGetBlastRadius(): { config: unknown; handler: CapturedHandler } {
  const captured: Record<string, { config: unknown; handler: CapturedHandler }> = {};
  const fakeServer = {
    registerTool: (name: string, config: unknown, handler: CapturedHandler) => {
      captured[name] = { config, handler };
    },
  };
  registerGetBlastRadius(fakeServer as unknown as McpServer);
  const tool = captured['get_blast_radius'];
  if (!tool) throw new Error('get_blast_radius was not registered');
  return tool;
}

interface HandlerResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: BlastRadius;
  isError?: boolean;
}

const fakeExtra = { sendNotification: () => Promise.resolve() };

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeBlastRadius(overrides: Partial<BlastRadius> = {}): BlastRadius {
  return {
    changed_symbols: [
      { name: 'handleRequest', file: 'src/api/handler.ts', kind: 'function' },
    ],
    downstream: [
      {
        symbol: 'handleRequest',
        callers: [{ name: 'router', file: 'src/router.ts', line: 12 }],
        endpoints_affected: ['/api/pulls/:id'],
        crons_affected: [],
      },
    ],
    summary: 'Low-blast change touching one public handler.',
    status: 'full',
    degraded_reason: null,
    prior_prs: [
      { number: 7, title: 'refactor: extract handler', pull_id: 'pr-uuid-7' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('get_blast_radius tool — happy path', () => {
  let handler: CapturedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureGetBlastRadius().handler;
    vi.mocked(resolvePullId).mockResolvedValue('pull-uuid-1');
    vi.mocked(getBlast).mockResolvedValue(makeBlastRadius());
  });

  it('returns isError:false on a full-status result', async () => {
    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBeFalsy();
  });

  it('returns structuredContent matching the BlastRadius shape', async () => {
    const blast = makeBlastRadius();
    vi.mocked(getBlast).mockResolvedValue(blast);

    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.structuredContent).toMatchObject({
      changed_symbols: blast.changed_symbols,
      downstream: blast.downstream,
      summary: blast.summary,
      status: 'full',
      degraded_reason: null,
      prior_prs: blast.prior_prs,
    });
  });

  it('wraps symbol names in wrapUntrusted fence markers in the text content', async () => {
    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.content[0]?.text).toContain('<untrusted source="symbol">');
    expect(result.content[0]?.text).toContain('handleRequest');
  });

  it('wraps the summary in wrapUntrusted fence markers in the text content', async () => {
    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.content[0]?.text).toContain('<untrusted source="blast-summary">');
    expect(result.content[0]?.text).toContain('Low-blast change touching one public handler.');
  });

  it('wraps prior PR titles in wrapUntrusted fence markers in the text content', async () => {
    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.content[0]?.text).toContain('<untrusted source="pr-title">');
    expect(result.content[0]?.text).toContain('refactor: extract handler');
  });

  it('passes correct pullId to getBlast after resolving PR', async () => {
    await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra);

    expect(vi.mocked(resolvePullId)).toHaveBeenCalledWith('owner/repo', 42);
    expect(vi.mocked(getBlast)).toHaveBeenCalledWith('pull-uuid-1');
  });

  it('text includes changed/downstream/prior-pr counts', async () => {
    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('Changed: 1 symbol(s)');
    expect(text).toContain('downstream impacts: 1');
    expect(text).toContain('prior PRs: 1');
  });
});

// ---------------------------------------------------------------------------
// Degraded / partial status — not an error
// ---------------------------------------------------------------------------

describe('get_blast_radius tool — degraded/partial status', () => {
  let handler: CapturedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureGetBlastRadius().handler;
    vi.mocked(resolvePullId).mockResolvedValue('pull-uuid-1');
  });

  it('returns isError:false for degraded status (best-effort result)', async () => {
    vi.mocked(getBlast).mockResolvedValue(
      makeBlastRadius({ status: 'degraded', degraded_reason: 'index not populated yet' }),
    );

    const result = (await handler({ repo: 'owner/repo', prNumber: 1 }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.status).toBe('degraded');
  });

  it('includes degraded note in text content', async () => {
    vi.mocked(getBlast).mockResolvedValue(
      makeBlastRadius({ status: 'degraded', degraded_reason: 'index not populated yet' }),
    );

    const result = (await handler({ repo: 'owner/repo', prNumber: 1 }, fakeExtra)) as HandlerResult;

    expect(result.content[0]?.text).toContain('index degraded');
    expect(result.content[0]?.text).toContain('index not populated yet');
  });

  it('returns isError:false for partial status', async () => {
    vi.mocked(getBlast).mockResolvedValue(
      makeBlastRadius({ status: 'partial', degraded_reason: 'only 60% of files indexed' }),
    );

    const result = (await handler({ repo: 'owner/repo', prNumber: 1 }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.status).toBe('partial');
  });

  it('returns isError:false for failed status', async () => {
    vi.mocked(getBlast).mockResolvedValue(
      makeBlastRadius({ status: 'failed', degraded_reason: 'index extraction crashed', changed_symbols: [], downstream: [] }),
    );

    const result = (await handler({ repo: 'owner/repo', prNumber: 1 }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('get_blast_radius tool — error paths', () => {
  let handler: CapturedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureGetBlastRadius().handler;
  });

  it('returns isError:true when resolvePullId fails', async () => {
    vi.mocked(resolvePullId).mockRejectedValue(
      new ApiError(404, 'pull_not_found', 'PR #99 not found in "owner/repo".'),
    );

    const result = (await handler({ repo: 'owner/repo', prNumber: 99 }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('pull_not_found');
  });

  it('returns isError:true when getBlast fails', async () => {
    vi.mocked(resolvePullId).mockResolvedValue('pull-uuid-1');
    vi.mocked(getBlast).mockRejectedValue(
      new ApiError(500, 'server_error', 'Index service unavailable'),
    );

    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('server_error');
  });

  it('returns isError:true on unexpected non-ApiError exceptions', async () => {
    vi.mocked(resolvePullId).mockResolvedValue('pull-uuid-1');
    vi.mocked(getBlast).mockRejectedValue(new Error('network explosion'));

    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('network explosion');
  });

  it('never throws to the MCP protocol', async () => {
    vi.mocked(resolvePullId).mockRejectedValue(new Error('boom'));

    await expect(handler({ repo: 'owner/repo', prNumber: 1 }, fakeExtra)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Registration config
// ---------------------------------------------------------------------------

describe('get_blast_radius tool — registration config', () => {
  it('registers with readOnlyHint:true and openWorldHint:false', () => {
    const { config } = captureGetBlastRadius();
    const cfg = config as { annotations: Record<string, unknown> };
    expect(cfg.annotations.readOnlyHint).toBe(true);
    expect(cfg.annotations.openWorldHint).toBe(false);
  });

  it('description does not mention "stub" or "not yet implemented"', () => {
    const { config } = captureGetBlastRadius();
    const cfg = config as { description: string };
    expect(cfg.description).not.toMatch(/stub|not yet implemented/i);
  });
});
