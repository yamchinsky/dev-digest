import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BriefRecord } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import {
  NotFoundError,
  ValidationError,
  ExternalServiceError,
  ConfigError,
} from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { BlastService } from '../blast/service.js';
import { ReviewService } from '../reviews/service.js';
import { RepoRepository } from '../repos/repository.js';
import { BriefRepository } from './repository.js';
import {
  BriefLLMSchema,
  assembleBriefMessages,
  groundBrief,
  normalizePath,
  resolveLinkedIssue,
} from './helpers.js';

export class BriefService {
  private repo: BriefRepository;
  private repoRepo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new BriefRepository(container.db);
    this.repoRepo = new RepoRepository(container.db);
  }

  /** GET — return the persisted brief, or null when none exists (no LLM call). */
  async getBrief(
    workspaceId: string,
    prId: string,
  ): Promise<{ brief: BriefRecord | null }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const brief = await this.repo.getBrief(prId, console);
    return { brief };
  }

  /**
   * POST — generate and persist a new brief.
   *
   * Exactly ONE completeStructured call per invocation (AC-5).
   * dropped_items is ephemeral — returned in the response but NOT stored in the DB.
   */
  async generateBrief(
    workspaceId: string,
    prId: string,
  ): Promise<{ brief: BriefRecord; dropped_items: number }> {
    // 1. Workspace-scoped pull look-up.
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // 2. Intent guard — brief requires intent to exist first.
    const intent = await this.repo.getIntent(prId);
    if (!intent) {
      throw new ValidationError('Compute the PR intent before generating a brief.', {
        code: 'intent_required',
      });
    }

    // 3. Repo look-up.
    const repo = await this.repoRepo.getById(workspaceId, pull.repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    // 4. Gather inputs in parallel.
    const [blast, smartDiff, linkedIssue] = await Promise.all([
      new BlastService(this.container).blastForPull(workspaceId, prId),
      new ReviewService(this.container).smartDiffForPull(workspaceId, prId),
      resolveLinkedIssue(this.container, repo, pull.body),
    ]);

    // 5. Build prFileSet from normalized paths (Extra-CRITICAL — normalize on BOTH sides).
    const rawFilePaths = [
      ...blast.changed_symbols.map((s) => s.file),
      ...smartDiff.groups.flatMap((g) => g.files.map((f) => f.path)),
    ];
    const prFileSet = new Set(rawFilePaths.map(normalizePath));

    // 6. Collect context docs in deterministic order (AC-10).
    const contextDocContents = await this.collectContextDocs(workspaceId);

    // 7. Build smartDiffStats — plain text role + path + +N/-N stats; no hunk bodies (AC-4).
    const smartDiffStats = smartDiff.groups
      .map((g) => {
        const fileLines = g.files
          .map((f) => `${f.path} (+${f.additions} -${f.deletions})`)
          .join('\n');
        return `[${g.role}]\n${fileLines}`;
      })
      .join('\n\n');

    // 8. Build intentText from persisted intent.
    const intentText = [
      intent.intent,
      `In scope: ${intent.in_scope.join(', ')}`,
      `Out of scope: ${intent.out_of_scope.join(', ')}`,
    ].join('\n');

    // 9. Assemble LLM messages (all five untrusted surfaces wrapped — AC-11).
    const messages = assembleBriefMessages({
      intent: intentText,
      blastSummary: blast.summary,
      smartDiffStats,
      linkedIssue,
      contextDocContents,
    });

    // 10. Resolve feature model (never hardcoded — via workspace settings or registry default).
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'risk_brief',
    );

    // 11. Resolve LLM adapter. ConfigError passes through; other failures → ExternalServiceError.
    let llm;
    try {
      llm = await this.container.llm(provider as 'openai' | 'anthropic' | 'openrouter');
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ExternalServiceError(
        'llm-brief',
        err instanceof Error ? err.message : String(err),
      );
    }

    // 12. Single structured LLM call (AC-5 — exactly one call per POST).
    let result;
    try {
      result = await llm.completeStructured({
        model,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
        schema: BriefLLMSchema,
        schemaName: 'Brief',
        maxRetries: 1,
      });
    } catch (err) {
      throw new ExternalServiceError(
        'llm-brief',
        err instanceof Error ? err.message : String(err),
      );
    }

    // 13. Grounding gate — drop risks/focus entries outside the PR file set (AC-6, AC-7).
    const { risks, review_focus, droppedItems } = groundBrief(result.data, prFileSet);

    // 14. Build BriefRecord (stored shape — no dropped_items here).
    const briefRecord: BriefRecord = {
      what: result.data.what,
      why: result.data.why,
      risk_level: result.data.risk_level,
      risks,
      review_focus,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd: result.costUsd,
      generated_at: new Date().toISOString(),
    };

    // 15. Persist.
    await this.repo.upsertBrief(prId, briefRecord);

    // 16. Return (dropped_items ephemeral — response only, not stored).
    return { brief: briefRecord, dropped_items: droppedItems };
  }

  /**
   * Collect context doc contents from all workspace agents in deterministic order.
   *
   * Ordering: agents sorted by id (UUID) for stability; docs within each agent
   * by order ASC (guaranteed by repository query). Deduped by
   * normalizePath(repoId + ':' + relativePath); first-occurrence wins (AC-10).
   * Zero-byte files are silently skipped; missing files emit a console.warn.
   */
  private async collectContextDocs(workspaceId: string): Promise<string[]> {
    const agents = await this.container.agentsRepo.list(workspaceId);
    // Sort by id for deterministic ordering when multiple agents exist.
    agents.sort((a, b) => a.id.localeCompare(b.id));

    // Merge all agent doc paths, deduping by normalized key.
    const seen = new Set<string>();
    const mergedDocs: Array<{ repoId: string; relativePath: string }> = [];

    for (const agent of agents) {
      const docPaths = await this.container.agentsRepo.getContextDocPaths(agent.id);
      for (const d of docPaths) {
        const key = normalizePath(`${d.repoId}:${d.relativePath}`);
        if (!seen.has(key)) {
          seen.add(key);
          mergedDocs.push(d);
        }
      }
    }

    if (mergedDocs.length === 0) return [];

    // Batch-fetch clone paths — one query for all unique repo ids.
    const uniqueRepoIds = [...new Set(mergedDocs.map((d) => d.repoId))];
    const repoRows = await this.repoRepo.getClonePathsByIds(uniqueRepoIds);
    const clonePathById = new Map(repoRows.map((r) => [r.id, r.clonePath]));

    // Read files: skip missing (warn), skip zero-byte (silent).
    const contents: string[] = [];
    for (const doc of mergedDocs) {
      const clonePath = clonePathById.get(doc.repoId) ?? null;
      if (!clonePath || !existsSync(join(clonePath, doc.relativePath))) {
        console.warn(`[brief] Context doc missing: ${doc.relativePath}`);
        continue;
      }
      const content = await readFile(join(clonePath, doc.relativePath), 'utf8');
      if (content.length === 0) continue; // zero-byte: silently skip
      contents.push(content);
    }

    return contents;
  }
}
