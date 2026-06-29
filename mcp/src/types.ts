/**
 * Shared TS types / DTO aliases for the MCP tools.
 *
 * Re-exports from @devdigest/shared so the tools import a single local module
 * rather than spelling out the full cross-package alias. Never adds definitions
 * that duplicate what shared already provides.
 */

export type {
  // Agents
  Agent,
  Provider,
  ReviewStrategy,

  // Repos + pulls
  Repo,
  PrMeta,

  // Review outputs
  ReviewRecord,
  ReviewRunResponse,
  FindingRecord,
  Verdict,
  Severity,
  FindingCategory,

  // Run trace
  RunSummary,

  // Blast radius
  BlastRadius,
  ChangedSymbol,
  BlastCaller,
  DownstreamImpact,
  BlastIndexStatus,
  PriorPr,
} from '@devdigest/shared';

/**
 * Minimal shape of a convention row returned by GET /repos/:id/conventions.
 * The server returns the raw DB row; we only surface the fields that matter.
 * Defined here (not in api/client.ts) to avoid a circular import chain.
 */
export interface ConventionRow {
  id: string;
  category: string;
  rule: string;
  description: string | null;
  confidence: number;
  status: string;
}
