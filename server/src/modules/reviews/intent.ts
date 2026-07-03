import { formatChangedFilesWithHunkHeaders } from '@devdigest/reviewer-core';
import type { UnifiedDiff } from '@devdigest/shared';
import { Intent } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConfigError, ExternalServiceError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { PullRow } from './repository.js';
import type * as schema from '../../db/schema.js';

// LinkedIssueMeta and resolveLinkedIssue moved to platform/github-utils.ts
// (SPEC-03 arch review — infrastructure-shared utility, not reviews-owned).
import type { LinkedIssueMeta } from '../../platform/github-utils.js';
export type { LinkedIssueMeta };

/**
 * Result returned by `deriveIntent` — the structured Intent plus the
 * observability fields (provider, model, token counts).
 */
export interface IntentDerivationResult {
  intent: Intent;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

const SYSTEM_PROMPT = `You are a PR intent classifier. Given a pull request's title, description, linked issue details (when available), and a compact list of changed files with hunk headers (no diff line bodies), classify the PR's intent and scope.

Output a JSON object with exactly three fields:
- "intent": a single concise sentence describing what this PR does and why (the motivation/goal).
- "in_scope": an array of short strings listing the files, components, or concerns that are clearly within the scope of this change.
- "out_of_scope": an array of short strings listing related areas that this PR deliberately does NOT touch.

Use the ticket/spec/plan text in the PR body and linked issue as the primary motivation signals. Use the file list only to confirm and refine scope — do NOT reference specific added or removed lines.`;

/**
 * Derive a PR's intent + scope via a dedicated cheap LLM call.
 *
 * (a) Resolves provider+model via `resolveFeatureModel` (never hardcoded).
 * (b) Accepts a pre-fetched `linkedIssue` to avoid extra network calls;
 *     callers use `resolveLinkedIssue` (below) to look it up best-effort —
 *     on any miss/failure the issue block is simply omitted.
 * (c) Builds the user message from title, body, linked-issue body, and the
 *     compact `formatChangedFilesWithHunkHeaders` output — NO diff line bodies.
 * (d) Calls `llm.completeStructured` with `schema: Intent, maxRetries: 1`.
 * (e) Wraps LLM/provider errors in `ExternalServiceError`; lets `ConfigError`
 *     (missing API key) pass through so callers can distinguish the two.
 */
export async function deriveIntent(
  container: Container,
  workspaceId: string,
  pull: PullRow,
  _repo: typeof schema.repos.$inferSelect,
  diff: UnifiedDiff,
  opts: {
    /**
     * Pre-resolved linked issue. When provided, its title and body are included
     * in the intent input without an additional GitHub API call. Best-effort;
     * when absent the issue block is simply omitted.
     */
    linkedIssue?: LinkedIssueMeta | null;
  } = {},
): Promise<IntentDerivationResult> {
  // (a) Resolve the cheap model configured for `review_intent`.
  const { provider, model } = await resolveFeatureModel(container, workspaceId, 'review_intent');

  // (b) Use the pre-resolved linked issue when the caller provides it.
  // No live GitHub resolve here — `deriveIntent` does not have the repo
  // owner/name (only `repoId` is on PullRow). Callers that have already
  // fetched the PrDetail can pass the linked issue via `opts.linkedIssue`;
  // when omitted, the issue block is simply absent from the intent input.
  // This is best-effort by design: a missing issue does NOT block derivation.
  const linkedIssue: LinkedIssueMeta | null = opts.linkedIssue ?? null;

  // (c) Build the user message. Include only:
  //   - PR title + body
  //   - linked-issue title + body (when available)
  //   - compact file list with reconstructed @@ hunk headers (NO line bodies)
  const fileList = formatChangedFilesWithHunkHeaders(diff);

  const parts: string[] = [];
  parts.push(`## PR Title\n${pull.title}`);
  if (pull.body?.trim()) {
    parts.push(`## PR Description\n${pull.body.trim()}`);
  }
  if (linkedIssue) {
    const issueBody = linkedIssue.body?.trim() ? `\n\n${linkedIssue.body.trim()}` : '';
    parts.push(`## Linked Issue\n${linkedIssue.title}${issueBody}`);
  }
  parts.push(`## Changed Files (hunk headers only — no diff line bodies)\n${fileList}`);

  const userMessage = parts.join('\n\n');

  // (d) Resolve the LLM provider and call completeStructured.
  let llm;
  try {
    llm = await container.llm(provider as 'openai' | 'anthropic' | 'openrouter');
  } catch (err) {
    // ConfigError (missing API key) passes through; all other failures become
    // ExternalServiceError so the caller knows the provider is unavailable.
    if (err instanceof ConfigError) throw err;
    throw new ExternalServiceError(
      `intent-derive: failed to get LLM provider "${provider}"`,
      err instanceof Error ? err.message : String(err),
    );
  }

  let result;
  try {
    result = await llm.completeStructured({
      model,
      schema: Intent,
      schemaName: 'Intent',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      maxRetries: 1,
    });
  } catch (err) {
    throw new ExternalServiceError(
      `intent-derive: LLM call failed (${provider}/${model})`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return {
    intent: result.data,
    provider,
    model,
    // StructuredResult always has tokensIn/tokensOut. If the provider returns
    // 0 (e.g. a provider that does not emit usage) we propagate 0 as-is.
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}

