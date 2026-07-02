/* hooks/onboarding-tour.ts — React Query hooks over the Onboarding Tour API. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { OnboardingTour } from "@devdigest/shared";

const QUERY_KEY = (repoId: string) => ["onboarding-tour", repoId] as const;

/**
 * GET /repos/:repoId/onboarding-tour
 * Returns null when the server responds 404 (no tour yet) — per client error policy
 * (4xx stays silent, pages handle inline empty-state).
 * All 5xx errors are re-thrown; TanStack Query surfaces them via isError.
 */
export function useOnboardingTour(repoId: string) {
  return useQuery({
    queryKey: QUERY_KEY(repoId),
    queryFn: async () => {
      try {
        return await api.get<OnboardingTour>(`/repos/${repoId}/onboarding-tour`);
      } catch (err: unknown) {
        if (err && typeof err === "object" && "status" in err && err.status === 404) {
          return null;
        }
        throw err; // 5xx re-thrown — caller renders ErrorState
      }
    },
    enabled: !!repoId,
    staleTime: 0, // always re-fetch on mount; tour content is large and infrequently updated
  });
}

/**
 * POST /repos/:repoId/onboarding-tour/generate
 *
 * Primary flow (the common case): the server awaits the full LLM call and returns
 * { tour: OnboardingTour, log: GenerationLog } synchronously — no polling needed.
 * On success, write the returned tour directly into the query cache (setQueryData)
 * for an immediate UI update, then also invalidate to trigger a background refresh.
 *
 * Dedup flow (rare — second session fires while first is in-progress on the server):
 * The server returns { status: "in_progress" }. Treat this as an info state, NOT
 * an error. The onSuccess handler detects the shape and invalidates so the GET query
 * re-fetches once the in-progress generation completes.
 */
export function useGenerateTour(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ tour: OnboardingTour; log: unknown } | { status: "in_progress" }>(
        `/repos/${repoId}/onboarding-tour/generate`,
        {},
      ),
    onSuccess: (data) => {
      if ("tour" in data) {
        // Primary path: write fresh tour into cache immediately (no spinner-wait for refetch)
        qc.setQueryData(QUERY_KEY(repoId), data.tour);
      }
      // Always invalidate: ensures background sync and covers the in_progress path
      qc.invalidateQueries({ queryKey: QUERY_KEY(repoId) });
    },
  });
}
