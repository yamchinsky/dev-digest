/**
 * DevDigest API HTTP client — the ONLY place in this package that makes HTTP
 * requests. All other code is pure or calls through these methods.
 *
 * Design:
 * - Every request is wrapped in an AbortController timed by config.httpTimeoutMs
 *   (security: no request hangs forever).
 * - Non-2xx responses parse the server's ApiErrorBody envelope and throw a typed
 *   ApiError so callers get actionable error messages.
 * - Never imports server internals (no Drizzle, no Container, no modules/**).
 */

import config from '../config.js';
import type {
  Agent,
  Repo,
  PrMeta,
  RunSummary,
  ReviewRecord,
  ReviewRunResponse,
  ConventionRow,
  BlastRadius,
} from '../types.js';

// ---------------------------------------------------------------------------
// Typed error thrown on non-2xx responses
// ---------------------------------------------------------------------------

export class ApiError extends Error {
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

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);

  const url = `${config.apiUrl}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch (err: unknown) {
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
    if (isAbort) {
      throw new ApiError(
        0,
        'timeout',
        `Request to ${path} timed out after ${config.httpTimeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Attempt to parse the server's { error: { code, message, details? } } envelope.
    let code = 'request_failed';
    let message = `HTTP ${response.status} from ${path}`;
    let details: unknown;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string; details?: unknown };
      };
      if (body.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      // json parse failure — stick with defaults
    }
    throw new ApiError(response.status, code, message, details);
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/** Lists all configured review agents. */
export async function getAgents(): Promise<Agent[]> {
  return request<Agent[]>('/agents');
}

/** Lists all synced repos in the local workspace. */
export async function getRepos(): Promise<Repo[]> {
  return request<Repo[]>('/repos');
}

/** Lists all pull requests for a specific repository. */
export async function getPulls(repoId: string): Promise<PrMeta[]> {
  return request<PrMeta[]>(`/repos/${encodeURIComponent(repoId)}/pulls`);
}

/**
 * Starts a review of a pull request with a given agent.
 * Returns immediately — the review executor runs in the background.
 * Use getRuns() to poll for completion.
 */
export async function startReview(pullId: string, agentId: string): Promise<ReviewRunResponse> {
  return request<ReviewRunResponse>(`/pulls/${encodeURIComponent(pullId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
}

/** Returns all runs (any status) for a pull request. */
export async function getRuns(pullId: string): Promise<RunSummary[]> {
  return request<RunSummary[]>(`/pulls/${encodeURIComponent(pullId)}/runs`);
}

/** Returns all persisted reviews (with findings) for a pull request. */
export async function getReviews(pullId: string): Promise<ReviewRecord[]> {
  return request<ReviewRecord[]>(`/pulls/${encodeURIComponent(pullId)}/reviews`);
}

/**
 * Returns conventions for a repository, optionally filtered by status.
 * Status defaults to 'approved' per the plan's tool surface.
 */
export async function getConventions(
  repoId: string,
  status: 'approved' | 'pending' | 'rejected' = 'approved',
): Promise<ConventionRow[]> {
  return request<ConventionRow[]>(
    `/repos/${encodeURIComponent(repoId)}/conventions?status=${status}`,
  );
}

/** Returns the blast radius analysis for a pull request. */
export async function getBlast(pullId: string): Promise<BlastRadius> {
  return request<BlastRadius>('/pulls/' + encodeURIComponent(pullId) + '/blast');
}

// ---------------------------------------------------------------------------
// Resolvers — match human-readable identifiers to internal UUIDs
// ---------------------------------------------------------------------------

/**
 * Resolves a `repo` string ("owner/name" or full_name) to the internal UUID.
 * Throws an ApiError with an actionable message if no match is found.
 */
export async function resolveRepoId(repo: string): Promise<string> {
  const repos = await getRepos();
  // Support "owner/name" (split) or "full_name" direct match.
  const [owner, name] = repo.includes('/') ? repo.split('/') : [repo, undefined];
  const match = repos.find(
    (r) =>
      r.full_name === repo ||
      (name !== undefined && r.owner === owner && r.name === name),
  );
  if (!match) {
    const available = repos.map((r) => r.full_name).join(', ') || 'none';
    throw new ApiError(
      404,
      'repo_not_found',
      `Repository "${repo}" not found in DevDigest. Available repos: ${available}. ` +
        'Add it via the DevDigest studio first.',
    );
  }
  return match.id;
}

/**
 * Resolves a (repo, prNumber) pair to the internal pull-request UUID.
 * Throws an ApiError with an actionable message if the PR is not found.
 */
export async function resolvePullId(repo: string, prNumber: number): Promise<string> {
  const repoId = await resolveRepoId(repo);
  const pulls = await getPulls(repoId);
  const match = pulls.find((p) => p.number === prNumber);
  if (!match) {
    throw new ApiError(
      404,
      'pull_not_found',
      `PR #${prNumber} not found in "${repo}". ` +
        'Make sure DevDigest has synced this repository and the PR exists.',
    );
  }
  if (!match.id) {
    throw new ApiError(
      500,
      'pull_missing_id',
      `PR #${prNumber} in "${repo}" has no internal id (sync may be incomplete).`,
    );
  }
  return match.id;
}
