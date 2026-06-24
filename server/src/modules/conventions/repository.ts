import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type Convention = typeof t.conventions.$inferSelect;
export type ConventionStatus = 'pending' | 'approved' | 'rejected';

export interface NewCandidate {
  category: string;
  rule: string;
  description?: string;
  evidenceFile: string;
  evidenceLine?: number;
  evidenceSnippet?: string;
  confidence: number;
}

export interface ListFilter {
  runId?: string;
  status?: ConventionStatus;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async createCandidates(
    workspaceId: string,
    repoId: string,
    runId: string,
    items: NewCandidate[],
  ): Promise<number> {
    if (items.length === 0) return 0;
    const rows = await this.db
      .insert(t.conventions)
      .values(
        items.map((item) => ({
          workspaceId,
          repoId,
          runId,
          category: item.category,
          rule: item.rule,
          description: item.description,
          evidenceFile: item.evidenceFile,
          evidenceLine: item.evidenceLine,
          evidenceSnippet: item.evidenceSnippet,
          confidence: item.confidence,
        })),
      )
      .returning({ id: t.conventions.id });
    return rows.length;
  }

  async listByRepo(
    workspaceId: string,
    repoId: string,
    opts: ListFilter = {},
  ): Promise<Convention[]> {
    const conditions = [
      eq(t.conventions.workspaceId, workspaceId),
      eq(t.conventions.repoId, repoId),
    ];
    if (opts.runId !== undefined) conditions.push(eq(t.conventions.runId, opts.runId));
    if (opts.status !== undefined) conditions.push(eq(t.conventions.status, opts.status));

    return this.db
      .select()
      .from(t.conventions)
      .where(and(...conditions))
      .orderBy(desc(t.conventions.confidence), desc(t.conventions.createdAt));
  }

  async getById(workspaceId: string, id: string): Promise<Convention | null> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row ?? null;
  }

  async updateStatus(
    workspaceId: string,
    id: string,
    status: 'approved' | 'rejected',
  ): Promise<Convention | null> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ status, updatedAt: sql`now()` })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row ?? null;
  }

  async updateRule(
    workspaceId: string,
    id: string,
    editedRule: string,
  ): Promise<Convention | null> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ editedRule, updatedAt: sql`now()` })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row ?? null;
  }

  async listApproved(
    workspaceId: string,
    repoId: string,
    opts: { runId?: string } = {},
  ): Promise<Convention[]> {
    return this.listByRepo(workspaceId, repoId, { ...opts, status: 'approved' });
  }

  async latestRunId(workspaceId: string, repoId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ runId: t.conventions.runId })
      .from(t.conventions)
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)),
      )
      .orderBy(desc(t.conventions.createdAt))
      .limit(1);
    return row?.runId ?? null;
  }
}
