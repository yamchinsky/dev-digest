import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Workspace context-docs repository.
 *
 * Owns only the read-side aggregation query needed by WorkspaceService to
 * enrich discovered docs with agent-attachment counts. Drizzle is never
 * imported outside this file within the workspace module.
 */
export class WorkspaceRepository {
  constructor(private db: Db) {}

  /**
   * Returns a map of `${repoId}:${relativePath}` → number of distinct agents
   * in `workspaceId` that have this doc attached.
   *
   * ONE GROUP BY query — not N+1. Pre-populates every supplied path with 0 so
   * callers never need to check for missing keys.
   */
  async agentCountsForPaths(
    workspaceId: string,
    paths: Array<{ repoId: string; relativePath: string }>,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    // Pre-populate with 0 so every discovered path has a default count
    for (const p of paths) {
      map.set(`${p.repoId}:${p.relativePath}`, 0);
    }

    if (paths.length === 0) return map;

    // Single batch query: join agentContextDocs → agents to scope by workspaceId,
    // then group by (repoId, relativePath) to count distinct agents per doc.
    const rows = await this.db
      .select({
        repoId: t.agentContextDocs.repoId,
        relativePath: t.agentContextDocs.relativePath,
        n: sql<number>`count(*)::int`,
      })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agentContextDocs.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .groupBy(t.agentContextDocs.repoId, t.agentContextDocs.relativePath);

    for (const r of rows) {
      const key = `${r.repoId}:${r.relativePath}`;
      // Only update the map for paths we pre-populated (i.e. discovered paths)
      if (map.has(key)) map.set(key, r.n);
    }

    return map;
  }
}
