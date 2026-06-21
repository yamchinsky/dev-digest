import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';

export type { SkillRow, SkillVersionRow };

/**
 * A1 — skills data-access. Owns `skills` and `skill_versions`. Workspace-scoped
 * throughout; the agent side of the link table is owned by A2 (agents).
 *
 * Versioning policy: updating `body` writes a row to `skill_versions` and
 * bumps `skills.version`. Other field changes do not bump — they're metadata,
 * not the content the LLM reads.
 */

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export interface ListFilter {
  type?: SkillType;
  enabled?: boolean;
  q?: string; // case-insensitive substring match against name + description
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string, filter: ListFilter = {}): Promise<SkillRow[]> {
    const conditions = [eq(t.skills.workspaceId, workspaceId)];
    if (filter.type !== undefined) conditions.push(eq(t.skills.type, filter.type));
    if (filter.enabled !== undefined) conditions.push(eq(t.skills.enabled, filter.enabled));

    const rows = await this.db
      .select()
      .from(t.skills)
      .where(and(...conditions))
      .orderBy(asc(t.skills.name));

    if (!filter.q) return rows;
    const needle = filter.q.toLowerCase();
    return rows.filter(
      (r) => r.name.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle),
    );
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
      })
      .returning();
    await this.snapshotVersion(row!.id, INITIAL_SKILL_VERSION, row!.body);
    return row!;
  }

  /**
   * Update a skill. Returns undefined when the skill isn't in this workspace
   * (route maps to 404). A `body` change bumps `version` and snapshots into
   * `skill_versions` — other fields don't.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row.id, nextVersion, row.body);
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** All immutable body snapshots for a skill, oldest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(asc(t.skillVersions.version));
  }

  /** How many agents currently link this skill. Cheap COUNT on the join table.
   *  Used by the Skill Stats tab. */
  async linkedAgentsCount(skillId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));
    return row?.n ?? 0;
  }

  /** Bulk variant: returns a Map of skill_id → count for the given ids.
   *  Used by the list endpoint to denormalize per-card stats in one query
   *  instead of N queries. Missing ids resolve to 0 (no row in agent_skills). */
  async linkedAgentsCountByIds(ids: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (ids.length === 0) return map;
    const rows = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        n: sql<number>`count(*)::int`,
      })
      .from(t.agentSkills)
      .where(inArray(t.agentSkills.skillId, ids))
      .groupBy(t.agentSkills.skillId);
    for (const r of rows) map.set(r.skillId, r.n);
    for (const id of ids) if (!map.has(id)) map.set(id, 0);
    return map;
  }

  private async snapshotVersion(skillId: string, version: number, body: string): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId, version, body })
      .onConflictDoNothing();
  }
}
