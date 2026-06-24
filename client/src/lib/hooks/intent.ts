/* hooks/intent.ts — React Query hooks over the Intent API.
   GET /pulls/:id/intent (query) + POST /pulls/:id/intent (recompute mutation). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { Intent } from "@devdigest/shared";

/** Shape returned by GET /pulls/:id/intent */
export interface IntentResponse {
  intent: Intent | null;
}

/** Shape returned by POST /pulls/:id/intent (recompute) */
export interface RecomputeIntentResponse {
  intent: Intent;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** Fetch the persisted intent for a PR (null when none derived yet). */
export function useIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["intent", prId],
    queryFn: () => api.get<IntentResponse>(`/pulls/${prId}/intent`),
    enabled: prId != null,
  });
}

/** Trigger a fresh intent derivation for a PR and invalidate the cache. */
export function useRecomputeIntent(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RecomputeIntentResponse>(`/pulls/${prId}/intent`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intent", prId] }),
  });
}
