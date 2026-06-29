import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';
import type { PriorPr } from '@devdigest/shared';

/**
 * BlastRepository — three read-only Drizzle queries.
 *
 * 1. `getPull`    — workspace-scoped pull look-up; returns the full row (with
 *                   `repoId`) so the service can verify scope and know which repo.
 * 2. `getPrFiles` — repo-relative file paths changed in the PR; these are fed
 *                   directly to `container.repoIntel.getBlastRadius`.
 * 3. `getPriorPrs`— other PRs in the same repo whose changed files overlap the
 *                   current PR's files; newest first, capped at 5.
 *
 * Drizzle only. No Fastify, no adapters, no other module repositories.
 */
export class BlastRepository {
  constructor(private readonly db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.id, prId), eq(t.pullRequests.workspaceId, workspaceId)));
    return row;
  }

  /** Repo-relative paths of all files changed in the PR. */
  async getPrFiles(prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    return rows.map((r) => r.path);
  }

  /**
   * Find the 5 most-recently-opened PRs in the same repo (excluding the
   * current PR) whose changed files intersect `changedPaths`.
   *
   * Two-query approach (avoids cross-join explosion on large repos):
   *  1. Find candidate PR ids from prFiles whose path is in changedPaths.
   *  2. Scope to repoId, deduplicate, order by openedAt DESC, limit 5.
   */
  async getPriorPrs(
    repoId: string,
    prId: string,
    changedPaths: string[],
  ): Promise<PriorPr[]> {
    if (changedPaths.length === 0) return [];

    // Step 1: which prIds have files that overlap with changedPaths?
    const fileRows = await this.db
      .select({ prId: t.prFiles.prId })
      .from(t.prFiles)
      .where(inArray(t.prFiles.path, changedPaths));

    // Exclude the current PR; dedup.
    const candidateIds = [...new Set(fileRows.map((r) => r.prId))].filter(
      (id) => id !== prId,
    );
    if (candidateIds.length === 0) return [];

    // Step 2: scope to same repo, newest first.
    const prRows = await this.db
      .select({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
      })
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.repoId, repoId),
          inArray(t.pullRequests.id, candidateIds),
        ),
      )
      .orderBy(desc(t.pullRequests.openedAt))
      .limit(5);

    return prRows.map((pr) => ({
      pull_id: pr.id,
      number: pr.number,
      title: pr.title,
    }));
  }
}
