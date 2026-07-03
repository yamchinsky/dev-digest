import type { Container } from './container.js';
import type * as schema from '../db/schema.js';

/**
 * Cross-cutting GitHub helpers shared by feature modules (reviews' intent
 * derivation, brief generation, …). Moved here from `modules/reviews/intent.ts`
 * after the SPEC-03 architecture review: a module-owned helper consumed by a
 * peer module creates a service-layer cross-module dependency; platform/ is
 * the canonical home for infrastructure-shared utilities.
 */

/**
 * Linked-issue data accepted by intent/brief assembly. The caller may already
 * have this (e.g. fetched from GitHub at PR sync time); passing it in avoids
 * an extra network round-trip in the hot path.
 */
export interface LinkedIssueMeta {
  title: string;
  body?: string | null;
}

/**
 * Issue-reference heuristic, kept in sync with the octokit import-time
 * resolver (`adapters/github/octokit.ts`): `Closes/Fixes/Resolves #N`, with
 * the keyword optional so a bare `#N` also matches.
 */
const LINKED_ISSUE_RE = /(?:closes|fixes|resolves)?\s*#(\d+)/i;

/**
 * Best-effort resolve of a PR's linked issue from its body, via the GitHub
 * port. Returns the issue title + body when a `#N` reference resolves, or
 * `null` when there is no reference, no GitHub token, or the API call fails.
 * NEVER throws — callers stay best-effort even when GitHub is unavailable,
 * and simply proceed without the linked-issue context.
 */
export async function resolveLinkedIssue(
  container: Container,
  repoRow: typeof schema.repos.$inferSelect,
  body: string | null | undefined,
): Promise<LinkedIssueMeta | null> {
  const match = body?.match(LINKED_ISSUE_RE);
  if (!match?.[1]) return null;
  try {
    const github = await container.github();
    const issue = await github.getIssue({ owner: repoRow.owner, name: repoRow.name }, Number(match[1]));
    return { title: issue.title, body: issue.body };
  } catch {
    return null;
  }
}
