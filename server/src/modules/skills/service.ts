import type { Container } from '../../platform/container.js';
import type {
  ImportCommitBody,
  ImportPreviewItem,
  Skill,
  SkillSource,
  SkillStats,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import { toSkillDto } from './helpers.js';
import { previewImport, ImportError } from './import.js';
import { ValidationError } from '../../platform/errors.js';

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

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string, filter: { type?: SkillType; enabled?: boolean; q?: string } = {}): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId, filter);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
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

  /** Aggregate stats for the Stats tab. Currently just linked-agents count. */
  async stats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const count = await this.repo.linkedAgentsCount(id);
    return { linked_agents_count: count };
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
}
