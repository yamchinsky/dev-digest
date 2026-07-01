import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Container } from '../../platform/container.js';
import type { ContextDoc } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { discoverContextDocs } from './discovery.js';
import { WorkspaceRepository } from './repository.js';
import { RepoRepository } from '../repos/repository.js';

/**
 * WorkspaceService — Project Context discovery.
 *
 * Orchestrates: repos query → filesystem discovery → agent-count aggregation
 * → ContextDoc[]. The preview method adds a whitelist-gate before file read
 * (security: never read a file outside the discovered set).
 */
export class WorkspaceService {
  private repo: WorkspaceRepository;
  private repoRepo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new WorkspaceRepository(container.db);
    this.repoRepo = new RepoRepository(container.db);
  }

  /** List all discovered context docs for the entire workspace. */
  async listForWorkspace(workspaceId: string): Promise<ContextDoc[]> {
    const repos = await this.repoRepo.list(workspaceId);

    const repoInputs = repos.map((r) => ({ repoId: r.id, clonePath: r.clonePath }));
    const discovered = await discoverContextDocs(repoInputs);

    if (discovered.length === 0) return [];

    const counts = await this.repo.agentCountsForPaths(workspaceId, discovered);

    return discovered.map((doc) => ({
      repo_id: doc.repoId,
      relative_path: doc.relativePath,
      category: doc.category,
      agent_count: counts.get(`${doc.repoId}:${doc.relativePath}`) ?? 0,
    }));
  }

  /**
   * List discovered context docs for a single repo (workspace-scoped).
   * Throws NotFoundError when the repo doesn't belong to this workspace.
   */
  async listForRepo(workspaceId: string, repoId: string): Promise<ContextDoc[]> {
    const repo = await this.repoRepo.getById(workspaceId, repoId);

    if (!repo) throw new NotFoundError('Repo not found');

    const discovered = await discoverContextDocs([{ repoId, clonePath: repo.clonePath }]);

    if (discovered.length === 0) return [];

    const counts = await this.repo.agentCountsForPaths(workspaceId, discovered);

    return discovered.map((doc) => ({
      repo_id: doc.repoId,
      relative_path: doc.relativePath,
      category: doc.category,
      agent_count: counts.get(`${doc.repoId}:${doc.relativePath}`) ?? 0,
    }));
  }

  /**
   * Read the raw Markdown content of a single context doc.
   *
   * Security: the whitelist (built by discoverContextDocs) is verified BEFORE
   * the fs.readFile call. Any path not in the discovered set → NotFoundError,
   * which prevents reading arbitrary files from the clone directory.
   */
  async preview(
    workspaceId: string,
    repoId: string,
    relativePath: string,
  ): Promise<{ content: string }> {
    // (1) Verify the repo belongs to this workspace
    const repo = await this.repoRepo.getById(workspaceId, repoId);

    if (!repo) throw new NotFoundError('Repo not found');

    // (2) Build whitelist — only paths returned by discovery are valid reads
    const discovered = await discoverContextDocs([
      { repoId, clonePath: repo.clonePath },
    ]);
    const validPaths = new Set(discovered.map((d) => d.relativePath));

    // (3) Whitelist check BEFORE any filesystem read
    if (!validPaths.has(relativePath)) {
      throw new NotFoundError('Context doc not found');
    }

    // (4) Safe to read: path is within the clone and is in the discovered set
    const clonePath = repo.clonePath!; // non-null: discoverContextDocs skips null paths
    try {
      const content = await readFile(path.join(clonePath, relativePath), 'utf8');
      return { content };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError('Context doc not found or no longer readable');
      }
      throw err;
    }
  }
}
