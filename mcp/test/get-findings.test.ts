/**
 * Tests for the get_findings MCP tool handler.
 *
 * Uses a capture shim — no real McpServer or HTTP calls. The api/client module
 * is vi.mocked. wrapUntrusted subpath is mocked so format.ts can load.
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
import { registerGetFindings } from '../src/tools/get-findings.js';
import { ApiError, resolvePullId, getReviews } from '../src/api/client.js';
import { makeReviewRecord, makeFindingRecord } from './setup.js';

// ---------------------------------------------------------------------------
// Capture shim
// ---------------------------------------------------------------------------

type CapturedHandler = (args: unknown, extra?: unknown) => Promise<unknown>;

function captureGetFindings(): CapturedHandler {
  const captured: Record<string, { handler: CapturedHandler }> = {};
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: CapturedHandler) => {
      captured[name] = { handler };
    },
  };
  registerGetFindings(fakeServer as unknown as McpServer);
  const tool = captured['get_findings'];
  if (!tool) throw new Error('get_findings was not registered');
  return tool.handler;
}

interface HandlerResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: {
    pullId: string;
    reviewId: string;
    agentName: string | null;
    verdict: string | null;
    score: number | null;
    grounding: string | null;
    counts: { total: number; critical: number; warning: number; suggestion: number };
    summary: string | null;
    reviewedAt: string;
  };
  isError?: boolean;
}

const fakeExtra = { sendNotification: vi.fn() };

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('get_findings tool — happy path', () => {
  let handler: CapturedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureGetFindings();
    vi.mocked(resolvePullId).mockResolvedValue('pull-uuid-1');
  });

  it("returns structuredContent with the latest review's verdict and counts", async () => {
    const findings = [
      makeFindingRecord({ severity: 'CRITICAL' }),
      makeFindingRecord({ id: 'f-2', severity: 'WARNING' }),
      makeFindingRecord({ id: 'f-3', severity: 'SUGGESTION' }),
    ];
    const review = makeReviewRecord({
      id: 'rev-1',
      kind: 'review',
      verdict: 'request_changes',
      score: 45,
      findings,
      run_id: null,
    });
    vi.mocked(getReviews).mockResolvedValue([review]);

    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      pullId: 'pull-uuid-1',
      reviewId: 'rev-1',
      verdict: 'request_changes',
      score: 45,
      counts: { total: 3, critical: 1, warning: 1, suggestion: 1 },
    });
  });

  it('mirrors verdict and counts in the text content', async () => {
    const review = makeReviewRecord({ verdict: 'approve', score: 90, findings: [] });
    vi.mocked(getReviews).mockResolvedValue([review]);

    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.content[0]?.text).toContain('approve');
    expect(result.content[0]?.text).toContain('90/100');
    expect(result.content[0]?.text).toContain('0 findings');
  });

  it('picks the most recent review when multiple reviews exist', async () => {
    const older = makeReviewRecord({
      id: 'rev-old',
      kind: 'review',
      verdict: 'request_changes',
      score: 30,
      created_at: '2024-01-01T00:00:00Z',
      run_id: null,
    });
    const newer = makeReviewRecord({
      id: 'rev-new',
      kind: 'review',
      verdict: 'approve',
      score: 90,
      created_at: '2024-01-02T00:00:00Z',
      run_id: null,
    });
    vi.mocked(getReviews).mockResolvedValue([older, newer]);

    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.structuredContent?.reviewId).toBe('rev-new');
  });

  it('filters by agentId when provided', async () => {
    const reviewA = makeReviewRecord({ id: 'rev-a', agent_id: 'agent-1', kind: 'review', run_id: null });
    const reviewB = makeReviewRecord({ id: 'rev-b', agent_id: 'agent-2', kind: 'review', run_id: null });
    vi.mocked(getReviews).mockResolvedValue([reviewA, reviewB]);

    const result = (await handler({ repo: 'owner/repo', prNumber: 42, agentId: 'agent-2' }, fakeExtra)) as HandlerResult;

    expect(result.structuredContent?.reviewId).toBe('rev-b');
  });

  it('skips "summary" kind records (only "review" kind carries findings)', async () => {
    const summaryKind = makeReviewRecord({ id: 'sum-1', kind: 'summary', run_id: null });
    const reviewKind = makeReviewRecord({ id: 'rev-1', kind: 'review', run_id: null });
    vi.mocked(getReviews).mockResolvedValue([summaryKind, reviewKind]);

    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.structuredContent?.reviewId).toBe('rev-1');
  });
});

// ---------------------------------------------------------------------------
// Error / empty paths
// ---------------------------------------------------------------------------

describe('get_findings tool — error paths', () => {
  let handler: CapturedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureGetFindings();
    vi.mocked(resolvePullId).mockResolvedValue('pull-uuid-1');
  });

  it('returns isError:true with "run run_agent_on_pr first" when no reviews exist', async () => {
    vi.mocked(getReviews).mockResolvedValue([]);

    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('run_agent_on_pr');
  });

  it('returns isError:true when agentId filter yields no results', async () => {
    const review = makeReviewRecord({ agent_id: 'agent-1', kind: 'review', run_id: null });
    vi.mocked(getReviews).mockResolvedValue([review]);

    const result = (await handler(
      { repo: 'owner/repo', prNumber: 42, agentId: 'agent-99' },
      fakeExtra,
    )) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('agent-99');
  });

  it('returns isError:true when resolvePullId fails', async () => {
    vi.mocked(resolvePullId).mockRejectedValue(
      new ApiError(404, 'pull_not_found', 'PR #42 not found in "owner/repo".'),
    );

    const result = (await handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('pull_not_found');
  });

  it('never throws to the MCP protocol', async () => {
    vi.mocked(resolvePullId).mockRejectedValue(new Error('unexpected'));

    await expect(handler({ repo: 'owner/repo', prNumber: 42 }, fakeExtra)).resolves.toBeDefined();
  });
});
