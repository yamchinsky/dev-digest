/* hooks/conventions.ts — React Query hooks over the Conventions API. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";

export type ConventionStatus = "pending" | "approved" | "rejected";

export interface Convention {
  id: string;
  workspaceId: string;
  repoId: string;
  runId: string;
  category: string;
  rule: string;
  description: string | null;
  evidenceFile: string;
  evidenceLine: number | null;
  evidenceSnippet: string | null;
  confidence: number;
  status: ConventionStatus;
  editedRule: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConventionsFilter {
  runId?: string;
  status?: ConventionStatus;
}

export interface ExtractResult {
  runId: string;
  candidatesCount: number;
  droppedCount: number;
}

function buildQuery(filter: ConventionsFilter): string {
  const parts: string[] = [];
  if (filter.runId !== undefined) parts.push(`runId=${encodeURIComponent(filter.runId)}`);
  if (filter.status !== undefined) parts.push(`status=${encodeURIComponent(filter.status)}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

export function useConventions(repoId: string | null | undefined, filter: ConventionsFilter = {}) {
  return useQuery({
    queryKey: ["conventions", repoId, filter],
    queryFn: () => api.get<Convention[]>(`/repos/${repoId}/conventions${buildQuery(filter)}`),
    enabled: !!repoId,
  });
}

export function useExtractConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ExtractResult>(`/repos/${repoId}/conventions/extract`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function useApproveConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Convention>(`/conventions/${id}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function useRejectConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Convention>(`/conventions/${id}/reject`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function useEditConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rule }: { id: string; rule: string }) =>
      api.patch<Convention>(`/conventions/${id}`, { rule }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export interface BuildSkillFromConventionsInput {
  name: string;
  description: string;
  runId?: string;
}

export interface SkillPreview {
  body: string;
  ruleCount: number;
  fileCount: number;
}

export function usePreviewBuildSkill(repoId: string) {
  return useMutation({
    mutationFn: (input: BuildSkillFromConventionsInput) =>
      api.post<SkillPreview>(`/repos/${repoId}/conventions/preview-skill`, input),
  });
}

export function useBuildSkillFromConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BuildSkillFromConventionsInput) =>
      api.post<{ skillId: string }>(`/repos/${repoId}/conventions/build-skill`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
