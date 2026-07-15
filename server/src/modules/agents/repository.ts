import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AgentContextDoc, CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
}

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  private async snapshotVersion(row: AgentRow, version: number): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id);
    await this.db
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    const rows = await this.db
      .select({ skill: t.skills, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order }));
  }

  async skillIdsForAgent(agentId: string): Promise<string[]> {
    const links = await this.linkedSkills(agentId);
    return links.map((l) => l.skill.id);
  }

  /** Link a skill to an agent at a given order (idempotent: upserts order). */
  async linkSkill(agentId: string, skillId: string, order: number): Promise<void> {
    await this.db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order })
      .onConflictDoUpdate({
        target: [t.agentSkills.agentId, t.agentSkills.skillId],
        set: { order },
      });
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
  }

  /**
   * Replace the full set of linked skills for an agent with `skillIds`, assigning
   * order = index. Used by the "Skills" editor tab (attach/reorder). Skills not in
   * the list are unlinked.
   */
  async setSkills(agentId: string, skillIds: string[]): Promise<void> {
    await this.db.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
    if (skillIds.length === 0) return;
    await this.db
      .insert(t.agentSkills)
      .values(skillIds.map((skillId, i) => ({ agentId, skillId, order: i })));
  }

  // ---- agent_context_docs --------------------------------------------------

  /** Context docs linked to an agent, in `order` ascending. */
  async getContextDocs(agentId: string): Promise<AgentContextDoc[]> {
    const rows = await this.db
      .select()
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.order));
    return rows.map((r) => ({
      agent_id: r.agentId,
      repo_id: r.repoId,
      relative_path: r.relativePath,
      order: r.order,
    }));
  }

  /**
   * Context doc paths for an agent (lightweight projection used by run-executor).
   * Returns raw camelCase fields to avoid unnecessary DTO allocation on the hot path.
   */
  async getContextDocPaths(
    agentId: string,
  ): Promise<Array<{ repoId: string; relativePath: string; order: number }>> {
    const rows = await this.db
      .select()
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.order));
    return rows.map((r) => ({ repoId: r.repoId, relativePath: r.relativePath, order: r.order }));
  }

  /**
   * Return the last 3 `status='done'` `agent_runs` rows for EACH agent in
   * `agentIds` that belongs to `workspaceId`. Uses a single SQL query with a
   * ROW_NUMBER() window function — NOT N+1 per agent.
   *
   * Returns an array of rows, at most 3 per agent id. Each row carries the
   * agent_id, duration_ms, tokens_in, tokens_out, and model needed for the
   * estimate computation.
   */
  async lastDoneRunsPerAgent(
    workspaceId: string,
    agentIds: string[],
  ): Promise<
    Array<{
      agentId: string | null;
      durationMs: number | null;
      tokensIn: number | null;
      tokensOut: number | null;
      model: string | null;
    }>
  > {
    if (agentIds.length === 0) return [];

    // Build a parameterised ANY($n) array via Drizzle's sql template tag.
    // agentIds are internal UUIDs but we still use parameterised SQL to keep
    // consistent with the rest of the codebase's injection-safe pattern.
    const rows = await this.db.execute(sql`
      SELECT agent_id AS "agentId",
             duration_ms AS "durationMs",
             tokens_in AS "tokensIn",
             tokens_out AS "tokensOut",
             model
      FROM (
        SELECT agent_id, duration_ms, tokens_in, tokens_out, model,
               ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY ran_at DESC) AS rn
        FROM agent_runs
        WHERE workspace_id = ${workspaceId}
          AND status = 'done'
          AND agent_id = ANY(${sql`ARRAY[${sql.join(
            agentIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]`})
      ) ranked
      WHERE rn <= 3
    `);

    return (rows as Array<Record<string, unknown>>).map((r) => ({
      agentId: (r['agentId'] as string | null) ?? null,
      durationMs: (r['durationMs'] as number | null) ?? null,
      tokensIn: (r['tokensIn'] as number | null) ?? null,
      tokensOut: (r['tokensOut'] as number | null) ?? null,
      model: (r['model'] as string | null) ?? null,
    }));
  }

  // ---- agent performance aggregation (dashboard + per-agent Stats) --------

  /**
   * Per-run rows for `status='done'` runs inside a time window, workspace-scoped
   * and optionally filtered to one agent. Carries exactly the fields the service
   * folds into performance metrics: cost (via PriceBook — computed on read, never
   * stored), latency, last-run, and the findings-per-run trend. Ordered
   * oldest→newest so the service can slice the trend tail directly.
   *
   * Windowed by `ran_at`. Both the global dashboard (`GET /agents/performance`)
   * and the per-agent Stats tab (`GET /agents/:id/stats`) call this, guaranteeing
   * the two surfaces report identical numbers for the same agent + period.
   */
  async doneRunsInWindow(
    workspaceId: string,
    since: Date,
    until: Date,
    agentId?: string,
  ): Promise<
    Array<{
      agentId: string | null;
      model: string | null;
      tokensIn: number | null;
      tokensOut: number | null;
      durationMs: number | null;
      ranAt: Date | null;
      findingsCount: number | null;
    }>
  > {
    const agentFilter = agentId ? sql`AND agent_id = ${agentId}::uuid` : sql``;
    const rows = await this.db.execute(sql`
      SELECT agent_id AS "agentId",
             model,
             tokens_in AS "tokensIn",
             tokens_out AS "tokensOut",
             duration_ms AS "durationMs",
             ran_at AS "ranAt",
             findings_count AS "findingsCount"
      FROM agent_runs
      WHERE workspace_id = ${workspaceId}
        AND status = 'done'
        AND ran_at >= ${since.toISOString()}::timestamptz
        AND ran_at < ${until.toISOString()}::timestamptz
        ${agentFilter}
      ORDER BY ran_at ASC
    `);

    return (rows as Array<Record<string, unknown>>).map((r) => ({
      agentId: (r['agentId'] as string | null) ?? null,
      model: (r['model'] as string | null) ?? null,
      tokensIn: r['tokensIn'] == null ? null : Number(r['tokensIn']),
      tokensOut: r['tokensOut'] == null ? null : Number(r['tokensOut']),
      durationMs: r['durationMs'] == null ? null : Number(r['durationMs']),
      ranAt: r['ranAt'] == null ? null : new Date(r['ranAt'] as string | number | Date),
      findingsCount: r['findingsCount'] == null ? null : Number(r['findingsCount']),
    }));
  }

  /**
   * Per-agent findings aggregation in a time window: join `findings → reviews`
   * and group by `reviews.agent_id`. Accept/dismiss counts drive the accept-rate
   * (accepted / (accepted + dismissed)); the FILTERed counts drive
   * findings_by_severity. Windowed by `reviews.created_at`. Optionally scoped to
   * one agent (per-agent Stats tab).
   */
  async findingsAggInWindow(
    workspaceId: string,
    since: Date,
    until: Date,
    agentId?: string,
  ): Promise<
    Array<{
      agentId: string;
      findingsTotal: number;
      accepted: number;
      dismissed: number;
      critical: number;
      warning: number;
      suggestion: number;
    }>
  > {
    const agentFilter = agentId ? sql`AND r.agent_id = ${agentId}::uuid` : sql``;
    const rows = await this.db.execute(sql`
      SELECT r.agent_id AS "agentId",
             count(f.id) AS "findingsTotal",
             count(f.accepted_at) AS "accepted",
             count(f.dismissed_at) AS "dismissed",
             count(*) FILTER (WHERE f.severity = 'CRITICAL') AS "critical",
             count(*) FILTER (WHERE f.severity = 'WARNING') AS "warning",
             count(*) FILTER (WHERE f.severity = 'SUGGESTION') AS "suggestion"
      FROM findings f
      JOIN reviews r ON f.review_id = r.id
      WHERE r.workspace_id = ${workspaceId}
        AND r.agent_id IS NOT NULL
        AND r.created_at >= ${since.toISOString()}::timestamptz
        AND r.created_at < ${until.toISOString()}::timestamptz
        ${agentFilter}
      GROUP BY r.agent_id
    `);

    return (rows as Array<Record<string, unknown>>).map((r) => ({
      agentId: r['agentId'] as string,
      findingsTotal: Number(r['findingsTotal'] ?? 0),
      accepted: Number(r['accepted'] ?? 0),
      dismissed: Number(r['dismissed'] ?? 0),
      critical: Number(r['critical'] ?? 0),
      warning: Number(r['warning'] ?? 0),
      suggestion: Number(r['suggestion'] ?? 0),
    }));
  }

  /**
   * Atomically replace the full context-doc set for an agent.
   * Single Drizzle transaction: DELETE all existing rows, then bulk INSERT
   * the new set. An empty `items` array performs only the DELETE.
   */
  async replaceContextDocs(
    agentId: string,
    items: Array<{ repoId: string; relativePath: string; order: number }>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
      if (items.length === 0) return;
      await tx.insert(t.agentContextDocs).values(
        items.map((item) => ({
          agentId,
          repoId: item.repoId,
          relativePath: item.relativePath,
          order: item.order,
        })),
      );
    });
  }
}
