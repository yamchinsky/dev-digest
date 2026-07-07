import type { Container } from '../../platform/container.js';
import type {
  EvalBatch,
  EvalBatchDetail,
  EvalCase,
  EvalExpectation,
  EvalRunResult,
} from '@devdigest/shared';
import { EvalExpectation as EvalExpectationSchema } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { NotFoundError, ValidationError, ConfigError } from '../../platform/errors.js';
import { EvalRepository } from './repository.js';
import type { EvalRunBatchRow, EvalCaseRow } from './repository.js';
import { scoreEvalCase, aggregateEvalMetrics } from './scoring.js';

/**
 * Eval service (SPEC-04). Orchestrates:
 *   - Seeding eval cases from accepted/dismissed findings (createCaseFromFinding)
 *   - Manual case CRUD (createCase, getCase, updateCase, deleteCase, listCases)
 *   - Fire-and-forget batch execution (startBatch → executeBatch)
 *   - Synchronous single-case run (runSingleCase)
 *   - Boot reaper for orphaned batches (reapStaleBatches)
 */
export class EvalService {
  private repo: EvalRepository;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
  }

  // =========================================================================
  // DTO mappers
  // =========================================================================

  private toEvalCaseDto(row: EvalCaseRow): EvalCase {
    return {
      id: row.id,
      owner_kind: row.ownerKind as 'skill' | 'agent',
      owner_id: row.ownerId,
      name: row.name,
      input_diff: row.inputDiff ?? '',
      input_files: row.inputFiles,
      input_meta: row.inputMeta,
      expected_output: row.expectedOutput,
      notes: row.notes ?? undefined,
    };
  }

  private toBatchDto(row: EvalRunBatchRow): EvalBatch {
    return {
      id: row.id,
      agent_id: row.agentId,
      workspace_id: row.workspaceId,
      status: row.status as 'running' | 'done' | 'failed',
      agent_version: row.agentVersion,
      system_prompt: row.systemPrompt,
      provider: row.provider,
      model: row.model,
      strategy: row.strategy,
      skill_bodies: (row.skillBodies as string[] | null) ?? null,
      cases_total: row.casesTotal,
      cases_passed: row.casesPassed,
      recall: row.recall,
      precision: row.precision,
      citation_accuracy: row.citationAccuracy,
      cost_usd: row.costUsd,
      duration_ms: row.durationMs,
      error: row.error,
      created_at: row.createdAt.toISOString(),
      finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
  }

  // =========================================================================
  // Diff helpers (eval's own — do NOT import reviews/diff-loader)
  // =========================================================================

  /**
   * Load the raw diff string for a PR. Tries the git adapter first; falls back
   * to reconstructing a synthetic diff from the persisted pr_files patches.
   * Both empty → ValidationError (AC-5).
   */
  private async loadRawDiff(
    repoOwner: string,
    repoName: string,
    prBase: string,
    prHeadSha: string,
    prId: string,
  ): Promise<string> {
    // 1. Try the git adapter
    try {
      const diff = await this.container.git.diff(
        { owner: repoOwner, name: repoName },
        prBase,
        prHeadSha,
      );
      if (diff.files.length > 0) return diff.raw;
    } catch {
      /* fall through to pr_files reconstruction */
    }

    // 2. Reconstruct from persisted pr_files patches
    const files = await this.repo.getPrFilesForPr(prId);
    const parts: string[] = [];
    for (const f of files) {
      if (!f.patch) continue;
      parts.push(`diff --git a/${f.path} b/${f.path}`);
      parts.push(`--- a/${f.path}`);
      parts.push(`+++ b/${f.path}`);
      parts.push(f.patch);
    }
    if (parts.length > 0) return parts.join('\n');

    // 3. Nothing available → 422 (AC-5)
    throw new ValidationError('Diff unavailable');
  }

  // =========================================================================
  // Case CRUD
  // =========================================================================

  /**
   * Seed an eval case from an accepted or dismissed finding (AC-1/2).
   *
   * Failures:
   *   - Neither acceptedAt nor dismissedAt set → 422 (AC-3)
   *   - No agentId on review and no agentIdOverride → 422 (AC-4)
   *   - No diff available → 422 (AC-5)
   */
  async createCaseFromFinding(
    workspaceId: string,
    findingId: string,
    agentIdOverride?: string,
  ): Promise<EvalCase> {
    // 1. Load finding + review + PR + repo (eval's own query)
    const ctx = await this.repo.getFindingWithContext(workspaceId, findingId);
    if (!ctx) throw new NotFoundError('Finding not found');

    const { finding, review, pr, repo } = ctx;

    // 2. Decision required (AC-3)
    if (!finding.acceptedAt && !finding.dismissedAt) {
      throw new ValidationError('Finding has no decision');
    }

    // 3. Resolve agent (AC-4) — agent_id is NOT a column on findings; it comes from reviews
    const agentId = review.agentId ?? agentIdOverride;
    if (!agentId) {
      throw new ValidationError(
        'Agent required for seeded reviews — supply agent_id in body',
      );
    }

    // 4. Freeze diff (AC-5)
    const inputDiff = await this.loadRawDiff(
      repo.owner,
      repo.name,
      pr.base,
      pr.headSha,
      pr.id,
    );

    // 5. Build structured expectation
    const expectedOutput: EvalExpectation = {
      type: finding.acceptedAt ? 'must_find' : 'must_not_flag',
      file: finding.file,
      start_line: finding.startLine,
      end_line: finding.endLine,
      note: finding.title,
      source_finding_id: finding.id,
    };

    // 6. Build input meta
    const inputMeta = {
      title: pr.title,
      body: pr.body,
      source: {
        finding_id: finding.id,
        pr_number: pr.number,
        repo: repo.fullName,
      },
    };

    // 7. Persist the case — idempotent: clicking "turn into eval case" twice on
    // the same finding returns the existing case instead of a 500 on the
    // (workspace, owner, name) unique index.
    const row = await this.repo.insertCaseFromFinding({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: finding.title,
      inputDiff,
      inputMeta,
      expectedOutput,
    });

    return this.toEvalCaseDto(row);
  }

  async createCase(
    workspaceId: string,
    input: {
      owner_kind: 'skill' | 'agent';
      owner_id: string;
      name: string;
      input_diff: string;
      input_files?: unknown;
      input_meta?: unknown;
      expected_output: unknown;
      notes?: string | null;
    },
  ): Promise<EvalCase> {
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes,
    });
    return this.toEvalCaseDto(row);
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCase | undefined> {
    const row = await this.repo.getCaseById(workspaceId, id);
    return row ? this.toEvalCaseDto(row) : undefined;
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: {
      name?: string;
      input_diff?: string;
      input_files?: unknown;
      input_meta?: unknown;
      expected_output?: unknown;
      notes?: string | null;
    },
  ): Promise<EvalCase | undefined> {
    const row = await this.repo.updateCase(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined ? { expectedOutput: patch.expected_output } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    return row ? this.toEvalCaseDto(row) : undefined;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, id);
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const rows = await this.repo.getCases(workspaceId, agentId);
    return rows.map((r) => this.toEvalCaseDto(r));
  }

  // =========================================================================
  // Batch execution
  // =========================================================================

  /**
   * Start a batch run of all eval cases for an agent (AC-12/13/15).
   *
   * Returns 202 immediately; execution is fire-and-forget. On ConfigError
   * (unknown provider / missing API key), the batch row is immediately marked
   * failed and returned (AC-15).
   */
  async startBatch(
    workspaceId: string,
    agentId: string,
    opts?: { provider?: string; model?: string },
  ): Promise<EvalBatch> {
    // 1. Load cases (AC-13)
    const cases = await this.repo.getCases(workspaceId, agentId);
    if (cases.length === 0) {
      throw new ValidationError('No eval cases for this agent');
    }

    // 2. Load agent + linked skills
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const skillLinks = await this.container.agentsRepo.linkedSkills(agent.id);
    const skillBodies = skillLinks.filter((l) => l.skill.enabled).map((l) => l.skill.body);

    // 3. Provider/model (opts override beats agent defaults)
    const provider = (opts?.provider ?? agent.provider) as 'openai' | 'anthropic' | 'openrouter';
    const model = opts?.model ?? agent.model;

    // 4. Snapshot the batch row
    const batchRow = await this.repo.insertBatch({
      workspaceId,
      agentId: agent.id,
      status: 'running',
      agentVersion: agent.version,
      systemPrompt: agent.systemPrompt,
      provider,
      model,
      strategy: agent.strategy ?? 'auto',
      skillBodies: skillBodies.length > 0 ? skillBodies : null,
      casesTotal: cases.length,
    });

    // 5. Resolve LLM — on ConfigError, mark batch failed immediately (AC-15)
    let llm;
    try {
      llm = await this.container.llm(provider);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const failed = await this.repo.updateBatch(batchRow.id, {
        status: 'failed',
        error: errMsg,
        finishedAt: new Date(),
      });
      return this.toBatchDto(failed ?? { ...batchRow, status: 'failed', error: errMsg });
    }

    // 6. Fire-and-forget — 202 returns before execution completes (AC-12)
    void this.executeBatch(batchRow, cases, llm).catch((err) => {
      console.error('[eval] executeBatch crashed unexpectedly:', (err as Error).message);
    });

    return this.toBatchDto(batchRow);
  }

  /**
   * Execute all cases sequentially (private). Per-case errors are caught and
   * recorded as pass=false runs — the batch always completes (AC-14).
   */
  private async executeBatch(
    batch: EvalRunBatchRow,
    cases: EvalCaseRow[],
    llm: Awaited<ReturnType<Container['llm']>>,
  ): Promise<void> {
    const batchStartMs = Date.now();
    const scores: ReturnType<typeof scoreEvalCase>[] = [];
    let totalCostUsd = 0;

    try {
      for (const evalCase of cases) {
        const caseStartMs = Date.now();

        // Parse the stored expectation
        const parsedExp = EvalExpectationSchema.safeParse(evalCase.expectedOutput);
        if (!parsedExp.success) {
          // Malformed expectation — record as failure
          await this.repo.insertRun({
            caseId: evalCase.id,
            batchId: batch.id,
            pass: false,
            actualOutput: {
              error: `Invalid expected_output: ${parsedExp.error.message}`,
              expectation: evalCase.expectedOutput,
            },
          });
          continue;
        }
        const expectation = parsedExp.data;

        // Extract prDescription and task from inputMeta
        const meta = evalCase.inputMeta as Record<string, unknown> | null | undefined;
        const prDescription = typeof meta?.body === 'string' ? meta.body : undefined;
        const task = typeof meta?.title === 'string' ? meta.title : undefined;

        try {
          const outcome = await reviewPullRequest({
            systemPrompt: batch.systemPrompt,
            model: batch.model,
            llm,
            diff: parseUnifiedDiff(evalCase.inputDiff ?? ''),
            skills: (batch.skillBodies as string[] | null) ?? undefined,
            prDescription,
            task,
            strategy: (batch.strategy as 'auto' | 'single-pass' | 'map-reduce') ?? 'auto',
          });

          const tokensIn = outcome.tokensIn;
          const tokensOut = outcome.tokensOut;
          const costUsd =
            outcome.costUsd ??
            this.container.priceBook.estimate(batch.model, tokensIn, tokensOut);

          if (typeof costUsd === 'number') totalCostUsd += costUsd;

          const score = scoreEvalCase(expectation, {
            findings: outcome.review.findings,
            droppedCount: outcome.dropped.length,
          });
          scores.push(score);

          const durationMs = Date.now() - caseStartMs;

          await this.repo.insertRun({
            caseId: evalCase.id,
            batchId: batch.id,
            pass: score.pass,
            actualOutput: {
              findings: outcome.review.findings,
              dropped_count: outcome.dropped.length,
              matched: score.matched,
              expectation,
              tokens_in: tokensIn,
              tokens_out: tokensOut,
              model: batch.model,
            },
            recall: score.isMustFind ? (score.matched ? 1 : 0) : null,
            precision: score.isMustNotFlag ? (score.matched ? 0 : 1) : null,
            citationAccuracy:
              score.survivors + score.dropped > 0
                ? score.survivors / (score.survivors + score.dropped)
                : 1,
            durationMs,
            costUsd: typeof costUsd === 'number' ? costUsd : null,
          });
        } catch (err) {
          // Per-case engine error → pass=false, batch continues (AC-14)
          const errMsg = err instanceof Error ? err.message : String(err);
          const durationMs = Date.now() - caseStartMs;
          await this.repo.insertRun({
            caseId: evalCase.id,
            batchId: batch.id,
            pass: false,
            actualOutput: { error: errMsg, expectation },
            durationMs,
          });
        }
      }

      // Aggregate all scores
      const metrics = aggregateEvalMetrics(scores);
      const totalDurationMs = Date.now() - batchStartMs;

      await this.repo.updateBatch(batch.id, {
        status: 'done',
        casesPassed: metrics.cases_passed,
        recall: metrics.recall,
        precision: metrics.precision,
        citationAccuracy: metrics.citation_accuracy,
        durationMs: totalDurationMs,
        costUsd: totalCostUsd > 0 ? totalCostUsd : null,
        finishedAt: new Date(),
      });
    } catch (err) {
      // Executor-level catch (DB write failures, unexpected errors)
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.repo.updateBatch(batch.id, {
        status: 'failed',
        error: errMsg,
        finishedAt: new Date(),
      });
    }
  }

  // =========================================================================
  // Single-case sync run
  // =========================================================================

  /**
   * Run a single eval case synchronously. Inserts run with batchId=NULL so it
   * does NOT appear in batch history (GET /agents/:id/eval-runs, AC-23).
   */
  async runSingleCase(
    workspaceId: string,
    caseId: string,
    opts?: { provider?: string; model?: string },
  ): Promise<EvalRunResult> {
    const caseRow = await this.repo.getCaseById(workspaceId, caseId);
    if (!caseRow) throw new NotFoundError('Eval case not found');

    // Load the agent that owns this case
    const agent = await this.container.agentsRepo.getById(workspaceId, caseRow.ownerId);
    if (!agent) throw new NotFoundError('Agent not found');

    const provider = (opts?.provider ?? agent.provider) as 'openai' | 'anthropic' | 'openrouter';
    const model = opts?.model ?? agent.model;
    const llm = await this.container.llm(provider);

    const skillLinks = await this.container.agentsRepo.linkedSkills(agent.id);
    const skillBodies = skillLinks.filter((l) => l.skill.enabled).map((l) => l.skill.body);

    // Parse expectation
    const parsedExp = EvalExpectationSchema.safeParse(caseRow.expectedOutput);
    if (!parsedExp.success) {
      throw new ValidationError(
        `Invalid expected_output: ${parsedExp.error.message}`,
      );
    }
    const expectation = parsedExp.data;

    const meta = caseRow.inputMeta as Record<string, unknown> | null | undefined;
    const prDescription = typeof meta?.body === 'string' ? meta.body : undefined;
    const task = typeof meta?.title === 'string' ? meta.title : undefined;

    const runStart = Date.now();
    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model,
      llm,
      diff: parseUnifiedDiff(caseRow.inputDiff ?? ''),
      skills: skillBodies.length > 0 ? skillBodies : undefined,
      prDescription,
      task,
      strategy: (agent.strategy as 'auto' | 'single-pass' | 'map-reduce') ?? 'auto',
    });
    const durationMs = Date.now() - runStart;

    const score = scoreEvalCase(expectation, {
      findings: outcome.review.findings,
      droppedCount: outcome.dropped.length,
    });
    const metrics = aggregateEvalMetrics([score]);

    const tokensIn = outcome.tokensIn;
    const tokensOut = outcome.tokensOut;
    const costUsd =
      outcome.costUsd ?? this.container.priceBook.estimate(model, tokensIn, tokensOut);

    const evalRunResult = {
      recall: metrics.recall,
      precision: metrics.precision,
      citation_accuracy: metrics.citation_accuracy,
      traces_passed: score.pass ? 1 : 0,
      traces_total: 1,
      duration_ms: durationMs,
      cost_usd: typeof costUsd === 'number' ? costUsd : null,
      per_trace: [
        {
          name: caseRow.name,
          pass: score.pass,
          expected: expectation,
          actual: {
            findings: outcome.review.findings,
            dropped_count: outcome.dropped.length,
            matched: score.matched,
          },
        },
      ],
    };

    const runRow = await this.repo.insertRun({
      caseId: caseRow.id,
      batchId: null, // NOT part of a batch (AC-23)
      pass: score.pass,
      actualOutput: evalRunResult,
      recall: metrics.recall,
      precision: metrics.precision,
      citationAccuracy: metrics.citation_accuracy,
      durationMs,
      costUsd: typeof costUsd === 'number' ? costUsd : null,
    });

    return {
      run_id: runRow.id,
      case_id: caseRow.id,
      result: evalRunResult,
    };
  }

  // =========================================================================
  // Batch reads
  // =========================================================================

  async listBatches(workspaceId: string, agentId: string): Promise<EvalBatch[]> {
    const rows = await this.repo.listBatches(workspaceId, agentId);
    return rows.map((r) => this.toBatchDto(r));
  }

  async getBatchDetail(workspaceId: string, id: string): Promise<EvalBatchDetail | undefined> {
    const result = await this.repo.getBatchWithRuns(workspaceId, id);
    if (!result) return undefined;
    return {
      batch: this.toBatchDto(result.batch),
      runs: result.runs.map(({ run, caseName }) => ({
        id: run.id,
        case_id: run.caseId,
        case_name: caseName ?? undefined,
        batch_id: run.batchId,
        ran_at: run.ranAt.toISOString(),
        pass: run.pass,
        actual_output: run.actualOutput,
        recall: run.recall,
        precision: run.precision,
        citation_accuracy: run.citationAccuracy,
        duration_ms: run.durationMs,
        cost_usd: run.costUsd,
      })),
    };
  }

  // =========================================================================
  // Boot reaper
  // =========================================================================

  /** Reap batches left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleBatches(): Promise<number> {
    return this.repo.reapStaleBatches();
  }
}
