/**
 * Tests for the run_agent_on_pr MCP tool handler.
 *
 * Key scenarios:
 *  1. Poll-to-done: status goes running → done; progress notifications emitted;
 *     findings returned with wrapUntrusted fence markers; matching run_id.
 *  2. Timeout: status stays running past reviewTimeoutMs → isError:true; no
 *     fabricated findings.
 *  3. Failed run: status becomes failed → isError:true with error detail.
 *
 * Fake timers are used so no real delays occur. The config module is mocked
 * with a very short pollIntervalMs (50ms) and reviewTimeoutMs (130ms) so only
 * a few fake-timer advances are needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock calls are hoisted before imports.

vi.mock('@devdigest/reviewer-core/prompt.js', () => ({
  wrapUntrusted: (label: string, content: string): string =>
    `<untrusted source="${label}">\n${content}\n</untrusted>`,
}));

vi.mock('../src/config.js', () => ({
  default: Object.freeze({
    apiUrl: 'http://localhost:3001',
    httpTimeoutMs: 500,
    reviewTimeoutMs: 130, // small so timeout test needs ≤3 polls to trigger
    pollIntervalMs: 50, // 50ms per poll
  }),
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
import { registerRunAgentOnPr } from '../src/tools/run-agent-on-pr.js';
import { ApiError, resolvePullId, startReview, getRuns, getReviews } from '../src/api/client.js';
import { makeRunSummary, makeReviewRecord, makeFindingRecord } from './setup.js';

// ---------------------------------------------------------------------------
// Capture shim
// ---------------------------------------------------------------------------

type CapturedHandler = (args: unknown, extra: unknown) => Promise<unknown>;

function captureRunAgentOnPr(): { config: unknown; handler: CapturedHandler } {
  const captured: Record<string, { config: unknown; handler: CapturedHandler }> = {};
  const fakeServer = {
    registerTool: (name: string, config: unknown, handler: CapturedHandler) => {
      captured[name] = { config, handler };
    },
  };
  registerRunAgentOnPr(fakeServer as unknown as McpServer);
  const tool = captured['run_agent_on_pr'];
  if (!tool) throw new Error('run_agent_on_pr was not registered');
  return tool;
}

// ---------------------------------------------------------------------------
// Shared types for result inspection
// ---------------------------------------------------------------------------

interface FindingEntry {
  severity: string;
  category: string;
  title: string;
  file: string;
  line: number;
  rationale: string;
}

interface StructuredContent {
  pullId: string;
  runId: string;
  status: string;
  verdict: string | null;
  score: number | null;
  grounding: string | null;
  counts: { total: number; critical: number; warning: number; suggestion: number };
  summary: string | null;
  findings: FindingEntry[];
}

interface HandlerResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: StructuredContent;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Shared mock setup helpers
// ---------------------------------------------------------------------------

const PULL_ID = 'pull-uuid-1';
const AGENT_ID = 'agent-uuid-1';
const RUN_ID = 'run-uuid-1';

function setupStartReviewMock() {
  vi.mocked(startReview).mockResolvedValue({
    pr_id: PULL_ID,
    runs: [{ run_id: RUN_ID, agent_id: AGENT_ID, agent_name: 'Test Agent' }],
    reviews: [],
  });
}

// ---------------------------------------------------------------------------
// Poll-to-done tests
// ---------------------------------------------------------------------------

describe('run_agent_on_pr — poll to done', () => {
  let handler: CapturedHandler;
  let sendNotification: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    handler = captureRunAgentOnPr().handler;

    vi.mocked(resolvePullId).mockResolvedValue(PULL_ID);
    setupStartReviewMock();
    sendNotification = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns done status and findings after polls transition running → done', async () => {
    let pollN = 0;
    vi.mocked(getRuns).mockImplementation(async () => {
      pollN++;
      const status = pollN >= 2 ? 'done' : 'running';
      return [makeRunSummary({ run_id: RUN_ID, status, findings_count: pollN >= 2 ? 1 : 0 })];
    });

    const finding = makeFindingRecord({ severity: 'CRITICAL', title: 'SQL injection risk' });
    vi.mocked(getReviews).mockResolvedValue([
      makeReviewRecord({ run_id: RUN_ID, verdict: 'request_changes', score: 40, findings: [finding] }),
    ]);

    const fakeExtra = { _meta: { progressToken: 'tok-1' }, sendNotification };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtra,
    );

    // Advance enough for 2 polls (50ms each) + async work
    await vi.advanceTimersByTimeAsync(200);
    const result = (await handlerPromise) as HandlerResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.status).toBe('done');
    expect(result.structuredContent?.verdict).toBe('request_changes');
    expect(result.structuredContent?.score).toBe(40);
    expect(result.structuredContent?.counts).toMatchObject({ total: 1, critical: 1 });
    expect(result.structuredContent?.findings).toHaveLength(1);
  });

  it('filters the review by the started run_id (not any review)', async () => {
    vi.mocked(getRuns).mockResolvedValue([
      makeRunSummary({ run_id: RUN_ID, status: 'done' }),
    ]);

    const correctReview = makeReviewRecord({ run_id: RUN_ID, verdict: 'approve', score: 92 });
    const otherReview = makeReviewRecord({ id: 'rev-other', run_id: 'other-run', verdict: 'request_changes', score: 20 });
    vi.mocked(getReviews).mockResolvedValue([otherReview, correctReview]);

    const fakeExtra = { _meta: { progressToken: 'tok-2' }, sendNotification };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtra,
    );
    await vi.advanceTimersByTimeAsync(200);
    const result = (await handlerPromise) as HandlerResult;

    expect(result.structuredContent?.runId).toBe(RUN_ID);
    expect(result.structuredContent?.verdict).toBe('approve');
  });

  it('emits ≥1 notifications/progress via sendNotification when progressToken is present', async () => {
    let pollN = 0;
    vi.mocked(getRuns).mockImplementation(async () => {
      pollN++;
      const status = pollN >= 2 ? 'done' : 'running';
      return [makeRunSummary({ run_id: RUN_ID, status })];
    });
    vi.mocked(getReviews).mockResolvedValue([makeReviewRecord({ run_id: RUN_ID })]);

    const fakeExtra = { _meta: { progressToken: 'progress-token-123' }, sendNotification };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtra,
    );
    await vi.advanceTimersByTimeAsync(200);
    await handlerPromise;

    // At least 1 progress notification (1 per poll; 2 polls for running→done)
    expect(sendNotification).toHaveBeenCalledTimes(2);

    // Each call should use the method 'notifications/progress' with our token
    const call = sendNotification.mock.calls[0] as [{ method: string; params: { progressToken: unknown } }];
    expect(call[0].method).toBe('notifications/progress');
    expect(call[0].params.progressToken).toBe('progress-token-123');
  });

  it('does NOT emit progress notifications when no progressToken is provided', async () => {
    vi.mocked(getRuns).mockResolvedValue([makeRunSummary({ run_id: RUN_ID, status: 'done' })]);
    vi.mocked(getReviews).mockResolvedValue([makeReviewRecord({ run_id: RUN_ID })]);

    // fakeExtra without progressToken
    const fakeExtraNoToken = { _meta: {}, sendNotification };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtraNoToken,
    );
    await vi.advanceTimersByTimeAsync(200);
    await handlerPromise;

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('wraps untrusted finding fields (title, file, rationale) in fence markers', async () => {
    vi.mocked(getRuns).mockResolvedValue([makeRunSummary({ run_id: RUN_ID, status: 'done' })]);

    const finding = makeFindingRecord({
      title: 'Injection vector found',
      file: 'src/db.ts',
      rationale: 'The user input flows directly into the query.',
    });
    vi.mocked(getReviews).mockResolvedValue([makeReviewRecord({ run_id: RUN_ID, findings: [finding] })]);

    const fakeExtra = { _meta: { progressToken: 'tok' }, sendNotification };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtra,
    );
    await vi.advanceTimersByTimeAsync(200);
    const result = (await handlerPromise) as HandlerResult;

    const f = result.structuredContent?.findings[0];
    expect(f?.title).toContain('<untrusted source="title">');
    expect(f?.file).toContain('<untrusted source="file">');
    expect(f?.rationale).toContain('<untrusted source="rationale">');
  });

  it('wraps summary in fence markers when present', async () => {
    vi.mocked(getRuns).mockResolvedValue([makeRunSummary({ run_id: RUN_ID, status: 'done' })]);
    vi.mocked(getReviews).mockResolvedValue([
      makeReviewRecord({ run_id: RUN_ID, summary: 'Overall the code has injection risks.' }),
    ]);

    const fakeExtra = { _meta: { progressToken: 'tok' }, sendNotification };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtra,
    );
    await vi.advanceTimersByTimeAsync(200);
    const result = (await handlerPromise) as HandlerResult;

    expect(result.structuredContent?.summary).toContain('<untrusted source="summary">');
    expect(result.structuredContent?.summary).toContain('Overall the code has injection risks.');
  });
});

// ---------------------------------------------------------------------------
// Timeout test
// ---------------------------------------------------------------------------

describe('run_agent_on_pr — timeout', () => {
  let handler: CapturedHandler;
  let sendNotification: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    handler = captureRunAgentOnPr().handler;

    vi.mocked(resolvePullId).mockResolvedValue(PULL_ID);
    setupStartReviewMock();
    sendNotification = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns isError:true when the review is still running past reviewTimeoutMs', async () => {
    // Always return 'running' → never terminal → timeout fires after 130ms
    // (reviewTimeoutMs from mocked config)
    vi.mocked(getRuns).mockResolvedValue([
      makeRunSummary({ run_id: RUN_ID, status: 'running', findings_count: 0 }),
    ]);

    const fakeExtra = { _meta: { progressToken: 'tok-timeout' }, sendNotification };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtra,
    );

    // Advance well past reviewTimeoutMs (130ms) — 3 polls at 50ms = 150ms > 130ms
    await vi.advanceTimersByTimeAsync(300);
    const result = (await handlerPromise) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/still running/i);
    // Must mention the run_id so the user can check later.
    expect(result.content[0]?.text).toContain(RUN_ID);
  });

  it('never fabricates findings on timeout — findings array must be empty', async () => {
    vi.mocked(getRuns).mockResolvedValue([
      makeRunSummary({ run_id: RUN_ID, status: 'running' }),
    ]);

    const fakeExtra = { _meta: { progressToken: 'tok' }, sendNotification };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtra,
    );
    await vi.advanceTimersByTimeAsync(300);
    const result = (await handlerPromise) as HandlerResult;

    expect(result.structuredContent?.findings).toEqual([]);
    expect(result.structuredContent?.status).toBe('timeout');
    expect(result.structuredContent?.verdict).toBeNull();
  });

  it('emits progress notifications during polling before the timeout', async () => {
    vi.mocked(getRuns).mockResolvedValue([
      makeRunSummary({ run_id: RUN_ID, status: 'running' }),
    ]);

    const fakeExtra = { _meta: { progressToken: 'tok' }, sendNotification };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtra,
    );
    await vi.advanceTimersByTimeAsync(300);
    await handlerPromise;

    // Polls at t=50ms and t=100ms emit notifications; t=150ms exceeds 130ms timeout.
    // So exactly 3 notifications (3 polls before timeout returns).
    // Poll 1: t=50ms (running, emit, check terminal: no, check timeout: 50<130: no)
    // Poll 2: t=100ms (running, emit, check terminal: no, check timeout: 100<130: no)
    // Poll 3: t=150ms (running, emit, check terminal: no, check timeout: 150>=130: RETURN)
    expect(sendNotification).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Failed / cancelled run tests
// ---------------------------------------------------------------------------

describe('run_agent_on_pr — failed run', () => {
  let handler: CapturedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    handler = captureRunAgentOnPr().handler;

    vi.mocked(resolvePullId).mockResolvedValue(PULL_ID);
    setupStartReviewMock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns isError:true when the run status is failed', async () => {
    // Poll 1: failed (terminal immediately)
    vi.mocked(getRuns)
      .mockResolvedValueOnce([makeRunSummary({ run_id: RUN_ID, status: 'failed', error: 'Model timeout' })])
      // Post-loop extra call for error detail
      .mockResolvedValueOnce([makeRunSummary({ run_id: RUN_ID, status: 'failed', error: 'Model timeout' })]);

    const fakeExtra = { _meta: {}, sendNotification: vi.fn().mockResolvedValue(undefined) };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtra,
    );
    await vi.advanceTimersByTimeAsync(200);
    const result = (await handlerPromise) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('failed');
    expect(result.content[0]?.text).toContain('Model timeout');
  });

  it('returns isError:true when the run status is cancelled', async () => {
    vi.mocked(getRuns)
      .mockResolvedValueOnce([makeRunSummary({ run_id: RUN_ID, status: 'cancelled', error: null })])
      .mockResolvedValueOnce([makeRunSummary({ run_id: RUN_ID, status: 'cancelled', error: null })]);

    const fakeExtra = { _meta: {}, sendNotification: vi.fn().mockResolvedValue(undefined) };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtra,
    );
    await vi.advanceTimersByTimeAsync(200);
    const result = (await handlerPromise) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('cancelled');
  });
});

// ---------------------------------------------------------------------------
// Resolver failure
// ---------------------------------------------------------------------------

describe('run_agent_on_pr — resolver failure', () => {
  let handler: CapturedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    handler = captureRunAgentOnPr().handler;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns isError:true when resolvePullId throws an ApiError', async () => {
    vi.mocked(resolvePullId).mockRejectedValue(
      new ApiError(404, 'pull_not_found', 'PR #42 not found in "owner/repo".'),
    );

    const fakeExtra = { _meta: {}, sendNotification: vi.fn() };
    const handlerPromise = handler(
      { repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID },
      fakeExtra,
    );
    await vi.advanceTimersByTimeAsync(10); // No timers will fire (error thrown before poll)
    const result = (await handlerPromise) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('pull_not_found');
  });

  it('never throws to the MCP protocol', async () => {
    vi.mocked(resolvePullId).mockRejectedValue(new Error('catastrophic failure'));

    const fakeExtra = { _meta: {}, sendNotification: vi.fn() };
    await expect(
      handler({ repo: 'owner/repo', prNumber: 42, agentId: AGENT_ID }, fakeExtra),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Registration config
// ---------------------------------------------------------------------------

describe('run_agent_on_pr — registration config', () => {
  it('registers with readOnlyHint:false, destructiveHint:false, openWorldHint:false', () => {
    const { config } = captureRunAgentOnPr();
    const cfg = config as { annotations: Record<string, unknown> };
    expect(cfg.annotations.readOnlyHint).toBe(false);
    expect(cfg.annotations.destructiveHint).toBe(false);
    expect(cfg.annotations.idempotentHint).toBe(false);
    expect(cfg.annotations.openWorldHint).toBe(false);
  });
});
