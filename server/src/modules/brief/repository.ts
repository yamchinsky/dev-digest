import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';
import { BriefRecord } from '@devdigest/shared';
import type { Intent } from '@devdigest/shared';

/**
 * BriefRepository — reads and writes the pr_brief table and ancillary PR data.
 * The ONLY place in the brief module that touches Drizzle directly.
 */
export class BriefRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped PR lookup (tenancy guard). */
  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /** Return the persisted intent for a PR, or undefined when none exists. */
  async getIntent(prId: string): Promise<Intent | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    if (!row) return undefined;
    return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
  }

  /**
   * Return the persisted brief for a PR, or null when no row exists.
   *
   * Uses safeParse (not .parse) so a malformed stored jsonb logs a warning
   * and returns null — GET always responds HTTP 200 (F2).
   */
  async getBrief(
    prId: string,
    logger?: { warn: (msg: string) => void },
  ): Promise<BriefRecord | null> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    if (!row) return null;
    const parsed = BriefRecord.safeParse(row.json);
    if (!parsed.success) {
      (logger ?? console).warn(`pr_brief row for prId=${prId} failed schema validation — returning null`);
      return null;
    }
    return parsed.data;
  }

  /**
   * Upsert the brief JSON for a PR.
   * INSERT … ON CONFLICT (pr_id) DO UPDATE SET json = EXCLUDED.json
   */
  async upsertBrief(prId: string, json: BriefRecord): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json })
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: { json },
      });
  }
}
