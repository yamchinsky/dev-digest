/* hooks/context-docs.ts — React Query hooks over the Project Context API. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type {
  ContextDoc,
  AgentContextDoc,
  SkillContextDoc,
  PutContextDocsBody,
} from "@devdigest/shared";

/** All context docs discovered across the active workspace, with agent_count chips. */
export function useWorkspaceContextDocs() {
  return useQuery({
    queryKey: ["workspace-context-docs"],
    queryFn: () => api.get<ContextDoc[]>("/workspace/context-docs"),
  });
}

/**
 * Fetch the raw content of a single context doc for the preview pane.
 * Disabled until both repoId and path are known — avoids spurious 400s
 * while the user is still selecting a row.
 */
export function useContextDocPreview(repoId: string | null, path: string | null) {
  return useQuery({
    queryKey: ["context-doc-preview", repoId, path],
    queryFn: () =>
      api.get<{ content: string }>(
        `/workspace/context-docs/preview?repoId=${encodeURIComponent(repoId!)}&path=${encodeURIComponent(path!)}`
      ),
    enabled: !!repoId && !!path,
  });
}

/** Context docs attached to a specific agent (ordered list). */
export function useAgentContextDocs(agentId: string) {
  return useQuery({
    queryKey: ["agent-context-docs", agentId],
    queryFn: () => api.get<AgentContextDoc[]>(`/agents/${agentId}/context-docs`),
  });
}

/**
 * Replace the full context-doc attachment list for an agent.
 * Invalidates both the agent-scoped cache AND workspace-context-docs so that
 * the agent_count chips on the Project Context page stay accurate.
 */
export function useSetAgentContextDocs(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PutContextDocsBody) =>
      api.put<AgentContextDoc[]>(`/agents/${agentId}/context-docs`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-context-docs", agentId] });
      qc.invalidateQueries({ queryKey: ["workspace-context-docs"] });
    },
  });
}

/** Context docs attached to a specific skill (unordered). */
export function useSkillContextDocs(skillId: string) {
  return useQuery({
    queryKey: ["skill-context-docs", skillId],
    queryFn: () => api.get<SkillContextDoc[]>(`/skills/${skillId}/context-docs`),
  });
}

/**
 * Replace the full context-doc attachment list for a skill.
 * Invalidates both the skill-scoped cache AND workspace-context-docs so that
 * agent_count chips reflect the updated attachment count.
 */
export function useSetSkillContextDocs(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PutContextDocsBody) =>
      api.put<SkillContextDoc[]>(`/skills/${skillId}/context-docs`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-context-docs", skillId] });
      qc.invalidateQueries({ queryKey: ["workspace-context-docs"] });
    },
  });
}
