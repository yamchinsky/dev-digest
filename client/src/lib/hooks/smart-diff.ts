/* hooks/smart-diff.ts — React Query hook over GET /pulls/:id/smart-diff.
   Returns the SmartDiff contract (grouped file classification + split suggestion). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { SmartDiff } from "@devdigest/shared";

/** Fetch the smart-diff grouping for a PR. Returns null until the server route
 *  is available; the query is silently disabled when prId is nullish. */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: prId != null,
  });
}
