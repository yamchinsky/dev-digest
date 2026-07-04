/* hooks/brief.ts — React Query hooks over the PR Brief API.
   GET /pulls/:id/brief (query) + POST /pulls/:id/brief (generate mutation). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { BriefRecord } from "@devdigest/shared";

/** Shape returned by GET /pulls/:id/brief */
export interface BriefGetResponse {
  brief: BriefRecord | null;
  /** true when the brief was generated for an older head SHA (new commits since). */
  stale: boolean;
}

/** Shape returned by POST /pulls/:id/brief (generate) */
export interface BriefPostResponse {
  brief: BriefRecord;
  dropped_items: number;
}

/** Fetch the persisted brief for a PR (null when none generated yet). */
export function useBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.get<BriefGetResponse>(`/pulls/${prId}/brief`),
    enabled: prId != null,
  });
}

/** Trigger a fresh brief generation for a PR and write the result into the GET cache. */
export function useGenerateBrief(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BriefPostResponse>(`/pulls/${prId}/brief`, {}),
    onSuccess: (data) => {
      // Write the new brief into the GET cache immediately — no refetch wait.
      // A just-generated brief is never stale by definition.
      qc.setQueryData<BriefGetResponse>(["brief", prId], { brief: data.brief, stale: false });
    },
  });
}
