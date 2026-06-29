/**
 * Tests for mcp/src/api/client.ts — HTTP client, ApiError, resolvers.
 *
 * All tests are hermetic: global.fetch is replaced with a vi.fn() per test.
 * No real network calls or DB. No .it. suffix (not integration tests).
 *
 * config.ts is mocked with a short httpTimeoutMs so the timeout test can
 * use vi.advanceTimersByTimeAsync without advancing 15 seconds.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock is hoisted — runs before imports, so client.ts gets the mocked config.
vi.mock('../src/config.js', () => ({
  default: Object.freeze({
    apiUrl: 'http://localhost:3001',
    httpTimeoutMs: 100, // short so fake timers can trigger it quickly
    reviewTimeoutMs: 1_000,
    pollIntervalMs: 50,
  }),
}));

import {
  ApiError,
  getAgents,
  getRepos,
  resolveRepoId,
  resolvePullId,
} from '../src/api/client.js';
import { makeRepo, makePrMeta, makeApiErrorEnvelope, makeOkResponse, makeErrorResponse } from './setup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fetch mock that hangs until the abort signal fires. */
function hangingFetch() {
  return vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
    return new Promise<never>((_resolve, reject) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// AbortController timeout
// ---------------------------------------------------------------------------

describe('request() — AbortController timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws ApiError with code "timeout" when the request exceeds httpTimeoutMs', async () => {
    vi.useFakeTimers();
    global.fetch = hangingFetch();

    // Attach .catch() immediately so the rejection is always handled and
    // never triggers Node.js unhandledRejection events.
    let caught: unknown;
    const settled = getAgents().catch((e) => {
      caught = e;
    });

    // Advance past the 100ms httpTimeoutMs; the AbortController fires.
    await vi.advanceTimersByTimeAsync(101);
    await settled;

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('timeout');
    expect((caught as ApiError).status).toBe(0);
  });

  it('includes an actionable message naming the path and timeout duration', async () => {
    vi.useFakeTimers();
    global.fetch = hangingFetch();

    let caught: unknown;
    const settled = getAgents().catch((e) => {
      caught = e;
    });

    await vi.advanceTimersByTimeAsync(101);
    await settled;

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toMatch(/timed out/i);
    expect((caught as ApiError).message).toContain('100ms');
  });
});

// ---------------------------------------------------------------------------
// ApiErrorBody envelope normalisation
// ---------------------------------------------------------------------------

describe('request() — ApiError from error envelope', () => {
  it('parses { error: { code, message } } from a non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeErrorResponse(404, makeApiErrorEnvelope('not_found', 'Resource not found')),
    );

    await expect(getAgents()).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'Resource not found',
    });
  });

  it('also captures details when present', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeErrorResponse(422, makeApiErrorEnvelope('validation_error', 'Bad input', { field: 'agentId' })),
    );

    let caught: ApiError | undefined;
    try {
      await getAgents();
    } catch (e) {
      if (e instanceof ApiError) caught = e;
    }
    expect(caught?.details).toEqual({ field: 'agentId' });
  });

  it('falls back to "request_failed" and HTTP status line when body is not JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error('not json')),
    });

    let caught: ApiError | undefined;
    try {
      await getAgents();
    } catch (e) {
      if (e instanceof ApiError) caught = e;
    }
    expect(caught?.code).toBe('request_failed');
    expect(caught?.message).toContain('503');
    expect(caught?.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// resolveRepoId
// ---------------------------------------------------------------------------

describe('resolveRepoId', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves "owner/name" format to the matching repo UUID', async () => {
    const repo = makeRepo({ id: 'uuid-repo-1', full_name: 'acme/backend', owner: 'acme', name: 'backend' });
    global.fetch = vi.fn().mockResolvedValue(makeOkResponse([repo]));

    const id = await resolveRepoId('acme/backend');
    expect(id).toBe('uuid-repo-1');
  });

  it('also matches by full_name direct equality', async () => {
    const repo = makeRepo({ id: 'uuid-repo-2', full_name: 'org/monorepo' });
    global.fetch = vi.fn().mockResolvedValue(makeOkResponse([repo]));

    const id = await resolveRepoId('org/monorepo');
    expect(id).toBe('uuid-repo-2');
  });

  it('throws an actionable ApiError when the repo is not found', async () => {
    const repo = makeRepo({ full_name: 'other/project' });
    global.fetch = vi.fn().mockResolvedValue(makeOkResponse([repo]));

    let caught: ApiError | undefined;
    try {
      await resolveRepoId('missing/repo');
    } catch (e) {
      if (e instanceof ApiError) caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.code).toBe('repo_not_found');
    expect(caught?.status).toBe(404);
    // Message must mention the queried name and list available repos.
    expect(caught?.message).toContain('"missing/repo"');
    expect(caught?.message).toContain('other/project');
  });

  it('reports "none" when the workspace has no repos', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeOkResponse([]));

    let caught: ApiError | undefined;
    try {
      await resolveRepoId('any/repo');
    } catch (e) {
      if (e instanceof ApiError) caught = e;
    }
    expect(caught?.message).toContain('none');
  });
});

// ---------------------------------------------------------------------------
// resolvePullId
// ---------------------------------------------------------------------------

describe('resolvePullId', () => {
  it('resolves (repo, prNumber) to the pull-request UUID', async () => {
    const repo = makeRepo({ id: 'r-1', full_name: 'owner/repo', owner: 'owner', name: 'repo' });
    const pr = makePrMeta({ id: 'pr-uuid-1', number: 7 });

    // First call → /repos (list), second call → /repos/:id/pulls
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse([repo]))
      .mockResolvedValueOnce(makeOkResponse([pr]));

    const id = await resolvePullId('owner/repo', 7);
    expect(id).toBe('pr-uuid-1');
  });

  it('throws an actionable error when the PR number is not found', async () => {
    const repo = makeRepo({ id: 'r-1', full_name: 'owner/repo', owner: 'owner', name: 'repo' });
    const pr = makePrMeta({ id: 'pr-uuid-99', number: 99 });

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse([repo]))
      .mockResolvedValueOnce(makeOkResponse([pr]));

    let caught: ApiError | undefined;
    try {
      await resolvePullId('owner/repo', 42);
    } catch (e) {
      if (e instanceof ApiError) caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.code).toBe('pull_not_found');
    expect(caught?.status).toBe(404);
    expect(caught?.message).toContain('#42');
    expect(caught?.message).toContain('"owner/repo"');
  });

  it('throws when the PR row has no internal id (sync incomplete)', async () => {
    const repo = makeRepo({ id: 'r-1', full_name: 'owner/repo', owner: 'owner', name: 'repo' });
    // PrMeta with no id (id is nullish by the contract)
    const pr = { ...makePrMeta({ number: 5 }), id: undefined };

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse([repo]))
      .mockResolvedValueOnce(makeOkResponse([pr]));

    let caught: ApiError | undefined;
    try {
      await resolvePullId('owner/repo', 5);
    } catch (e) {
      if (e instanceof ApiError) caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.code).toBe('pull_missing_id');
  });

  it('propagates resolver failure when the repo is unknown', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeOkResponse([]));

    let caught: ApiError | undefined;
    try {
      await resolvePullId('no/such', 1);
    } catch (e) {
      if (e instanceof ApiError) caught = e;
    }
    expect(caught?.code).toBe('repo_not_found');
  });

  it('makes HTTP calls with the correct paths', async () => {
    const repo = makeRepo({ id: 'r-special', full_name: 'owner/repo', owner: 'owner', name: 'repo' });
    const pr = makePrMeta({ id: 'pr-1', number: 1 });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeOkResponse([repo]))
      .mockResolvedValueOnce(makeOkResponse([pr]));
    global.fetch = fetchMock;

    await resolvePullId('owner/repo', 1);

    // First call → GET /repos
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/repos');
    // Second call → GET /repos/r-special/pulls
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain('/repos/r-special/pulls');
  });
});

// ---------------------------------------------------------------------------
// ApiError shape
// ---------------------------------------------------------------------------

describe('ApiError', () => {
  it('is an instance of Error', () => {
    const err = new ApiError(500, 'server_error', 'Internal server error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });

  it('exposes status, code, message, and optional details', () => {
    const err = new ApiError(422, 'validation', 'Invalid input', { field: 'name' });
    expect(err.status).toBe(422);
    expect(err.code).toBe('validation');
    expect(err.message).toBe('Invalid input');
    expect(err.details).toEqual({ field: 'name' });
    expect(err.name).toBe('ApiError');
  });
});

// ---------------------------------------------------------------------------
// getRepos (basic happy path — validates correct path is called)
// ---------------------------------------------------------------------------

describe('getRepos', () => {
  it('fetches /repos and returns the parsed array', async () => {
    const repos = [makeRepo()];
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse(repos));
    global.fetch = fetchMock;

    const result = await getRepos();
    expect(result).toEqual(repos);
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/repos');
  });
});
