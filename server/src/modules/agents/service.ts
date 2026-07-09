import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentContextDoc,
  AgentSkillLink,
  AgentVersion,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { discoverContextDocs } from '../workspace/discovery.js';
import { AgentsRepository } from './repository.js';
import { RepoRepository } from '../repos/repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export class AgentsService {
  private repo: AgentsRepository;
  private repoRepo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
    this.repoRepo = new RepoRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    const dtos = rows.map(toAgentDto);

    // Batch-query the last 3 done runs per agent in ONE SQL call (window function).
    // Compute avg duration and avg cost (via PriceBook) and fold into each DTO.
    const agentIds = rows.map((r) => r.id);
    const runRows = await this.repo.lastDoneRunsPerAgent(workspaceId, agentIds);
    const priceBook = this.container.priceBook;

    // Group by agentId for O(n) fold.
    const byAgent = new Map<string, typeof runRows>();
    for (const row of runRows) {
      if (!row.agentId) continue;
      const bucket = byAgent.get(row.agentId) ?? [];
      bucket.push(row);
      byAgent.set(row.agentId, bucket);
    }

    return dtos.map((dto) => {
      const bucket = byAgent.get(dto.id) ?? [];
      if (bucket.length === 0) {
        return { ...dto, estimate: { duration_avg_ms: null, cost_avg_usd: null } };
      }
      const durationSum = bucket.reduce((s, r) => s + (r.durationMs ?? 0), 0);
      const duration_avg_ms = durationSum / bucket.length;

      // Cost: compute per run via PriceBook; null if any run has no model/tokens.
      const costs: number[] = [];
      for (const r of bucket) {
        if (r.model && r.tokensIn != null && r.tokensOut != null) {
          const c = priceBook.estimate(r.model, r.tokensIn, r.tokensOut);
          if (c != null) costs.push(c);
        }
      }
      const cost_avg_usd = costs.length > 0 ? costs.reduce((s, c) => s + c, 0) / costs.length : null;

      return { ...dto, estimate: { duration_avg_ms, cost_avg_usd } };
    });
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toAgentDto(row) : undefined;
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({ agent_id: agentId, skill_id: l.skill.id, order: l.order }));
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.setSkills(agentId, skillIds);
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }

  /**
   * Context docs assigned to an agent, ordered. Returns undefined when the agent
   * doesn't exist in this workspace (route maps undefined → 404).
   */
  async getContextDocs(
    workspaceId: string,
    agentId: string,
  ): Promise<AgentContextDoc[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    return this.repo.getContextDocs(agentId);
  }

  /**
   * Atomically replace the context-doc set for an agent.
   *
   * 1. Verifies agent belongs to workspace (→ undefined on mismatch, route → 404).
   * 2. Fetches repos for the workspace and runs filesystem discovery.
   * 3. Validates every requested (repoId, path) pair against the discovered set;
   *    throws ValidationError (code: INVALID_CONTEXT_DOC_PATH) if any is missing —
   *    no partial persist.
   * 4. Delegates to repo.replaceContextDocs (single transaction, order = array index).
   */
  async replaceContextDocs(
    workspaceId: string,
    agentId: string,
    items: Array<{ repo_id: string; path: string }>,
  ): Promise<AgentContextDoc[] | undefined> {
    // 1. Ownership check
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    // 2. Repos for this workspace (id + clone_path for discovery)
    const repos = await this.repoRepo.list(workspaceId);

    // 3. Discover valid context docs via filesystem utility (not WorkspaceService —
    //    avoids cross-service imports and circular dependency risk)
    const discovered = await discoverContextDocs(
      repos.map((r) => ({ repoId: r.id, clonePath: r.clonePath })),
    );
    const validSet = new Set(discovered.map((d) => `${d.repoId}:${d.relativePath}`));

    // 4. All-or-nothing validation: reject before any DB write if any path is invalid
    const firstInvalid = items.find((it) => !validSet.has(`${it.repo_id}:${it.path}`));
    if (firstInvalid) {
      throw new ValidationError('One or more context doc paths are not valid for this workspace', {
        code: 'INVALID_CONTEXT_DOC_PATH',
        path: `${firstInvalid.repo_id}:${firstInvalid.path}`,
      });
    }

    // 5. Atomic replace; order = array index
    await this.repo.replaceContextDocs(
      agentId,
      items.map((it, i) => ({ repoId: it.repo_id, relativePath: it.path, order: i })),
    );

    return this.repo.getContextDocs(agentId);
  }
}
