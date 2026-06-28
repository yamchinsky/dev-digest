/* usePrDetailPage — orchestrates the PR detail page: resolves the PR id from
   number, fetches detail/reviews/runs/active-runs, owns the ?tab and ?trace
   query params, exposes invalidation callbacks and the delete/cancel mutations.

   The page component stays thin: it just renders based on this hook's return. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { usePullDetail, usePulls } from "@/lib/hooks";
import {
  usePrReviews,
  useCancelRun,
  usePrActiveRuns,
  usePrRuns,
  useDeleteRun,
} from "@/lib/hooks/reviews";
import { useActiveRepo, useRepoNotFound } from "@/providers/repo-context";

export function usePrDetailPage(repoId: string, number: string) {
  const search = useSearchParams();
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);
  const isLoading = pullsLoading || (prId != null && detailLoading);

  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const cancel = useCancelRun();

  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;

  const invalidateActiveRuns = React.useCallback(() => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  }, [qc, prId]);
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = React.useCallback(() => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  }, [qc, prId]);

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  const findingId = search.get("findingId");

  const setParam = React.useCallback(
    (key: string, val: string | null) => {
      const sp = new URLSearchParams(search.toString());
      if (val == null) sp.delete(key);
      else sp.set(key, val);
      router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
    },
    [search, router, repoId, number],
  );
  const setTab = React.useCallback((t: string) => setParam("tab", t), [setParam]);
  const openTrace = React.useCallback((id: string) => setParam("trace", id), [setParam]);
  const closeTrace = React.useCallback(() => setParam("trace", null), [setParam]);

  // Clicking a Smart Diff severity badge: jump to the Findings tab AND target
  // the clicked finding in ONE router.replace (no intermediate diff-tab render).
  const openFinding = React.useCallback(
    (id: string) => {
      const sp = new URLSearchParams(search.toString());
      sp.set("tab", "findings");
      sp.set("findingId", id);
      router.replace(`/repos/${repoId}/pulls/${number}?${sp.toString()}`);
    },
    [search, router, repoId, number],
  );

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  const findingsCount = runs.reduce((acc, r) => acc + r.findings.length, 0);

  const repoName = activeRepo?.full_name ?? repoId;
  const repoFullName = activeRepo?.full_name ?? null;

  return {
    repoNotFound,
    isLoading,
    isError,
    error,
    refetch,
    pr,
    prId,
    runs,
    prRuns,
    repoName,
    repoFullName,
    findingsCount,
    liveRunIds,
    reviewRunning,
    tab,
    traceRunId,
    findingId,
    setTab,
    openTrace,
    closeTrace,
    openFinding,
    cancel,
    deleteRun,
    refetchReviews,
    invalidateActiveRuns,
    invalidateRunHistory,
  };
}
