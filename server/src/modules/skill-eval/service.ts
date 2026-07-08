import type { Container } from '../../platform/container.js';
import type {
  SkillBenchmarkRun,
  SkillBenchmarkMetrics,
  SkillBenchmarkCaseDiff,
  SkillBenchmarkAspect,
} from '@devdigest/shared';
import { SkillBenchmarkExpectation } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { NotFoundError } from '../../platform/errors.js';
import type { EvalCaseRow } from '../../db/rows.js';
import { SkillEvalRepository } from './repository.js';
import type { SkillEvalRunRow, InsertRun } from './repository.js';
import { firstMatch, finalize, emptyAgg } from './scoring.js';
import { DEFAULT_BENCHMARK_CASES, type BenchCase } from './fixtures.js';

/**
 * Skill benchmark service — runs a skill's benchmark cases twice (WITH the skill
 * body injected, and with the bare model) and stores the comparison.
 *
 *   - startBenchmark → 202, snapshots a run row, then fire-and-forget executes.
 *   - Grading is CODE-ONLY: each expectation aspect carries literal regex
 *     patterns; a config "passes" an aspect if any pattern matches its output.
 *     No judge, so runs across skill versions stay comparable.
 *   - reapStaleRuns → boot reaper for orphaned 'running' rows.
 */

/** Skills have no provider/model of their own — the benchmark uses these
 *  (overridable per run). Matches the seed's default reviewer provider/model. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/** Neutral, minimal reviewer prompt. Kept deliberately thin so the measured
 *  difference between with_skill and without_skill is the SKILL's contribution,
 *  not the base prompt's. */
const BENCHMARK_SYSTEM_PROMPT =
  'You are a code reviewer. Review the diff and report concrete findings, each ' +
  'citing the exact file and line. Be specific; do not invent issues.';

export class SkillEvalService {
  private repo: SkillEvalRepository;

  constructor(private container: Container) {
    this.repo = new SkillEvalRepository(container.db);
  }

  // ---- DTO mapper ------------------------------------------------------

  private toDto(row: SkillEvalRunRow): SkillBenchmarkRun {
    return {
      id: row.id,
      skill_id: row.skillId,
      workspace_id: row.workspaceId,
      status: row.status as 'running' | 'done' | 'failed',
      skill_version: row.skillVersion,
      provider: row.provider,
      model: row.model,
      with_skill: (row.withMetrics as SkillBenchmarkMetrics | null) ?? null,
      without_skill: (row.withoutMetrics as SkillBenchmarkMetrics | null) ?? null,
      cases: (row.cases as SkillBenchmarkCaseDiff[] | null) ?? [],
      cost_usd: row.costUsd,
      error: row.error,
      created_at: row.createdAt.toISOString(),
      finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
  }

  // ---- Reads -----------------------------------------------------------

  async listRuns(workspaceId: string, skillId: string): Promise<SkillBenchmarkRun[]> {
    // Surface a clean 404 for an unknown skill (vs. an empty list).
    const skill = await this.repo.getSkillById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    const rows = await this.repo.listRuns(workspaceId, skillId);
    return rows.map((r) => this.toDto(r));
  }

  async getRun(workspaceId: string, id: string): Promise<SkillBenchmarkRun | undefined> {
    const row = await this.repo.getRunById(workspaceId, id);
    return row ? this.toDto(row) : undefined;
  }

  // ---- Start + execute -------------------------------------------------

  async startBenchmark(
    workspaceId: string,
    skillId: string,
    opts?: { provider?: string; model?: string },
  ): Promise<SkillBenchmarkRun> {
    const skill = await this.repo.getSkillById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');

    // Benchmark cases: the skill's own seeded eval_cases (owner_kind='skill')
    // if present, else a built-in generic fixture — so "Run benchmark" works
    // for ANY skill, not only skills that happen to have seeded cases.
    const seeded = toBenchCases(await this.repo.getBenchmarkCases(workspaceId, skillId));
    const benchCases = seeded.length > 0 ? seeded : DEFAULT_BENCHMARK_CASES;

    const provider = (opts?.provider ?? DEFAULT_PROVIDER) as
      | 'openai'
      | 'anthropic'
      | 'openrouter';
    const model = opts?.model ?? DEFAULT_MODEL;

    const runRow = await this.repo.insertRun({
      workspaceId,
      skillId: skill.id,
      status: 'running',
      skillVersion: skill.version,
      provider,
      model,
    } satisfies InsertRun);

    // Resolve the LLM up front — on ConfigError (unknown provider / missing key)
    // mark the run failed immediately, mirroring the agent eval batch (AC-15).
    let llm;
    try {
      llm = await this.container.llm(provider);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const failed = await this.repo.updateRun(runRow.id, {
        status: 'failed',
        error: errMsg,
        finishedAt: new Date(),
      });
      return this.toDto(failed ?? { ...runRow, status: 'failed', error: errMsg });
    }

    // Fire-and-forget — 202 returns before execution completes.
    void this.executeBenchmark(runRow, skill.body, benchCases, model, llm).catch((err) => {
      console.error('[skill-eval] executeBenchmark crashed:', (err as Error).message);
    });

    return this.toDto(runRow);
  }

  private async executeBenchmark(
    run: SkillEvalRunRow,
    skillBody: string,
    cases: BenchCase[],
    model: string,
    llm: Awaited<ReturnType<Container['llm']>>,
  ): Promise<void> {
    const withAgg = emptyAgg();
    const withoutAgg = emptyAgg();
    const caseDiffs: SkillBenchmarkCaseDiff[] = [];
    let totalCostUsd = 0;
    let sawCost = false;

    try {
      for (const evalCase of cases) {
        const aspects = evalCase.expectation.aspects;
        const diff = parseUnifiedDiff(evalCase.inputDiff);

        try {
          // WITH the skill body injected.
          const withStart = Date.now();
          const withOut = await reviewPullRequest({
            systemPrompt: BENCHMARK_SYSTEM_PROMPT,
            model,
            llm,
            diff,
            skills: [skillBody],
            strategy: 'single-pass',
          });
          withAgg.duration_ms += Date.now() - withStart;
          withAgg.tokens += withOut.tokensIn + withOut.tokensOut;
          if (typeof withOut.costUsd === 'number') {
            totalCostUsd += withOut.costUsd;
            sawCost = true;
          }

          // WITHOUT the skill (bare model).
          const withoutStart = Date.now();
          const withoutOut = await reviewPullRequest({
            systemPrompt: BENCHMARK_SYSTEM_PROMPT,
            model,
            llm,
            diff,
            strategy: 'single-pass',
          });
          withoutAgg.duration_ms += Date.now() - withoutStart;
          withoutAgg.tokens += withoutOut.tokensIn + withoutOut.tokensOut;
          if (typeof withoutOut.costUsd === 'number') {
            totalCostUsd += withoutOut.costUsd;
            sawCost = true;
          }

          const withText = outputText(withOut);
          const withoutText = outputText(withoutOut);

          const caseAspects: SkillBenchmarkAspect[] = aspects.map((a) => {
            const withMatch = firstMatch(withText, a.patterns);
            const withoutMatch = firstMatch(withoutText, a.patterns);
            withAgg.checks_total += 1;
            withoutAgg.checks_total += 1;
            if (withMatch) withAgg.checks_passed += 1;
            if (withoutMatch) withoutAgg.checks_passed += 1;
            return {
              aspect: a.aspect,
              with_skill: withMatch ?? '—',
              without_skill: withoutMatch ?? '—',
              with_pass: !!withMatch,
              without_pass: !!withoutMatch,
            };
          });
          caseDiffs.push({ name: evalCase.name, aspects: caseAspects });
        } catch (err) {
          // Per-case engine error → record both configs as fail, keep going.
          const errMsg = err instanceof Error ? err.message : String(err);
          caseDiffs.push({
            name: evalCase.name,
            aspects: aspects.map((a) => {
              withAgg.checks_total += 1;
              withoutAgg.checks_total += 1;
              return {
                aspect: a.aspect,
                with_skill: `error: ${errMsg}`,
                without_skill: `error: ${errMsg}`,
                with_pass: false,
                without_pass: false,
              };
            }),
          });
        }
      }

      await this.repo.updateRun(run.id, {
        status: 'done',
        withMetrics: finalize(withAgg),
        withoutMetrics: finalize(withoutAgg),
        cases: caseDiffs,
        costUsd: sawCost ? totalCostUsd : null,
        finishedAt: new Date(),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.repo.updateRun(run.id, {
        status: 'failed',
        error: errMsg,
        finishedAt: new Date(),
      });
    }
  }

  // ---- Boot reaper -----------------------------------------------------

  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRuns();
  }
}

// ---- Pure helpers (code-only grading) ----------------------------------

/**
 * Convert seeded skill eval_cases into runnable BenchCases. Rows whose
 * expected_output isn't a valid SkillBenchmarkExpectation, or that have no
 * diff, are dropped (so a malformed seed row degrades to "use the default
 * fixture" rather than crashing the run).
 */
function toBenchCases(rows: EvalCaseRow[]): BenchCase[] {
  const out: BenchCase[] = [];
  for (const row of rows) {
    const parsed = SkillBenchmarkExpectation.safeParse(row.expectedOutput);
    if (!parsed.success || !row.inputDiff) continue;
    out.push({ name: row.name, inputDiff: row.inputDiff, expectation: parsed.data });
  }
  return out;
}

/** Serialize a review outcome to a searchable text blob (findings + raw). */
function outputText(outcome: Awaited<ReturnType<typeof reviewPullRequest>>): string {
  return `${JSON.stringify(outcome.review.findings)}\n${outcome.raw ?? ''}`;
}
