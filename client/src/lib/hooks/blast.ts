/* hooks/blast.ts — React Query hook over GET /pulls/:id/blast.
   Returns the BlastRadius contract (changed symbols → callers → endpoints/crons). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { BlastRadius } from "@devdigest/shared";

/** Fetch the blast-radius analysis for a PR.
 *  The query is silently disabled when prId is nullish.
 *  The endpoint is token-free (no LLM, no run row). */
export function useBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: prId != null,
  });
}
