import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillRow, EvalCaseRow, SkillEvalRunRow } from '../../db/rows.js';

/**
 * Skill-eval — the ONLY Drizzle importer for skill_eval_runs. It also reads
 * `skills` and `eval_cases` (owner_kind='skill') directly — the benchmark's own
 * queries, NOT via the skills/eval modules' repositories (§13 onion-architecture:
 * a module owns its reads; it does not import another module's data layer).
 */

export type { SkillEvalRunRow };

export interface InsertRun {
  workspaceId: string;
  skillId: string;
  status: 'running' | 'done' | 'failed';
  skillVersion: number | null;
  provider: string;
  model: string;
}

export interface UpdateRun {
  status?: 'running' | 'done' | 'failed';
  withMetrics?: unknown;
  withoutMetrics?: unknown;
  cases?: unknown;
  costUsd?: number | null;
  error?: string | null;
  finishedAt?: Date | null;
}

export class SkillEvalRepository {
  constructor(private db: Db) {}

  // ---- skills / benchmark cases (own reads) ----------------------------

  async getSkillById(workspaceId: string, skillId: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.id, skillId), eq(t.skills.workspaceId, workspaceId)));
    return row;
  }

  /** Benchmark cases for a skill (eval_cases with owner_kind='skill'). */
  getBenchmarkCases(workspaceId: string, skillId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'skill'),
          eq(t.evalCases.ownerId, skillId),
        ),
      );
  }

  // ---- skill_eval_runs -------------------------------------------------

  async insertRun(data: InsertRun): Promise<SkillEvalRunRow> {
    const [row] = await this.db
      .insert(t.skillEvalRuns)
      .values({
        workspaceId: data.workspaceId,
        skillId: data.skillId,
        status: data.status,
        skillVersion: data.skillVersion,
        provider: data.provider,
        model: data.model,
      })
      .returning();
    return row!;
  }

  async updateRun(id: string, patch: UpdateRun): Promise<SkillEvalRunRow | undefined> {
    const [row] = await this.db
      .update(t.skillEvalRuns)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.withMetrics !== undefined ? { withMetrics: patch.withMetrics as object } : {}),
        ...(patch.withoutMetrics !== undefined
          ? { withoutMetrics: patch.withoutMetrics as object }
          : {}),
        ...(patch.cases !== undefined ? { cases: patch.cases as object } : {}),
        ...(patch.costUsd !== undefined ? { costUsd: patch.costUsd } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
      })
      .where(eq(t.skillEvalRuns.id, id))
      .returning();
    return row;
  }

  listRuns(workspaceId: string, skillId: string): Promise<SkillEvalRunRow[]> {
    return this.db
      .select()
      .from(t.skillEvalRuns)
      .where(
        and(
          eq(t.skillEvalRuns.workspaceId, workspaceId),
          eq(t.skillEvalRuns.skillId, skillId),
        ),
      )
      .orderBy(desc(t.skillEvalRuns.createdAt));
  }

  async getRunById(workspaceId: string, id: string): Promise<SkillEvalRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillEvalRuns)
      .where(and(eq(t.skillEvalRuns.id, id), eq(t.skillEvalRuns.workspaceId, workspaceId)));
    return row;
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    const rows = await this.db
      .update(t.skillEvalRuns)
      .set({ status: 'failed', error: 'orphaned by restart', finishedAt: new Date() })
      .where(eq(t.skillEvalRuns.status, 'running'))
      .returning({ id: t.skillEvalRuns.id });
    return rows.length;
  }
}
