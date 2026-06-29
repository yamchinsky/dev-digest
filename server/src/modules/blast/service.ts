import type { BlastRadius } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { BlastRepository } from './repository.js';
import { composeBlast } from './compose.js';

/**
 * BlastService — token-free blast-radius read for a PR.
 *
 * Mirrors ReviewService.smartDiffForPull: plain DB reads + the repo-intel
 * facade, no LLM, no RunLogger, no run_traces row created.
 *
 * Flow:
 *   1. Look up pull (404 + workspace scope guard).
 *   2. Fetch changed file paths from prFiles.
 *   3. In parallel: call repo-intel facade (getBlastRadius + getIndexState)
 *      and query prior PRs.
 *   4. Delegate to composeBlast (pure) and return.
 */
export class BlastService {
  private readonly repo: BlastRepository;

  constructor(private readonly container: Container) {
    this.repo = new BlastRepository(container.db);
  }

  async blastForPull(workspaceId: string, prId: string): Promise<BlastRadius> {
    // 1. Workspace-scoped pull look-up.
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // 2. Changed file paths + index state (these depend only on repoId / prId).
    const [changedFiles, indexState] = await Promise.all([
      this.repo.getPrFiles(prId),
      this.container.repoIntel.getIndexState(pull.repoId),
    ]);

    // 3. Blast result + prior PRs (parallel; both depend on changedFiles).
    const [blastResult, priorPrs] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pull.repoId, changedFiles),
      this.repo.getPriorPrs(pull.repoId, prId, changedFiles),
    ]);

    // 4. Pure mapping → BlastRadius contract.
    return composeBlast(blastResult, indexState, priorPrs);
  }
}
