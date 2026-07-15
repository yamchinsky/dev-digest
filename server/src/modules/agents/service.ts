import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentContextDoc,
  AgentPerf,
  AgentPerfRow,
  AgentSkillLink,
  AgentStats,
  AgentVersion,
  CiFailOn,
  ModelInfo,
  PerfCostSegment,
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

/** How many recent runs feed the per-agent sparkline trend. */
const TREND_POINTS = 12;

/** Trailing-30-days is the dashboard's default window when no bounds are given. */
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Rich internal per-agent aggregate. Both the global dashboard and the
 * per-agent Stats tab derive from an array of these, so their numbers reconcile
 * by construction. Cost is already folded (via PriceBook) at build time.
 */
interface AgentPerfRecord {
  agentId: string;
  agentName: string;
  provider: string | null;
  model: string | null;
  runs: number;
  findingsTotal: number;
  accepted: number;
  dismissed: number;
  pending: number;
  acceptRate: number | null;
  dismissRate: number | null;
  avgFindingsPerRun: number | null;
  totalCostUsd: number | null;
  avgCostUsd: number | null;
  avgLatencyMs: number | null;
  lastRunAt: string | null;
  severity: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  trend: Array<{ ranAt: string | null; value: number }>;
  costByModel: Map<string, number>;
}

/** Sort by accept-rate descending; agents with no acted-on findings sink last. */
function byAcceptRateDesc(
  a: { accept_rate: number | null },
  b: { accept_rate: number | null },
): number {
  if (a.accept_rate == null && b.accept_rate == null) return 0;
  if (a.accept_rate == null) return 1;
  if (b.accept_rate == null) return -1;
  return b.accept_rate - a.accept_rate;
}

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

  // ---- performance aggregation (dashboard + per-agent Stats) --------------

  /**
   * Resolve the [since, until) window from optional ISO bounds. Absent bounds
   * default to the trailing 30 days ending now — the dashboard's default period.
   */
  private resolveWindow(sinceIso?: string, untilIso?: string): { since: Date; until: Date } {
    const until = untilIso ? new Date(untilIso) : new Date();
    const since = sinceIso ? new Date(sinceIso) : new Date(until.getTime() - DEFAULT_WINDOW_MS);
    return { since, until };
  }

  /**
   * The single aggregation both performance surfaces share. Folds the two
   * windowed queries (done runs + findings-by-agent) into one rich per-agent
   * record; cost is computed on read via PriceBook (never persisted). When
   * `agentId` is given, only that agent's record is built (per-agent Stats).
   * Agents with zero runs in the window still get a record (runs=0, rates null)
   * so the dashboard lists them.
   */
  private async buildAgentRecords(
    workspaceId: string,
    since: Date,
    until: Date,
    agentId?: string,
  ): Promise<AgentPerfRecord[]> {
    const agentRows = agentId
      ? await this.repo.getById(workspaceId, agentId).then((a) => (a ? [a] : []))
      : await this.repo.list(workspaceId);
    if (agentRows.length === 0) return [];

    const [runRows, findingRows] = await Promise.all([
      this.repo.doneRunsInWindow(workspaceId, since, until, agentId),
      this.repo.findingsAggInWindow(workspaceId, since, until, agentId),
    ]);

    const priceBook = this.container.priceBook;

    // Group run rows by agent for an O(n) fold.
    const runsByAgent = new Map<string, typeof runRows>();
    for (const r of runRows) {
      if (!r.agentId) continue;
      const bucket = runsByAgent.get(r.agentId) ?? [];
      bucket.push(r);
      runsByAgent.set(r.agentId, bucket);
    }
    const findingByAgent = new Map(findingRows.map((f) => [f.agentId, f]));

    return agentRows.map((agent) => {
      const bucket = runsByAgent.get(agent.id) ?? [];
      const runs = bucket.length;

      let durSum = 0;
      let durCount = 0;
      let costSum = 0;
      let costCount = 0;
      let lastRun: Date | null = null;
      const costByModel = new Map<string, number>();
      const trend: Array<{ ranAt: string | null; value: number }> = [];

      for (const r of bucket) {
        if (r.durationMs != null) {
          durSum += r.durationMs;
          durCount += 1;
        }
        if (r.ranAt && (!lastRun || r.ranAt > lastRun)) lastRun = r.ranAt;
        if (r.model && r.tokensIn != null && r.tokensOut != null) {
          const c = priceBook.estimate(r.model, r.tokensIn, r.tokensOut);
          if (c != null) {
            costSum += c;
            costCount += 1;
            costByModel.set(r.model, (costByModel.get(r.model) ?? 0) + c);
          }
        }
        trend.push({ ranAt: r.ranAt ? r.ranAt.toISOString() : null, value: r.findingsCount ?? 0 });
      }

      const f = findingByAgent.get(agent.id);
      const findingsTotal = f?.findingsTotal ?? 0;
      const accepted = f?.accepted ?? 0;
      const dismissed = f?.dismissed ?? 0;
      const acted = accepted + dismissed;

      return {
        agentId: agent.id,
        agentName: agent.name,
        provider: agent.provider ?? null,
        model: agent.model ?? null,
        runs,
        findingsTotal,
        accepted,
        dismissed,
        pending: Math.max(0, findingsTotal - acted),
        acceptRate: acted > 0 ? accepted / acted : null,
        dismissRate: acted > 0 ? dismissed / acted : null,
        avgFindingsPerRun: runs > 0 ? findingsTotal / runs : null,
        // avg = total / runs so avg × runs reconciles to the cost breakdown total.
        totalCostUsd: costCount > 0 ? costSum : null,
        avgCostUsd: costCount > 0 && runs > 0 ? costSum / runs : null,
        avgLatencyMs: durCount > 0 ? durSum / durCount : null,
        lastRunAt: lastRun ? lastRun.toISOString() : null,
        severity: {
          CRITICAL: f?.critical ?? 0,
          WARNING: f?.warning ?? 0,
          SUGGESTION: f?.suggestion ?? 0,
        },
        trend: trend.slice(-TREND_POINTS),
        costByModel,
      };
    });
  }

  /**
   * Global Agent Performance dashboard aggregate (`GET /agents/performance`).
   * Summary cards, one row per agent (default sort: accept-rate desc, nulls
   * last), plus cost-by-agent and cost-by-model donut segments. Read-only:
   * reads stored runs/findings, never triggers a review or model call.
   */
  async performance(workspaceId: string, sinceIso?: string, untilIso?: string): Promise<AgentPerf> {
    const { since, until } = this.resolveWindow(sinceIso, untilIso);
    const records = await this.buildAgentRecords(workspaceId, since, until);

    const totalRuns = records.reduce((s, r) => s + r.runs, 0);

    // Total cost = Σ per-agent cost (each already Σ per-run) so the two donut
    // breakdowns sum back to this headline. null only if nothing priced.
    let costSum = 0;
    let anyCost = false;
    const modelTotals = new Map<string, number>();
    for (const r of records) {
      if (r.totalCostUsd != null) {
        costSum += r.totalCostUsd;
        anyCost = true;
      }
      for (const [model, c] of r.costByModel) {
        modelTotals.set(model, (modelTotals.get(model) ?? 0) + c);
      }
    }

    const rated = records.filter((r) => r.acceptRate != null);
    const avgAcceptRate =
      rated.length > 0
        ? rated.reduce((s, r) => s + (r.acceptRate as number), 0) / rated.length
        : null;

    const mostActive = records.filter((r) => r.runs > 0).sort((a, b) => b.runs - a.runs)[0];

    const rows: AgentPerfRow[] = records
      .map((r) => ({
        agent_id: r.agentId,
        agent_name: r.agentName,
        provider: r.provider,
        model: r.model,
        runs: r.runs,
        findings_total: r.findingsTotal,
        accepted: r.accepted,
        dismissed: r.dismissed,
        accept_rate: r.acceptRate,
        dismiss_rate: r.dismissRate,
        avg_findings_per_run: r.avgFindingsPerRun,
        total_cost_usd: r.totalCostUsd,
        avg_cost_usd: r.avgCostUsd,
        avg_latency_ms: r.avgLatencyMs,
        last_run_at: r.lastRunAt,
        findings_by_severity: r.severity,
        trend: r.trend.map((p) => p.value),
      }))
      .sort(byAcceptRateDesc);

    const cost_by_agent: PerfCostSegment[] = records
      .filter((r) => r.totalCostUsd != null && r.totalCostUsd > 0)
      .map((r) => ({ label: r.agentName, value: r.totalCostUsd as number }))
      .sort((a, b) => b.value - a.value);

    const cost_by_model: PerfCostSegment[] = [...modelTotals.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    return {
      summary: {
        runs: totalRuns,
        total_cost_usd: anyCost ? costSum : null,
        avg_accept_rate: avgAcceptRate,
        most_active_agent: mostActive ? mostActive.agentName : null,
      },
      agents: rows,
      cost_by_agent,
      cost_by_model,
    };
  }

  /**
   * Per-agent Stats (`GET /agents/:id/stats`) — the SAME aggregation as the
   * dashboard, scoped to one agent, so the two surfaces report identical numbers
   * for the same agent + period. Returns undefined when the agent isn't in this
   * workspace (route → 404).
   */
  async agentStats(
    workspaceId: string,
    agentId: string,
    sinceIso?: string,
    untilIso?: string,
  ): Promise<AgentStats | undefined> {
    const { since, until } = this.resolveWindow(sinceIso, untilIso);
    const [record] = await this.buildAgentRecords(workspaceId, since, until, agentId);
    if (!record) return undefined;

    return {
      agent_id: record.agentId,
      agent_name: record.agentName,
      runs: record.runs,
      findings_total: record.findingsTotal,
      accepted: record.accepted,
      dismissed: record.dismissed,
      pending: record.pending,
      accept_rate: record.acceptRate,
      dismiss_rate: record.dismissRate,
      avg_findings_per_run: record.avgFindingsPerRun,
      total_cost_usd: record.totalCostUsd,
      avg_cost_usd: record.avgCostUsd,
      avg_latency_ms: record.avgLatencyMs,
      findings_by_severity: record.severity,
      trend: record.trend.map((p) => ({ label: p.ranAt ?? '', value: p.value })),
    };
  }
}
