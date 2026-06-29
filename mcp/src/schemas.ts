/**
 * MCP tool Zod schemas.
 *
 * IMPORTANT — SDK shape contract (as of @modelcontextprotocol/sdk v1.29.0):
 *   McpServer.registerTool(name, { inputSchema, outputSchema }, handler)
 *   accepts both:
 *     - ZodRawShapeCompat = Record<string, ZodTypeAny>  ← plain object of fields
 *     - AnySchema = z.ZodTypeAny                        ← wrapped z.object(...)
 *
 *   We export ZodRawShape objects (plain Record<string, ZodTypeAny>) for both
 *   inputSchema and outputSchema. The SDK wraps them internally via objectFromShape().
 *   TypeScript infers the callback's arg type from the raw shape automatically.
 *
 *   T2/T3/T4 import the *Shape objects and pass them directly to registerTool().
 *
 * Design:
 *   - Flat objects only (no nested z.object) — keeps tool schemas compact in
 *     the MCP tools/list response (token footprint requirement).
 *   - Every field has a .describe() call.
 *   - Enum values / defaults are explicit so the LLM knows valid choices.
 */

import { z } from 'zod';

// ── 1. list_agents ──────────────────────────────────────────────────────────

export const listAgentsInputShape = {
  includeDisabled: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, also return disabled agents. Defaults to false (only enabled agents).',
    ),
};

export const listAgentsOutputShape = {
  agents: z
    .array(
      z.object({
        id: z.string().describe('Agent UUID used as agentId in run_agent_on_pr.'),
        name: z.string().describe('Human-readable agent name.'),
        description: z.string().describe('What this agent reviews for.'),
        provider: z.string().describe('LLM provider (openai | anthropic | openrouter).'),
        model: z.string().describe('Model identifier used by this agent.'),
        enabled: z.boolean().describe('Whether the agent is currently enabled.'),
      }),
    )
    .describe('Configured review agents.'),
  count: z.number().int().nonnegative().describe('Total number of agents in the response.'),
};

// ── 2. run_agent_on_pr ──────────────────────────────────────────────────────

export const runAgentOnPrInputShape = {
  repo: z
    .string()
    .describe(
      'Repository in "owner/name" format (e.g. "acme/backend"). Must be synced in DevDigest.',
    ),
  prNumber: z
    .number()
    .int()
    .min(1)
    .describe('Pull request number (e.g. 42). Must be ≥ 1.'),
  agentId: z
    .string()
    .describe('Agent UUID from list_agents. The review agent to run.'),
};

export const runAgentOnPrOutputShape = {
  pullId: z.string().describe('Internal DevDigest UUID for the pull request.'),
  runId: z.string().describe('UUID of the review run that was started and completed.'),
  status: z
    .string()
    .describe('Terminal run status: "done", "failed", or "cancelled".'),
  verdict: z
    .string()
    .nullable()
    .describe('Review verdict: "approve", "request_changes", or "comment". Null on failure.'),
  score: z
    .number()
    .int()
    .nullable()
    .describe('Quality score 0–100 (higher is better). Null if not computed.'),
  grounding: z
    .string()
    .nullable()
    .describe('Citation-grounding summary (how many findings were anchored to the diff).'),
  counts: z
    .object({
      total: z.number().int().nonnegative(),
      critical: z.number().int().nonnegative(),
      warning: z.number().int().nonnegative(),
      suggestion: z.number().int().nonnegative(),
    })
    .describe('Counts of findings by severity.'),
  summary: z
    .string()
    .nullable()
    .describe("Agent's overall review summary paragraph."),
  findings: z
    .array(
      z.object({
        severity: z.string().describe('CRITICAL | WARNING | SUGGESTION'),
        category: z.string().describe('bug | security | perf | style | test'),
        title: z.string().describe('One-line finding title.'),
        file: z.string().describe('Source file path.'),
        line: z.number().int().describe('Starting line number in the diff.'),
        rationale: z.string().describe('Explanation of the issue.'),
      }),
    )
    .describe('Individual findings from this review run.'),
};

// ── 3. get_findings ─────────────────────────────────────────────────────────

export const getFindingsInputShape = {
  repo: z
    .string()
    .describe(
      'Repository in "owner/name" format. Must be synced in DevDigest.',
    ),
  prNumber: z
    .number()
    .int()
    .min(1)
    .describe('Pull request number. Must be ≥ 1.'),
  agentId: z
    .string()
    .optional()
    .describe(
      'Optional agent UUID to filter by. When omitted, returns the latest completed review.',
    ),
};

export const getFindingsOutputShape = {
  pullId: z.string().describe('Internal DevDigest UUID for the pull request.'),
  reviewId: z.string().describe('UUID of the review record.'),
  agentName: z
    .string()
    .nullable()
    .describe('Name of the agent that produced this review.'),
  verdict: z
    .string()
    .nullable()
    .describe('Review verdict: "approve", "request_changes", or "comment".'),
  score: z
    .number()
    .int()
    .nullable()
    .describe('Quality score 0–100 (higher is better).'),
  grounding: z
    .string()
    .nullable()
    .describe('Citation-grounding summary.'),
  counts: z
    .object({
      total: z.number().int().nonnegative(),
      critical: z.number().int().nonnegative(),
      warning: z.number().int().nonnegative(),
      suggestion: z.number().int().nonnegative(),
    })
    .describe('Counts of findings by severity.'),
  summary: z
    .string()
    .nullable()
    .describe("Agent's overall review summary paragraph."),
  reviewedAt: z
    .string()
    .describe('ISO 8601 timestamp of when the review was created.'),
};

// ── 4. get_conventions ──────────────────────────────────────────────────────

export const getConventionsInputShape = {
  repo: z
    .string()
    .describe(
      'Repository in "owner/name" format. Must be synced in DevDigest.',
    ),
  status: z
    .enum(['approved', 'pending', 'rejected'])
    .optional()
    .default('approved')
    .describe(
      'Convention status filter. Defaults to "approved" (only accepted conventions).',
    ),
};

export const getConventionsOutputShape = {
  repoId: z.string().describe('Internal DevDigest UUID for the repository.'),
  conventions: z
    .array(
      z.object({
        category: z.string().describe('Convention category (e.g. "naming", "error-handling").'),
        rule: z.string().describe('The convention rule text.'),
        description: z
          .string()
          .nullable()
          .describe('Optional longer description of the convention.'),
        confidence: z
          .number()
          .describe('Extraction confidence score between 0 and 1.'),
      }),
    )
    .describe('Conventions matching the requested status.'),
  count: z.number().int().nonnegative().describe('Total number of conventions returned.'),
};

// ── 5. get_blast_radius ─────────────────────────────────────────────────────

export const getBlastRadiusInputShape = {
  repo: z
    .string()
    .describe(
      'Repository in "owner/name" format. Must be synced in DevDigest.',
    ),
  prNumber: z
    .number()
    .int()
    .min(1)
    .describe('Pull request number. Must be ≥ 1.'),
};

export const getBlastRadiusOutputShape = {
  changed_symbols: z
    .array(
      z.object({
        name: z.string().describe('Symbol name (function, class, variable, etc.).'),
        file: z.string().describe('Source file path containing the symbol.'),
        kind: z.string().describe('Symbol kind (function | class | interface | variable | type | …).'),
      }),
    )
    .describe('Symbols changed directly by this PR.'),
  downstream: z
    .array(
      z.object({
        symbol: z.string().describe('Symbol that other code depends on.'),
        callers: z
          .array(
            z.object({
              name: z.string().describe('Name of the calling function or expression.'),
              file: z.string().describe('File where this caller lives.'),
              line: z.number().int().describe('Line number of the call site.'),
            }),
          )
          .describe('Call sites that invoke this symbol.'),
        endpoints_affected: z
          .array(z.string())
          .describe('HTTP routes/endpoints that transitively call this symbol.'),
        crons_affected: z
          .array(z.string())
          .describe('Cron/scheduler jobs that transitively call this symbol.'),
      }),
    )
    .describe('Downstream call graph: symbols called by the changed code and their callers.'),
  summary: z
    .string()
    .describe('Human-readable prose summary of the blast radius.'),
  status: z
    .enum(['full', 'partial', 'degraded', 'failed'])
    .describe(
      'Repo-intel index completeness. "full" = complete analysis; "partial" / "degraded" / "failed" = limited coverage.',
    ),
  degraded_reason: z
    .string()
    .nullable()
    .describe('Why the index is degraded or partial when applicable. Null when status is "full".'),
  prior_prs: z
    .array(
      z.object({
        number: z.number().int().describe('PR number on GitHub.'),
        title: z.string().describe('PR title on GitHub.'),
        pull_id: z.string().describe('Internal DevDigest pull UUID.'),
      }),
    )
    .describe('Prior PRs that touched the same files as this PR (possible context / conflict risk).'),
};
