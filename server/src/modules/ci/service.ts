import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Container } from '../../platform/container.js';
import type { CiExport, CiFile, CiInstallation, CiRun, CiTarget } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import type { WorkflowRun } from '@devdigest/shared';
import { ConfigError, ExternalServiceError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { CiRepository, toCiInstallationDto, toCiRunDto } from './repository.js';
import { generateManifestYaml, agentSlug } from './generators/manifest.js';
import { generateWorkflowYaml } from './generators/workflow.js';
import {
  CI_BRANCH,
  MANIFEST_DIR,
  MEMORY_PATH,
  RESULT_ARTIFACT_NAME,
  RUNNER_PATH,
  RUNNER_WORKFLOW_FILE,
  SKILLS_DIR,
} from './constants.js';
import type { CiExportInput } from '@devdigest/shared';

/**
 * Resolve the agent-runner bundle path.
 *
 * The agent-runner lives at `../agent-runner/dist/index.js` relative to the
 * server root (i.e. `../../..` up from this source file, since src/modules/ci/
 * is 3 directories deep inside the server root, and the agent-runner is a
 * sibling of `server/`).
 *
 * Under tsx the file resolves to the .ts source location, so we go:
 *   __dir = server/src/modules/ci  →  +3 = repo root  →  agent-runner/dist/index.js
 */
function resolveRunnerBundlePath(): string {
  const __dir = dirname(fileURLToPath(import.meta.url));
  // src/modules/ci  -> server/src/modules -> server/src -> server -> repo-root
  return join(__dir, '..', '..', '..', '..', 'agent-runner', 'dist', 'index.js');
}

export interface GenerateBundleInput {
  repo: string;
  target: CiTarget;
  action: 'open_pr' | 'files';
  post_as: string;
  triggers: string[];
  base: string;
}

export class CiService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  /**
   * Generate the full CI file bundle for an agent.
   *
   * Files produced:
   *   1. `.devdigest/agents/<slug>.yaml`           — agent manifest (editable: false)
   *   2. `.devdigest/skills/<slug>.md` (per skill) — skill bodies (editable: false)
   *   3. `.devdigest/memory.jsonl`                 — empty memory file (editable: false)
   *   4. `.devdigest/runner/index.js`              — bundled runner (editable: false)
   *   5. `.github/workflows/devdigest-review.yml`  — GHA workflow (editable: true)
   */
  async generateBundle(
    agentId: string,
    workspaceId: string,
    input: GenerateBundleInput,
  ): Promise<CiFile[]> {
    // Load agent (workspace-scoped)
    const agentsRepo = this.container.agentsRepo;
    const agentRow = await agentsRepo.getById(workspaceId, agentId);
    if (!agentRow) throw new NotFoundError('Agent not found');

    // Load enabled linked skills (ordered)
    const linkedSkills = await agentsRepo.linkedSkills(agentId);
    const activeSkills = linkedSkills.filter((l) => l.skill.enabled).map((l) => l.skill);

    // Build the Agent DTO shape needed by generateManifestYaml
    const agentDto = {
      id: agentRow.id,
      name: agentRow.name,
      description: agentRow.description,
      provider: agentRow.provider as 'openai' | 'anthropic' | 'openrouter',
      model: agentRow.model,
      system_prompt: agentRow.systemPrompt,
      output_schema: agentRow.outputSchema ?? null,
      enabled: agentRow.enabled,
      version: agentRow.version,
      strategy: (agentRow.strategy ?? 'auto') as 'auto' | 'single-pass' | 'map-reduce',
      ci_fail_on: (agentRow.ciFailOn ?? 'critical') as 'never' | 'critical' | 'warning' | 'any',
      repo_intel: agentRow.repoIntel,
    };

    const skillDtos = activeSkills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      type: s.type as 'rubric' | 'convention' | 'security' | 'custom',
      source: s.source as 'manual' | 'imported_url' | 'extracted' | 'community',
      body: s.body,
      enabled: s.enabled,
      version: s.version,
      evidence_files: s.evidenceFiles ?? null,
    }));

    const slug = agentSlug(agentRow.name);
    const files: CiFile[] = [];

    // 1. Agent manifest
    files.push({
      path: `${MANIFEST_DIR}/${slug}.yaml`,
      contents: generateManifestYaml(agentDto, skillDtos),
      editable: false,
    });

    // 2. Skill bodies
    for (const skill of skillDtos) {
      const skillSlug = agentSlug(skill.name);
      files.push({
        path: `${SKILLS_DIR}/${skillSlug}.md`,
        contents: skill.body,
        editable: false,
      });
    }

    // 3. Empty memory file
    files.push({
      path: MEMORY_PATH,
      contents: '',
      editable: false,
    });

    // 4. Agent-runner bundle
    files.push(await this.buildRunnerFile(input.action));

    // 5. GitHub Actions workflow (editable so user can tweak triggers etc.)
    files.push({
      path: `.github/workflows/${RUNNER_WORKFLOW_FILE}`,
      contents: generateWorkflowYaml({
        triggers: input.triggers,
        postAs: input.post_as,
        base: input.base,
      }),
      editable: true,
    });

    return files;
  }

  /**
   * Load the agent-runner bundle from disk.
   *
   * - When the bundle exists, return it as a CiFile with editable: false.
   * - For `action='open_pr'`: the bundle is required — throw ConfigError if missing.
   * - For `action='files'` (preview): degrade gracefully with a placeholder comment.
   */
  private async buildRunnerFile(action: 'open_pr' | 'files'): Promise<CiFile> {
    const bundlePath = resolveRunnerBundlePath();
    try {
      const contents = await readFile(bundlePath, 'utf-8');
      return { path: RUNNER_PATH, contents, editable: false };
    } catch (err: unknown) {
      if (action === 'open_pr') {
        throw new ConfigError(
          'agent-runner bundle is not built. Run `npm run build` inside agent-runner/ before opening a PR.',
          { bundlePath },
        );
      }
      // files / preview: return placeholder so UI still works
      return {
        path: RUNNER_PATH,
        contents:
          '// agent-runner bundle not built — run `npm run build` in agent-runner/',
        editable: false,
      };
    }
  }

  /**
   * Export CI configuration for an agent.
   *
   * - `action='files'`: return the bundle without any GitHub/DB side effects.
   * - `action='open_pr'`: commit files to `CI_BRANCH`, find or open a PR,
   *   upsert the installation row, and return the PR URL + installation.
   */
  async exportCi(
    agentId: string,
    workspaceId: string,
    input: CiExportInput,
    userFiles?: CiFile[],
  ): Promise<CiExport> {
    const files = userFiles ?? (await this.generateBundle(agentId, workspaceId, input));

    if (input.action === 'files') {
      return { installation: null, files, pr_url: null };
    }

    // action === 'open_pr'
    const [owner, repoName] = input.repo.split('/');
    if (!owner || !repoName) {
      throw new ValidationError('repo must be in "owner/name" format');
    }
    const repoRef = { owner, name: repoName };

    let github;
    try {
      github = await this.container.github();
    } catch (err) {
      throw new ExternalServiceError(
        'GitHub is not configured — set GITHUB_TOKEN in your secrets.',
      );
    }

    // Commit the files to the CI branch
    try {
      await github.commitFiles(repoRef, {
        branch: CI_BRANCH,
        base: input.base,
        message: `ci: add DevDigest review workflow for ${agentSlug(agentId)}`,
        files: files.map((f) => ({ path: f.path, contents: f.contents })),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ExternalServiceError(`Failed to commit CI files: ${msg}`, { repo: input.repo });
    }

    // Find existing PR or open a new one
    let prUrl: string;
    try {
      const existing = await github.findOpenPr(repoRef, CI_BRANCH);
      if (existing) {
        prUrl = existing.url;
      } else {
        const opened = await github.openPullRequest(repoRef, {
          title: 'Add DevDigest CI Review',
          head: CI_BRANCH,
          base: input.base,
          body: 'Automated PR created by DevDigest to add the AI code review workflow.',
        });
        prUrl = opened.url;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ExternalServiceError(`Failed to open/find PR: ${msg}`, { repo: input.repo });
    }

    // Persist (upsert) the installation record
    const installRow = await this.repo.upsertInstallation(
      agentId,
      input.repo,
      input.target,
    );
    const installation = toCiInstallationDto(installRow);

    return { installation, files, pr_url: prUrl };
  }

  /**
   * Sync CI runs for all installations in a workspace.
   *
   * For each installation:
   *   1. List completed workflow runs from GitHub.
   *   2. Download the result artifact for any run not already recorded.
   *   3. Parse the artifact and insert the row (idempotent via onConflictDoNothing).
   *   4. On GitHub error: commit already-ingested rows and re-throw as ExternalServiceError.
   */
  async syncCiRuns(workspaceId: string): Promise<{ synced: number }> {
    const installations = await this.repo.getInstallationsByWorkspace(workspaceId);

    let github;
    try {
      github = await this.container.github();
    } catch {
      throw new ExternalServiceError('GitHub is not configured — set GITHUB_TOKEN.');
    }

    let synced = 0;

    for (const installation of installations) {
      const [owner, repoName] = installation.repo.split('/');
      if (!owner || !repoName) continue;
      const repoRef = { owner, name: repoName };

      let runs: WorkflowRun[];
      try {
        runs = await github.listWorkflowRuns(repoRef, RUNNER_WORKFLOW_FILE);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ExternalServiceError(
          `GitHub error listing workflow runs for ${installation.repo}: ${msg}`,
          { repo: installation.repo, synced },
        );
      }

      // Only process completed runs
      const completedRuns = runs.filter((r) => r.status === 'completed');

      for (const run of completedRuns) {
        let artifactJson: string;
        try {
          artifactJson = await github.downloadArtifact(
            repoRef,
            run.id,
            RESULT_ARTIFACT_NAME,
          );
        } catch (err: unknown) {
          // Artifact missing or rate-limited — skip this run
          const msg = err instanceof Error ? err.message : String(err);
          if (isRateLimitError(err)) {
            throw new ExternalServiceError(
              `GitHub rate limit hit while syncing ${installation.repo}: ${msg}`,
              { repo: installation.repo, synced },
            );
          }
          // Artifact missing for this run: skip and continue
          continue;
        }

        let artifact: ReturnType<typeof CiResultArtifact.safeParse>['data'];
        try {
          const raw = JSON.parse(artifactJson) as unknown;
          const parsed = CiResultArtifact.safeParse(raw);
          if (!parsed.success) {
            // AC-25: invalid artifact shape — log and skip
            // eslint-disable-next-line no-console
            console.warn(
              `[ci-sync] Invalid artifact for run ${run.id} in ${installation.repo}:`,
              parsed.error.message,
            );
            continue;
          }
          artifact = parsed.data;
        } catch {
          // eslint-disable-next-line no-console
          console.warn(`[ci-sync] Failed to parse artifact JSON for run ${run.id}`);
          continue;
        }

        // Determine CI run status from workflow conclusion
        const status = conclusionToStatus(run.conclusion);

        // durationS: convert duration_ms → seconds (nullable)
        const durationS =
          artifact.duration_ms != null ? artifact.duration_ms / 1000 : null;

        const inserted = await this.repo.insertCiRun({
          ciInstallationId: installation.id,
          prNumber: artifact.pr_number ?? null,
          ranAt: new Date(run.created_at),
          status,
          findingsCount: artifact.findings_count,
          costUsd: artifact.cost_usd ?? null,
          githubUrl: run.html_url,
          source: 'github_actions',
          agent: artifact.agent,
          durationS,
          githubRunId: run.id,
          critical: artifact.critical ?? null,
          warning: artifact.warning ?? null,
          suggestion: artifact.suggestion ?? null,
        });

        if (inserted) {
          synced += 1;
        }
      }
    }

    return { synced };
  }

  /** Workspace-scoped CI run query with optional filters. */
  async getCiRuns(
    workspaceId: string,
    filters: {
      agentId?: string;
      repo?: string;
      status?: string;
      since?: Date;
    },
  ): Promise<CiRun[]> {
    const rows = await this.repo.getCiRuns({ workspaceId, ...filters });
    return rows.map(toCiRunDto);
  }

  /** All CI installations for a given agent (workspace-scoped check). */
  async getInstallations(agentId: string, workspaceId: string): Promise<CiInstallation[]> {
    // Verify agent belongs to the workspace
    const agentRow = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agentRow) throw new NotFoundError('Agent not found');

    const rows = await this.repo.getInstallationsByAgent(agentId);
    return rows.map(toCiInstallationDto);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a GitHub Actions workflow conclusion to a CiRunStatus string. */
function conclusionToStatus(conclusion: string | null): string {
  switch (conclusion) {
    case 'success':
      return 'succeeded';
    case 'failure':
      return 'failed';
    case null:
    case 'neutral':
      return 'running';
    default:
      return 'failed';
  }
}

/** Heuristic: treat 403/rate-limit errors as rate-limit errors so we stop and report. */
function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('429') ||
    (msg.includes('403') && msg.includes('secondary'))
  );
}
