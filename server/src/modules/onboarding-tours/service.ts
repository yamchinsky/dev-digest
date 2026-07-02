import { INJECTION_GUARD, wrapUntrusted } from '@devdigest/reviewer-core';
import {
  type OnboardingTour,
  type GenerationLog,
  type OnboardingTourSections,
  type ReadingPathItem,
} from '@devdigest/shared';
import { TourLLMSchema } from './helpers.js';
import type { Container } from '../../platform/container.js';
import {
  NotFoundError,
  ValidationError,
  ExternalServiceError,
  ConfigError,
} from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { RepoRepository } from '../repos/repository.js';
import { OnboardingTourRepository } from './repository.js';

const TOP_FILES_N = 20;

export type GenerateResult =
  | { tour: OnboardingTour; log: GenerationLog }
  | { status: 'in_progress' };

/**
 * Maps a DB row to the OnboardingTour DTO.
 */
function toDTO(row: {
  repoId: string;
  workspaceId: string;
  sections: unknown;
  readingPath: unknown;
  generatedAt: Date;
  filesIndexed: number;
  indexStatusAtGeneration: string;
}): OnboardingTour {
  return {
    repo_id: row.repoId,
    workspace_id: row.workspaceId,
    sections: row.sections as OnboardingTourSections,
    reading_path: row.readingPath as ReadingPathItem[],
    generated_at: row.generatedAt.toISOString(),
    files_indexed: row.filesIndexed,
    index_status_at_generation: row.indexStatusAtGeneration as OnboardingTour['index_status_at_generation'],
  };
}

export class OnboardingTourService {
  private repo: OnboardingTourRepository;
  private repos: RepoRepository;
  private inFlight = new Set<string>();

  constructor(private container: Container) {
    this.repo = new OnboardingTourRepository(container.db);
    this.repos = new RepoRepository(container.db);
  }

  /**
   * GET — return the persisted tour for (workspaceId, repoId), or null when
   * no tour has been generated yet.
   */
  async getTour(workspaceId: string, repoId: string): Promise<OnboardingTour | null> {
    const row = await this.repo.getTour(repoId, workspaceId);
    if (!row) return null;
    return toDTO(row);
  }

  /**
   * POST /generate — gather repo-intel facts, call the LLM once with a
   * structured schema, persist the result. Returns either the full
   * {tour, log} on success or {status: 'in_progress'} when a concurrent
   * generation for the same repo is already in flight.
   */
  async generateTour(workspaceId: string, repoId: string): Promise<GenerateResult> {
    // Step 1: Repo existence + tenancy check
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError(`Repository ${repoId} not found`);

    // Step 2: Clone path guard
    if (!repo.clonePath) {
      throw new ValidationError(
        'Repository has no clone path — clone it first via Settings.',
      );
    }

    // Step 3: In-flight dedup
    if (this.inFlight.has(repoId)) {
      return { status: 'in_progress' as const };
    }
    this.inFlight.add(repoId);

    try {
      // Step 6: Gather repo-intel facts in parallel
      const [indexState, repoMapResult, criticalPaths, topFiles] = await Promise.all([
        this.container.repoIntel.getIndexState(repoId),
        // Budget defaults inside repo-intel — don't import its constants here.
        this.container.repoIntel.getRepoMap(repoId),
        this.container.repoIntel.getCriticalPaths(repoId),
        this.container.repoIntel.getTopFilesByRank(repoId, TOP_FILES_N),
      ]);

      // Step 7: Guard getFileRank against empty topFiles (F2 — degraded index)
      const fileRanks =
        topFiles.length > 0
          ? await this.container.repoIntel.getFileRank(repoId, topFiles)
          : [];
      const rankMap = new Map(fileRanks.map((r) => [r.path, r.percentile]));

      // Step 8: Model resolution
      const { provider, model } = await resolveFeatureModel(
        this.container,
        workspaceId,
        'onboarding',
      );

      // Step 9: LLM adapter resolution
      let llm;
      try {
        llm = await this.container.llm(provider);
      } catch (err) {
        // ConfigError = operator misconfiguration; re-throw as-is → 500
        if (err instanceof ConfigError) throw err;
        throw new ExternalServiceError(
          'llm-onboarding',
          err instanceof Error ? err.message : String(err),
        );
      }

      // Step 10: System prompt with INJECTION_GUARD
      const systemPrompt = `You are an expert technical writer producing a five-section developer onboarding tour. ${INJECTION_GUARD}`;

      // Step 11: Build user message — all repo-derived text wrapped with wrapUntrusted
      const userMessage = [
        `## Repository map\n${wrapUntrusted('repo-map', repoMapResult.text || '(no repo map available)')}`,
        `## Critical dependency chains\n${wrapUntrusted(
          'critical-paths',
          criticalPaths.map((chain) => chain.join(' → ')).join('\n') ||
            '(no dependency paths indexed)',
        )}`,
        `## Files ordered by code importance (rank descending)\n${wrapUntrusted(
          'top-files',
          topFiles.join('\n') || '(no files indexed)',
        )}`,
        // The final instruction enumerates ALL five required fields — deepseek via
        // OpenRouter does not grammar-enforce the JSON schema, and a trailing
        // instruction about a single field makes it answer with only that field
        // (bit us on the first live generation: response contained reading_path only).
        `Respond with a JSON object containing ALL five fields:\n` +
          `1. "architecture_overview" — markdown prose: what the system is, key entry points, how the parts fit together.\n` +
          `2. "critical_paths" — array of {file, why} objects: the 4-8 most important files or paths with a one-line reason each (e.g. [{"file":"src/index.ts","why":"Main entry point"}]).\n` +
          `3. "how_to_run_locally" — array of shell command strings in execution order, inferred from the file tree (e.g. ["npm install","npm run build","npm start"]; a command may carry a trailing # comment).\n` +
          `4. "reading_path" — array with EXACTLY one {"file", "description"} entry per file listed under "Files ordered by code importance", in the same order; one-to-two sentence description each.\n` +
          `5. "first_tasks" — markdown: 3-5 suggested first tasks for a newcomer.\n` +
          `Every field is required; do not omit any.`,
      ].join('\n\n');

      // Step 12: Start timer immediately before the LLM call
      const startMs = Date.now();

      // Step 13: Single structured LLM call — any throw → ExternalServiceError (AC-5 preserved)
      let result;
      try {
        result = await llm.completeStructured({
          model,
          schema: TourLLMSchema,
          schemaName: 'OnboardingTour',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.2,
          // Five markdown sections + a description per reading-path file easily
          // exceed 4k output tokens; a truncated response fails schema validation
          // on both attempts (hit on the first live generation).
          maxTokens: 12_000,
          maxRetries: 1,
        });
      } catch (err) {
        // Schema-validation failure after retry, provider errors → 502
        // upsertTour is never reached here — AC-5 satisfied by construction
        throw new ExternalServiceError(
          'llm-onboarding',
          err instanceof Error ? err.message : String(err),
        );
      }

      // Step 14: Wall-clock duration
      const durationMs = Date.now() - startMs;

      // Step 15: Assemble reading path — order preserved from topFiles (rank-descending)
      // LLM descriptions keyed by file path
      const descMap = new Map(
        result.data.reading_path.map((item: { file: string; description: string }) => [
          item.file,
          item.description,
        ]),
      );
      const readingPath: ReadingPathItem[] = topFiles.map((file) => ({
        file,
        rank: rankMap.get(file) ?? 0,
        description: descMap.get(file) ?? '',
      }));

      // Sections (four prose sections — reading_path is stored separately)
      const sections: OnboardingTourSections = {
        architecture_overview: result.data.architecture_overview,
        critical_paths: result.data.critical_paths,
        how_to_run_locally: result.data.how_to_run_locally,
        first_tasks: result.data.first_tasks,
      };

      // Step 16: Persist — upsert only runs when LLM call succeeded
      const row = await this.repo.upsertTour({
        repoId,
        workspaceId,
        sections,
        readingPath,
        generatedAt: new Date(),
        filesIndexed: indexState.filesIndexed,
        indexStatusAtGeneration: indexState.status,
      });

      // Step 17: Return DTO + telemetry log
      return {
        tour: toDTO(row),
        log: {
          llm_calls: 1 as const,
          model: result.model,
          tokens_used: result.tokensIn + result.tokensOut,
          duration_ms: durationMs,
        },
      };
    } finally {
      // Always release the in-flight lock regardless of success or error
      this.inFlight.delete(repoId);
    }
  }
}
