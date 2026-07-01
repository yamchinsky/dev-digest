import type { Container } from '../../platform/container.js';
import type {
  ImportCommitBody,
  ImportPreviewItem,
  Skill,
  SkillContextDoc,
  SkillSource,
  SkillStats,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import { RepoRepository } from '../repos/repository.js';
import { toSkillDto } from './helpers.js';
import { previewImport, ImportError } from './import.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { discoverContextDocs } from '../workspace/discovery.js';

/**
 * A1 — skills service. Business logic for the Skills page + import flow.
 *
 * Skill = name + description + type + body (markdown) + enabled + version.
 * `source` records *how* the skill was created (`manual`, `extracted`, …) —
 * useful for evidence trails but not exposed in the create payload (manual
 * creates are 'manual' by default; imports default to 'extracted').
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export interface ImportPreviewInput {
  filename: string;
  contentBase64: string;
}

export class SkillsService {
  private repo: SkillsRepository;
  private repoRepo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
    this.repoRepo = new RepoRepository(container.db);
  }

  async list(workspaceId: string, filter: { type?: SkillType; enabled?: boolean; q?: string } = {}): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId, filter);
    // Denormalize linked_agents_count in ONE COUNT (vs N) so the Skills Lab
    // card grid can render usage without a per-card request.
    const counts = await this.repo.linkedAgentsCountByIds(rows.map((r) => r.id));
    return rows.map((r) => ({ ...toSkillDto(r), linked_agents_count: counts.get(r.id) ?? 0 }));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    const count = await this.repo.linkedAgentsCount(id);
    return { ...toSkillDto(row), linked_agents_count: count };
  }

  async create(workspaceId: string, input: CreateSkillInput, source: SkillSource = 'manual'): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source,
      body: input.body,
      enabled: input.enabled,
      evidenceFiles: input.evidenceFiles,
    });
    return toSkillDto(row);
  }

  async update(workspaceId: string, id: string, patch: UpdateSkillInput): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Version history for a skill (oldest first). Returns undefined when the
   *  skill isn't in this workspace — route maps to 404. */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map((r) => ({
      skill_id: r.skillId,
      version: r.version,
      body: r.body,
      created_at: r.createdAt.toISOString(),
    }));
  }

  /** Aggregate stats for the Stats tab. Currently:
   *   - linked_agents_count: cheap COUNT on agent_skills
   *   - linked_agents: id+name+enabled for the "Agents using this skill" list
   *  Pull%, accept%, findings-30d would need per-finding skill attribution
   *  that the data model doesn't yet carry; the client renders those as stubs. */
  async stats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const agents = await this.repo.linkedAgents(workspaceId, id);
    return { linked_agents_count: agents.length, linked_agents: agents };
  }

  /**
   * Parse an uploaded .md/.zip into preview items WITHOUT touching the DB.
   * The route hands these back to the client; the user reviews them under the
   * trust banner, then `commitImport` actually persists.
   */
  previewImport(input: ImportPreviewInput): ImportPreviewItem[] {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(input.contentBase64, 'base64');
    } catch {
      throw new ValidationError('content_base64 is not valid base64');
    }
    try {
      return previewImport({ filename: input.filename, buffer });
    } catch (err) {
      if (err instanceof ImportError) throw new ValidationError(err.message);
      throw err;
    }
  }

  /**
   * Persist a previously-previewed set. Items can be edited client-side between
   * preview and commit (description fill-in, type fix). Returns the saved skills.
   */
  async commitImport(workspaceId: string, body: ImportCommitBody): Promise<Skill[]> {
    const created: Skill[] = [];
    for (const item of body.items) {
      const skill = await this.create(
        workspaceId,
        {
          name: item.name,
          description: item.description || item.name,
          type: item.type,
          body: item.body,
        },
        'extracted',
      );
      created.push(skill);
    }
    return created;
  }

  // ---- context docs ----------------------------------------------------------

  /**
   * Return all context docs attached to a skill (unordered — skills attachments
   * have no ordering). Throws NotFoundError when the skill isn't in this workspace.
   */
  async getContextDocs(workspaceId: string, skillId: string): Promise<SkillContextDoc[]> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    return this.repo.getContextDocs(skillId);
  }

  /**
   * Atomically replace the context docs attached to a skill.
   *
   * Security / R7: builds the workspace's discovered doc set BEFORE persisting
   * and rejects any (repo_id, path) pair that is absent — preventing attachment
   * of arbitrary paths (path-traversal, stale IDs, etc.). The check is all-or-
   * nothing: no partial persistence on any validation failure.
   */
  async replaceContextDocs(
    workspaceId: string,
    skillId: string,
    items: Array<{ path: string; repo_id: string }>,
  ): Promise<SkillContextDoc[]> {
    // (1) Assert skill belongs to workspace — unauthorized access → 404.
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');

    // (2) Fetch all repos for the workspace (single query, then pass to discovery).
    const repos = await this.repoRepo.list(workspaceId);

    // (3) Discover valid context docs from disk (pure FS utility, no DB/LLM).
    const repoInputs = repos.map((r) => ({ repoId: r.id, clonePath: r.clonePath }));
    const discovered = await discoverContextDocs(repoInputs);

    // (4) Build whitelist: `${repoId}:${relativePath}` for O(1) lookup.
    const validSet = new Set(discovered.map((d) => `${d.repoId}:${d.relativePath}`));

    // (5) Validate ALL items before touching the DB — no partial persistence.
    for (const item of items) {
      if (!validSet.has(`${item.repo_id}:${item.path}`)) {
        throw new AppError(
          'INVALID_CONTEXT_DOC_PATH',
          'One or more paths are not in the discovered set',
          400,
        );
      }
    }

    // (6) Atomically replace (repository handles DELETE + INSERT in one transaction).
    await this.repo.replaceContextDocs(
      skillId,
      items.map((it) => ({ repoId: it.repo_id, relativePath: it.path })),
    );

    // Return the authoritative list so callers get consistent state.
    return this.repo.getContextDocs(skillId);
  }
}
