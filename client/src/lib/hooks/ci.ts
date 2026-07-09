/* hooks/ci.ts — React Query hooks for the CI export + CI Runs APIs.
   Pattern mirrors hooks/agents.ts: `api` from @/services/api; queryKey conventions. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type {
  CiInstallation,
  CiExport,
  CiExportInputBody,
  CiRun,
} from "@devdigest/shared";

// ---------------------------------------------------------------------------
// CI Installations
// ---------------------------------------------------------------------------

/** GET /agents/:id/ci-installations — list installations for an agent. */
export function useCiInstallations(agentId: string) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci-installations`),
    enabled: !!agentId,
  });
}

// ---------------------------------------------------------------------------
// Export CI
// ---------------------------------------------------------------------------

/** POST /agents/:id/export-ci — export agent to CI (open PR or get files). */
export function useExportCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      input,
    }: {
      agentId: string;
      input: CiExportInputBody;
    }) => api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: (_data, { agentId }) => {
      // Refresh installations list after a successful export
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
    },
  });
}

// ---------------------------------------------------------------------------
// CI Runs
// ---------------------------------------------------------------------------

export interface CiRunsFilters {
  agent_id?: string;
  repo?: string;
  status?: string;
  since?: string;
}

export interface CiRunsOptions {
  /** Pass 60_000 from the CI Runs page; omit/undefined in the CI tab (no auto-poll). */
  refetchInterval?: number;
}

/**
 * GET /ci-runs — list CI runs with optional filters.
 *
 * `refetchInterval` is intentionally NOT hardcoded — the CI Runs page (T4) sets
 * 60s; the CI tab uses this hook WITHOUT auto-poll by omitting the option.
 */
export function useCiRuns(filters: CiRunsFilters = {}, options: CiRunsOptions = {}) {
  const params = new URLSearchParams();
  if (filters.agent_id) params.set("agent_id", filters.agent_id);
  if (filters.repo) params.set("repo", filters.repo);
  if (filters.status) params.set("status", filters.status);
  if (filters.since) params.set("since", filters.since);
  const qs = params.toString();

  return useQuery({
    queryKey: ["ci-runs", filters],
    queryFn: () => api.get<CiRun[]>(`/ci-runs${qs ? `?${qs}` : ""}`),
    refetchInterval: options.refetchInterval,
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// Sync CI Runs
// ---------------------------------------------------------------------------

/** POST /ci-runs/sync — trigger a manual sync of CI run data from GitHub. */
export function useSyncCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    // The route schema is `body: z.object({})` — an omitted body arrives as
    // null and 422s (same bug class as #31: send {}, not undefined).
    mutationFn: () => api.post<{ synced: number }>("/ci-runs/sync", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}
