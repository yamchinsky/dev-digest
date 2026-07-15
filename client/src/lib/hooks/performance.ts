/* hooks/performance.ts — React Query hooks for the Agent Performance dashboard
   (GET /agents/performance) and the per-agent Stats tab (GET /agents/:id/stats).
   Pattern mirrors hooks/ci.ts: `api` from @/services/api; queryKey conventions. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { AgentPerf, AgentStats } from "@devdigest/shared";

export interface PerformanceWindow {
  since?: string;
  until?: string;
}

function buildWindowQuery({ since, until }: PerformanceWindow): string {
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  if (until) params.set("until", until);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** GET /agents/performance — cross-agent leaderboard for the dashboard. */
export function useAgentPerformance(params: PerformanceWindow = {}) {
  const { since, until } = params;
  return useQuery({
    queryKey: ["agent-performance", since ?? null, until ?? null],
    queryFn: () => api.get<AgentPerf>(`/agents/performance${buildWindowQuery(params)}`),
  });
}

/** GET /agents/:id/stats — single-agent aggregates for the Stats tab. */
export function useAgentStats(agentId: string, params: PerformanceWindow = {}) {
  const { since, until } = params;
  return useQuery({
    queryKey: ["agent-stats", agentId, since ?? null, until ?? null],
    queryFn: () => api.get<AgentStats>(`/agents/${agentId}/stats${buildWindowQuery(params)}`),
    enabled: !!agentId,
  });
}
