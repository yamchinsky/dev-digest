/* hooks/skills.ts — React Query hooks over the A1 Skills API. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type {
  ImportPreview,
  ImportPreviewItem,
  Skill,
  SkillStats,
  SkillType,
  SkillVersion,
  AgentSkillLink,
  SkillBenchmarkRun,
  SkillBenchmarkStartInput,
} from "@devdigest/shared";

export interface SkillsFilter {
  type?: SkillType;
  enabled?: boolean;
  q?: string;
}

function buildQuery(filter: SkillsFilter): string {
  const parts: string[] = [];
  if (filter.type !== undefined) parts.push(`type=${encodeURIComponent(filter.type)}`);
  if (filter.enabled !== undefined) parts.push(`enabled=${filter.enabled}`);
  if (filter.q) parts.push(`q=${encodeURIComponent(filter.q)}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

export function useSkills(filter: SkillsFilter = {}) {
  return useQuery({
    queryKey: ["skills", filter],
    queryFn: () => api.get<Skill[]>(`/skills${buildQuery(filter)}`),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useToggleSkillEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<Skill>(`/skills/${id}/enabled`, { enabled }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

/**
 * Two-step import: preview() parses the file (no DB write); the user reviews
 * the items under a trust banner; commit() persists. Keeps the import flow
 * "read-only" until the user explicitly accepts the imported instructions.
 */
export function useImportPreview() {
  return useMutation({
    mutationFn: (file: { filename: string; contentBase64: string }) =>
      api.post<ImportPreview>("/skills/import/preview", {
        filename: file.filename,
        content_base64: file.contentBase64,
      }),
  });
}

export function useImportCommit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: ImportPreviewItem[]) =>
      api.post<Skill[]>("/skills/import/commit", { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

/** Read-only history of body snapshots (Versions tab). */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

/** Aggregate stats for the Stats tab — currently just linked-agents count. */
export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", id],
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

// ---- Agent ↔ Skills link (re-exposed here for the AgentEditor Skills tab) ----

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
    },
  });
}

// ---- Skill benchmarks (the "Skill Editor · Evals" tab) ----------------------

const skillBenchmarksKey = (skillId: string) => ["skill-benchmarks", skillId] as const;

/** GET /skills/:id/benchmarks → SkillBenchmarkRun[] (newest first).
    Self-polls every 2 500 ms while any run is still 'running', then stops —
    so the summary + Run button flip running → done without a manual refresh
    (a benchmark runs fire-and-forget server-side). */
export function useSkillBenchmarks(skillId: string | null | undefined) {
  return useQuery({
    queryKey: skillBenchmarksKey(skillId ?? ""),
    queryFn: () => api.get<SkillBenchmarkRun[]>(`/skills/${skillId}/benchmarks`),
    enabled: !!skillId,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.status === "running") ? 2500 : false,
  });
}

/** POST /skills/:id/benchmarks → 202 SkillBenchmarkRun; invalidates the list. */
export function useStartSkillBenchmark(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillBenchmarkStartInput = {}) =>
      api.post<SkillBenchmarkRun>(`/skills/${skillId}/benchmarks`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillBenchmarksKey(skillId) });
    },
  });
}
