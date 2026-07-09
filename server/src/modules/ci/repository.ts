import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiInstallation, CiRun, CiRunStatus, CiTarget } from '@devdigest/shared';

/**
 * CI module data-access. Owns `ci_installations` and `ci_runs`. All queries
 * are workspace-scoped (either directly or via the agent FK chain).
 *
 * Drizzle-only — this file must NOT import Fastify, adapters, or another
 * module's repository.
 */

export type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
export type CiRunRow = typeof t.ciRuns.$inferSelect;

export interface InsertCiRun {
  ciInstallationId: string;
  prNumber?: number | null;
  ranAt?: Date | null;
  status?: string | null;
  findingsCount?: number | null;
  costUsd?: number | null;
  githubUrl?: string | null;
  source?: string | null;
  agent?: string | null;
  durationS?: number | null;
  githubRunId?: string | null;
  critical?: number | null;
  warning?: number | null;
  suggestion?: number | null;
}

export interface GetCiRunsFilter {
  workspaceId: string;
  agentId?: string;
  repo?: string;
  status?: string;
  since?: Date;
}

export class CiRepository {
  constructor(private db: Db) {}

  // ---------------------------------------------------------------------------
  // ci_installations
  // ---------------------------------------------------------------------------

  /**
   * Upsert a CI installation for (agent_id, repo, target_type).
   *
   * Uses a select-then-insert/update pattern because the table has no DB-level
   * unique constraint on (agent_id, repo, target_type) — only the application
   * enforces the natural key. Using `onConflictDoUpdate` against columns without
   * a unique index would throw a Postgres error at runtime.
   */
  async upsertInstallation(
    agentId: string,
    repo: string,
    targetType: CiTarget,
  ): Promise<CiInstallationRow> {
    const existing = await this.db
      .select()
      .from(t.ciInstallations)
      .where(
        and(
          eq(t.ciInstallations.agentId, agentId),
          eq(t.ciInstallations.repo, repo),
          eq(t.ciInstallations.targetType, targetType),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const [updated] = await this.db
        .update(t.ciInstallations)
        .set({ installedAt: new Date() })
        .where(eq(t.ciInstallations.id, existing[0].id))
        .returning();
      return updated!;
    }

    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({ agentId, repo, targetType })
      .returning();
    return row!;
  }

  /** All installations for a given agent. */
  async getInstallationsByAgent(agentId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
  }

  /**
   * All installations across agents that belong to a workspace.
   * Joins ci_installations → agents to enforce workspace_id scope.
   */
  async getInstallationsByWorkspace(workspaceId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select({ ciInstallations: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .then((rows) => rows.map((r) => r.ciInstallations));
  }

  // ---------------------------------------------------------------------------
  // ci_runs
  // ---------------------------------------------------------------------------

  /**
   * Insert a CI run row. Uses `onConflictDoNothing` on
   * (ci_installation_id, github_run_id) — the dedup unique index ensures
   * idempotent sync re-runs.
   */
  async insertCiRun(data: InsertCiRun): Promise<CiRunRow | undefined> {
    const [row] = await this.db
      .insert(t.ciRuns)
      .values({
        ciInstallationId: data.ciInstallationId,
        prNumber: data.prNumber ?? null,
        ranAt: data.ranAt ?? null,
        status: data.status ?? null,
        findingsCount: data.findingsCount ?? null,
        costUsd: data.costUsd ?? null,
        githubUrl: data.githubUrl ?? null,
        source: data.source ?? null,
        agent: data.agent ?? null,
        durationS: data.durationS ?? null,
        githubRunId: data.githubRunId ?? null,
        critical: data.critical ?? null,
        warning: data.warning ?? null,
        suggestion: data.suggestion ?? null,
      })
      .onConflictDoNothing({
        target: [t.ciRuns.ciInstallationId, t.ciRuns.githubRunId],
      })
      .returning();
    return row;
  }

  /**
   * Filtered query over CI runs, scoped to a workspace via the join chain
   * ci_runs → ci_installations → agents → workspace_id.
   */
  async getCiRuns(filter: GetCiRunsFilter): Promise<CiRunRow[]> {
    const conditions = [eq(t.agents.workspaceId, filter.workspaceId)];

    if (filter.agentId) {
      conditions.push(eq(t.agents.id, filter.agentId));
    }
    if (filter.repo) {
      conditions.push(eq(t.ciInstallations.repo, filter.repo));
    }
    if (filter.status) {
      conditions.push(eq(t.ciRuns.status, filter.status));
    }
    if (filter.since) {
      conditions.push(gte(t.ciRuns.ranAt, filter.since));
    }

    return this.db
      .select({ ciRuns: t.ciRuns })
      .from(t.ciRuns)
      .innerJoin(
        t.ciInstallations,
        eq(t.ciRuns.ciInstallationId, t.ciInstallations.id),
      )
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(...conditions))
      .then((rows) => rows.map((r) => r.ciRuns));
  }
}

// ---------------------------------------------------------------------------
// DTO mappers — row → contract type
// ---------------------------------------------------------------------------

export function toCiInstallationDto(row: CiInstallationRow): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType as CiTarget,
    installed_at: row.installedAt.toISOString(),
  };
}

export function toCiRunDto(row: CiRunRow): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId ?? null,
    pr_number: row.prNumber ?? null,
    ran_at: row.ranAt ? row.ranAt.toISOString() : null,
    status: row.status ?? null,
    findings_count: row.findingsCount ?? null,
    cost_usd: row.costUsd ?? null,
    github_url: row.githubUrl ?? null,
    source: row.source ?? null,
    agent: row.agent ?? null,
    duration_s: row.durationS ?? null,
    github_run_id: row.githubRunId ?? null,
    critical: row.critical ?? null,
    warning: row.warning ?? null,
    suggestion: row.suggestion ?? null,
  };
}
