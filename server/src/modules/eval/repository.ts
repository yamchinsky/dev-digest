import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalCaseRow, EvalRunRow, EvalRunBatchRow } from '../../db/rows.js';

/**
 * Eval — the ONLY Drizzle importer for eval_cases, eval_runs, eval_run_batches
 * within this module. No other module may import from this file (§13 of
 * onion-architecture). Eval also owns its own queries for findings + their
 * review/PR/repo context — it does NOT import reviews/repository.
 */

export type { EvalCaseRow, EvalRunRow, EvalRunBatchRow };

// ---- Input types ----

export interface InsertCase {
  workspaceId: string;
  ownerKind: 'skill' | 'agent';
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput: unknown;
  notes?: string | null;
}

export interface UpdateCase {
  name?: string;
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface InsertBatch {
  workspaceId: string;
  agentId: string | null;
  status: 'running' | 'done' | 'failed';
  agentVersion: number | null;
  systemPrompt: string;
  provider: string;
  model: string;
  strategy: string;
  skillBodies: string[] | null;
  casesTotal: number;
}

export interface UpdateBatch {
  status?: 'running' | 'done' | 'failed';
  casesPassed?: number | null;
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  costUsd?: number | null;
  durationMs?: number | null;
  error?: string | null;
  finishedAt?: Date | null;
}

export interface InsertRun {
  caseId: string;
  batchId: string | null;
  pass: boolean | null;
  actualOutput: unknown;
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
}

export interface BatchWithRuns {
  batch: EvalRunBatchRow;
  runs: { run: EvalRunRow; caseName: string | null }[];
}

/** Finding + surrounding context (eval's own JOIN — NOT from reviews/repository). */
export interface FindingWithContext {
  finding: typeof t.findings.$inferSelect;
  review: typeof t.reviews.$inferSelect;
  pr: typeof t.pullRequests.$inferSelect;
  repo: typeof t.repos.$inferSelect;
}

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- eval_cases ------------------------------------------------

  getCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      );
  }

  async getCaseById(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.id, id), eq(t.evalCases.workspaceId, workspaceId)));
    return row;
  }

  async insertCase(data: InsertCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: data.workspaceId,
        ownerKind: data.ownerKind,
        ownerId: data.ownerId,
        name: data.name,
        inputDiff: data.inputDiff,
        inputFiles: data.inputFiles as object | undefined,
        inputMeta: data.inputMeta as object | undefined,
        expectedOutput: data.expectedOutput as object,
        notes: data.notes,
      })
      .returning();
    return row!;
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles as object } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object } : {}),
        ...(patch.expectedOutput !== undefined
          ? { expectedOutput: patch.expectedOutput as object }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.id, id), eq(t.evalCases.workspaceId, workspaceId)))
      .returning();
    return row;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.id, id), eq(t.evalCases.workspaceId, workspaceId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- eval_run_batches ------------------------------------------------

  async insertBatch(data: InsertBatch): Promise<EvalRunBatchRow> {
    const [row] = await this.db
      .insert(t.evalRunBatches)
      .values({
        workspaceId: data.workspaceId,
        agentId: data.agentId,
        status: data.status,
        agentVersion: data.agentVersion,
        systemPrompt: data.systemPrompt,
        provider: data.provider,
        model: data.model,
        strategy: data.strategy,
        skillBodies: data.skillBodies,
        casesTotal: data.casesTotal,
      })
      .returning();
    return row!;
  }

  async updateBatch(id: string, patch: UpdateBatch): Promise<EvalRunBatchRow | undefined> {
    const [row] = await this.db
      .update(t.evalRunBatches)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.casesPassed !== undefined ? { casesPassed: patch.casesPassed } : {}),
        ...(patch.recall !== undefined ? { recall: patch.recall } : {}),
        ...(patch.precision !== undefined ? { precision: patch.precision } : {}),
        ...(patch.citationAccuracy !== undefined
          ? { citationAccuracy: patch.citationAccuracy }
          : {}),
        ...(patch.costUsd !== undefined ? { costUsd: patch.costUsd } : {}),
        ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
      })
      .where(eq(t.evalRunBatches.id, id))
      .returning();
    return row;
  }

  async getBatch(workspaceId: string, id: string): Promise<EvalRunBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRunBatches)
      .where(and(eq(t.evalRunBatches.id, id), eq(t.evalRunBatches.workspaceId, workspaceId)));
    return row;
  }

  async getBatchWithRuns(workspaceId: string, id: string): Promise<BatchWithRuns | undefined> {
    const batch = await this.getBatch(workspaceId, id);
    if (!batch) return undefined;

    const runRows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalRuns.batchId, id));

    return {
      batch,
      runs: runRows.map((r) => ({ run: r.run, caseName: r.caseName ?? null })),
    };
  }

  listBatches(workspaceId: string, agentId: string): Promise<EvalRunBatchRow[]> {
    return this.db
      .select()
      .from(t.evalRunBatches)
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, workspaceId),
          eq(t.evalRunBatches.agentId, agentId),
        ),
      )
      .orderBy(desc(t.evalRunBatches.createdAt));
  }

  // ---- eval_runs ------------------------------------------------

  async insertRun(data: InsertRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: data.caseId,
        batchId: data.batchId ?? null,
        pass: data.pass ?? null,
        actualOutput: data.actualOutput as object,
        recall: data.recall ?? null,
        precision: data.precision ?? null,
        citationAccuracy: data.citationAccuracy ?? null,
        durationMs: data.durationMs ?? null,
        costUsd: data.costUsd ?? null,
      })
      .returning();
    return row!;
  }

  async reapStaleBatches(): Promise<number> {
    const rows = await this.db
      .update(t.evalRunBatches)
      .set({ status: 'failed', error: 'orphaned by restart' })
      .where(eq(t.evalRunBatches.status, 'running'))
      .returning({ id: t.evalRunBatches.id });
    return rows.length;
  }

  // ---- Finding with context (eval's own JOINs — not from reviews/repository) ----

  async getFindingWithContext(
    workspaceId: string,
    findingId: string,
  ): Promise<FindingWithContext | undefined> {
    const [row] = await this.db
      .select({
        finding: t.findings,
        review: t.reviews,
        pr: t.pullRequests,
        repo: t.repos,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.pullRequests, eq(t.reviews.prId, t.pullRequests.id))
      .innerJoin(t.repos, eq(t.pullRequests.repoId, t.repos.id))
      .where(
        and(eq(t.findings.id, findingId), eq(t.pullRequests.workspaceId, workspaceId)),
      );
    return row;
  }

  /** pr_files patches for a PR — used for the diff reconstruction fallback. */
  getPrFilesForPr(prId: string): Promise<(typeof t.prFiles.$inferSelect)[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }
}
