/**
 * Pure formatting helpers for MCP tool responses.
 *
 * This is the SINGLE point in the MCP package that applies wrapUntrusted().
 * All untrusted text from the API (finding titles, rationales, file paths,
 * summaries, convention rules/descriptions) MUST be wrapped here before being
 * returned to the LLM.
 *
 * wrapUntrusted is imported from the reviewer-core subpath to avoid pulling
 * the openai SDK that the barrel index re-exports (openrouter provider).
 */

// Subpath import avoids the openai import in reviewer-core/src/index.ts.
// With moduleResolution:Bundler, @devdigest/reviewer-core/prompt.js resolves
// to ../reviewer-core/src/prompt.ts via the tsconfig path alias wildcard.
import { wrapUntrusted } from '@devdigest/reviewer-core/prompt.js';

import type { FindingRecord } from './types.js';

// ---------------------------------------------------------------------------
// wrapUntrusted re-export (the single application point)
// ---------------------------------------------------------------------------

/**
 * Wraps an untrusted string in a prompt-injection-safe delimiter.
 * Use for all PR/repo text: file paths, titles, rationales, summaries,
 * convention rules, and descriptions before returning them to the LLM.
 */
export { wrapUntrusted };

// ---------------------------------------------------------------------------
// Finding count summary
// ---------------------------------------------------------------------------

/** Returns e.g. "23 findings: 3 critical, 12 warning, 8 suggestion" */
export function summarizeCounts(findings: Pick<FindingRecord, 'severity'>[]): string {
  const critical = findings.filter((f) => f.severity === 'CRITICAL').length;
  const warning = findings.filter((f) => f.severity === 'WARNING').length;
  const suggestion = findings.filter((f) => f.severity === 'SUGGESTION').length;
  const total = findings.length;

  if (total === 0) return '0 findings';

  const parts: string[] = [];
  if (critical > 0) parts.push(`${critical} critical`);
  if (warning > 0) parts.push(`${warning} warning`);
  if (suggestion > 0) parts.push(`${suggestion} suggestion`);

  return `${total} findings: ${parts.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Verdict / score line
// ---------------------------------------------------------------------------

/** Returns e.g. "approve (score: 87/100)" or "request_changes (score: 34/100)" */
export function verdictLine(verdict: string | null, score: number | null): string {
  const v = verdict ?? 'unknown';
  const s = score !== null ? ` (score: ${score}/100)` : '';
  return `${v}${s}`;
}

// ---------------------------------------------------------------------------
// Finding count object (structured, for outputSchema)
// ---------------------------------------------------------------------------

export interface FindingCounts {
  total: number;
  critical: number;
  warning: number;
  suggestion: number;
}

export function buildCounts(findings: Pick<FindingRecord, 'severity'>[]): FindingCounts {
  return {
    total: findings.length,
    critical: findings.filter((f) => f.severity === 'CRITICAL').length,
    warning: findings.filter((f) => f.severity === 'WARNING').length,
    suggestion: findings.filter((f) => f.severity === 'SUGGESTION').length,
  };
}
