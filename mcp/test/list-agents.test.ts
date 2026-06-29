/**
 * Tests for the list_agents MCP tool handler.
 *
 * Uses a capture shim instead of the real McpServer so no SDK instance is
 * needed. The handler is extracted and called directly.
 *
 * global.fetch is NOT used here — the api/client module is vi.mocked so the
 * test stays hermetic. wrapUntrusted is provided via a mock of the reviewer-core
 * subpath (same implementation as the real function so assertions are meaningful).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Provide wrapUntrusted so that format.ts loads without the broken subpath alias.
vi.mock('@devdigest/reviewer-core/prompt.js', () => ({
  wrapUntrusted: (label: string, content: string): string =>
    `<untrusted source="${label}">\n${content}\n</untrusted>`,
}));

// Mock the entire api/client module so no real HTTP calls are made.
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
import { registerListAgents } from '../src/tools/list-agents.js';
import { ApiError, getAgents } from '../src/api/client.js';
import { makeAgent } from './setup.js';

// ---------------------------------------------------------------------------
// Capture shim
// ---------------------------------------------------------------------------

type CapturedHandler = (args: unknown, extra?: unknown) => Promise<unknown>;
type ToolCapture = { config: unknown; handler: CapturedHandler };

function captureListAgents(): ToolCapture {
  const captured: Record<string, ToolCapture> = {};
  const fakeServer = {
    registerTool: (name: string, config: unknown, handler: CapturedHandler) => {
      captured[name] = { config, handler };
    },
  };
  registerListAgents(fakeServer as unknown as McpServer);
  const tool = captured['list_agents'];
  if (!tool) throw new Error('list_agents was not registered');
  return tool;
}

// ---------------------------------------------------------------------------
// Types for handler result shape
// ---------------------------------------------------------------------------

interface HandlerResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: { agents: unknown[]; count: number };
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('list_agents tool — happy path', () => {
  let handler: CapturedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureListAgents().handler;
  });

  it('returns structuredContent with agents array and count', async () => {
    const agent = makeAgent({ id: 'a-1', name: 'Security Agent', enabled: true });
    vi.mocked(getAgents).mockResolvedValue([agent]);

    const result = (await handler({ includeDisabled: false })) as HandlerResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      count: 1,
      agents: [
        {
          id: 'a-1',
          name: 'Security Agent',
          enabled: true,
        },
      ],
    });
  });

  it('mirrors the text content with agent count', async () => {
    vi.mocked(getAgents).mockResolvedValue([makeAgent()]);

    const result = (await handler({ includeDisabled: false })) as HandlerResult;

    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('1 agents');
  });

  it('wraps agent descriptions in wrapUntrusted fence markers', async () => {
    const agent = makeAgent({ description: 'Checks for injection vulnerabilities.' });
    vi.mocked(getAgents).mockResolvedValue([agent]);

    const result = (await handler({ includeDisabled: false })) as HandlerResult;

    // The text mirror must contain wrapUntrusted fence around the description.
    expect(result.content[0]?.text).toContain('<untrusted source="agent-description">');
    expect(result.content[0]?.text).toContain('Checks for injection vulnerabilities.');
    expect(result.content[0]?.text).toContain('</untrusted>');
  });

  it('filters out disabled agents when includeDisabled=false', async () => {
    const enabled = makeAgent({ id: 'a-1', enabled: true });
    const disabled = makeAgent({ id: 'a-2', enabled: false });
    vi.mocked(getAgents).mockResolvedValue([enabled, disabled]);

    const result = (await handler({ includeDisabled: false })) as HandlerResult;

    expect(result.structuredContent?.count).toBe(1);
    expect(result.structuredContent?.agents).toHaveLength(1);
    expect((result.structuredContent?.agents[0] as { id: string }).id).toBe('a-1');
  });

  it('includes disabled agents when includeDisabled=true', async () => {
    const enabled = makeAgent({ id: 'a-1', enabled: true });
    const disabled = makeAgent({ id: 'a-2', enabled: false });
    vi.mocked(getAgents).mockResolvedValue([enabled, disabled]);

    const result = (await handler({ includeDisabled: true })) as HandlerResult;

    expect(result.structuredContent?.count).toBe(2);
  });

  it('returns "0 agents configured." text when no agents exist', async () => {
    vi.mocked(getAgents).mockResolvedValue([]);

    const result = (await handler({ includeDisabled: false })) as HandlerResult;

    expect(result.structuredContent?.count).toBe(0);
    expect(result.content[0]?.text).toBe('0 agents configured.');
  });
});

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe('list_agents tool — error path', () => {
  let handler: CapturedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureListAgents().handler;
  });

  it('returns isError:true when the API throws an ApiError', async () => {
    vi.mocked(getAgents).mockRejectedValue(
      new ApiError(503, 'service_unavailable', 'DevDigest API is down'),
    );

    const result = (await handler({ includeDisabled: false })) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('service_unavailable');
    expect(result.content[0]?.text).toContain('DevDigest API is down');
  });

  it('returns isError:true on unexpected errors (non-ApiError)', async () => {
    vi.mocked(getAgents).mockRejectedValue(new Error('network failure'));

    const result = (await handler({ includeDisabled: false })) as HandlerResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('network failure');
  });

  it('never throws to the MCP protocol — error is always in content', async () => {
    vi.mocked(getAgents).mockRejectedValue(new Error('boom'));

    // Must not reject
    await expect(handler({ includeDisabled: false })).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tool config (annotations, description)
// ---------------------------------------------------------------------------

describe('list_agents tool — registration config', () => {
  it('registers with readOnlyHint:true and openWorldHint:false', () => {
    const capture = captureListAgents();
    const cfg = capture.config as { annotations: Record<string, unknown> };
    expect(cfg.annotations.readOnlyHint).toBe(true);
    expect(cfg.annotations.openWorldHint).toBe(false);
  });
});
