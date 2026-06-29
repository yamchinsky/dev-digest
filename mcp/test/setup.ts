/**
 * Shared test fixtures and helpers for the mcp/ test suite.
 *
 * NOT a vitest setupFile (vitest.config.ts has no setupFiles entry that points
 * here). Import this module explicitly from the test files that need it.
 * Do NOT place vi.mock() calls here — mock hoisting only works inside test files.
 */

import type { Agent, Repo, PrMeta, RunSummary, ReviewRecord, FindingRecord } from '../src/types.js';
import type { ConventionRow } from '../src/types.js';

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-uuid-1',
    name: 'Test Agent',
    description: 'Reviews code for correctness and security.',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    system_prompt: 'You are a code reviewer.',
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------

export function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-uuid-1',
    workspace_id: 'ws-default',
    owner: 'owner',
    name: 'repo',
    full_name: 'owner/repo',
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PrMeta
// ---------------------------------------------------------------------------

export function makePrMeta(overrides: Partial<PrMeta> = {}): PrMeta {
  return {
    id: 'pull-uuid-1',
    number: 42,
    title: 'feat: add new feature',
    author: 'testuser',
    branch: 'feature/test',
    base: 'main',
    head_sha: 'abc123def456',
    additions: 20,
    deletions: 5,
    files_count: 3,
    status: 'needs_review',
    opened_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T01:00:00Z',
    score: null,
    cost_usd: null,
    findings: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RunSummary
// ---------------------------------------------------------------------------

export function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run-uuid-1',
    agent_id: 'agent-uuid-1',
    agent_name: 'Test Agent',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    status: 'done',
    error: null,
    duration_ms: 1500,
    tokens_in: 2000,
    tokens_out: 800,
    findings_count: 3,
    grounding: '3/3 findings grounded to diff',
    ran_at: '2024-01-01T00:01:00Z',
    score: 85,
    blockers: 0,
    cost_usd: 0.025,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FindingRecord
// ---------------------------------------------------------------------------

export function makeFindingRecord(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: 'finding-uuid-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Missing null check on user input',
    file: 'src/api/handler.ts',
    start_line: 42,
    end_line: 44,
    rationale: 'The user-supplied value may be null, leading to a runtime error.',
    suggestion: 'Add a null guard before accessing the property.',
    confidence: 0.9,
    kind: null,
    trifecta_components: null,
    evidence: null,
    review_id: 'review-uuid-1',
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ReviewRecord
// ---------------------------------------------------------------------------

export function makeReviewRecord(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'review-uuid-1',
    pr_id: 'pull-uuid-1',
    agent_id: 'agent-uuid-1',
    run_id: 'run-uuid-1',
    agent_name: 'Test Agent',
    kind: 'review',
    verdict: 'approve',
    summary: 'The PR looks good overall with one minor issue.',
    score: 88,
    model: 'claude-3-5-sonnet-20241022',
    grounding: '2/3 findings grounded',
    created_at: '2024-01-01T00:02:00Z',
    findings: [makeFindingRecord()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ConventionRow
// ---------------------------------------------------------------------------

export function makeConventionRow(overrides: Partial<ConventionRow> = {}): ConventionRow {
  return {
    id: 'conv-uuid-1',
    category: 'naming',
    rule: 'Use camelCase for local variables',
    description: 'All JavaScript/TypeScript local variable names should use camelCase notation.',
    confidence: 0.95,
    status: 'approved',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// API error envelope
// ---------------------------------------------------------------------------

/** Returns the { error: { code, message, details? } } envelope the server sends. */
export function makeApiErrorEnvelope(
  code: string,
  message: string,
  details?: unknown,
): { error: { code: string; message: string; details?: unknown } } {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

/** Returns a mock Response-like object for a successful JSON response. */
export function makeOkResponse(body: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

/** Returns a mock Response-like object for an error response. */
export function makeErrorResponse(
  status: number,
  body: unknown,
): { ok: false; status: number; json: () => Promise<unknown> } {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
  };
}
