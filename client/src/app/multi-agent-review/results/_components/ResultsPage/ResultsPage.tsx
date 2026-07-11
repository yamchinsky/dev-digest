"use client";

/**
 * ResultsPage — the main Results page component.
 *
 * Data flow:
 *  - Reads ?pr and ?runs from the URL (passed in as props from the page shell).
 *  - Loads usePrRuns(prId) → filters to URL run-id set → RunSummary[].
 *  - Loads usePrReviews(prId) → filters to URL run-id set → ReviewRecord[].
 *  - Subscribes useRunEvents(runIds) for live SSE status updates.
 *  - Renders Columns view (default) or Tabs view (toggle).
 *  - Renders DisagreementBlock below the active view.
 *  - "View trace" opens RunTraceDrawer from @/components/RunTraceDrawer.
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { FindingRecord, RunSummary, ReviewRecord } from "@devdigest/shared";
import RunTraceDrawer from "@/components/RunTraceDrawer";
import { usePrRuns, usePrReviews, useRunEvents } from "@/lib/hooks/reviews";
import { groupFindingsByLocation } from "../../_lib/groupFindingsByLocation";
import { AgentColumn } from "../AgentColumn/AgentColumn";
import { AgentTab } from "../AgentTab/AgentTab";
import { DisagreementBlock } from "../DisagreementBlock/DisagreementBlock";

export interface ResultsPageProps {
  prId: string;
  runIds: string[];
}

type ViewMode = "columns" | "tabs";

/** Derive the live status for a run id from SSE events. The last terminal event wins. */
function getLiveStatus(
  runId: string,
  events: ReturnType<typeof useRunEvents>["events"],
): string | null {
  // Events carry runId; filter to this run and take the last result/error event
  const relevant = events.filter((e) => e.runId === runId);
  for (let i = relevant.length - 1; i >= 0; i--) {
    const ev = relevant[i];
    if (!ev) continue;
    if (ev.kind === "result") return "done";
    if (ev.kind === "error") return "failed";
  }
  return null;
}

export function ResultsPage({ prId, runIds }: ResultsPageProps) {
  const t = useTranslations("multiAgentReviewResults");
  const [view, setView] = React.useState<ViewMode>("columns");
  const [drawerRunId, setDrawerRunId] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<string>(runIds[0] ?? "");

  const { data: allRuns } = usePrRuns(prId);
  const reviewsQuery = usePrReviews(prId);
  const allReviews = reviewsQuery.data;
  const { events } = useRunEvents(runIds);

  // Filter runs and reviews to the URL run-id set
  const runSet = new Set(runIds);
  const runs: RunSummary[] = (allRuns ?? []).filter((r) => runSet.has(r.run_id));
  const reviews: ReviewRecord[] = (allReviews ?? []).filter(
    (r) => r.run_id !== null && runSet.has(r.run_id),
  );

  // Map runId → RunSummary for quick lookup
  const runById = new Map<string, RunSummary>(runs.map((r) => [r.run_id, r]));

  // Findings and summaries live in the reviews query, which has NO auto-poll —
  // without this, a run that finishes after page load keeps "0 findings"
  // until a manual reload. Re-pull the reviews each time another run reaches
  // a terminal state, so every column's findings arrive as its agent lands.
  const terminalCount = runIds.filter((id) => {
    const st = getLiveStatus(id, events) ?? runById.get(id)?.status ?? null;
    return st === "done" || st === "failed" || st === "cancelled";
  }).length;
  const refetchReviews = reviewsQuery.refetch;
  React.useEffect(() => {
    if (terminalCount > 0) void refetchReviews?.();
  }, [terminalCount, refetchReviews]);
  // Map runId → findings from the ReviewRecord
  const findingsByRunId = new Map<string, FindingRecord[]>();
  // Map runId → one-line summary text from ReviewRecord.summary (AC-12)
  const summaryByRunId = new Map<string, string | null>();
  for (const review of reviews) {
    if (review.run_id) {
      findingsByRunId.set(review.run_id, review.findings ?? []);
      summaryByRunId.set(review.run_id, review.summary ?? null);
    }
  }

  // Build flat list for DisagreementBlock
  const allFindings = runIds.flatMap((runId) => {
    const findings = findingsByRunId.get(runId) ?? [];
    return findings.map((f) => ({
      findingId: f.id,
      runId,
      file: f.file,
      startLine: f.start_line,
      endLine: f.end_line,
      severity: f.severity,
      title: f.title,
    }));
  });
  const disagreementGroups = groupFindingsByLocation(allFindings, runIds);

  // Drawer state: we pass already-loaded findings so no extra fetch is needed (AC-9)
  const drawerRun = drawerRunId ? runById.get(drawerRunId) : null;
  const drawerFindings: FindingRecord[] = drawerRunId
    ? (findingsByRunId.get(drawerRunId) ?? [])
    : [];
  const drawerLiveStatus = drawerRunId ? getLiveStatus(drawerRunId, events) : null;
  const drawerRunning =
    drawerLiveStatus === null
      ? drawerRun?.status === "running"
      : drawerLiveStatus !== "done" && drawerLiveStatus !== "failed";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "16px 20px" }}>
      {/* Page header + view toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          {t("title")}
        </h1>
        {/* Columns / Tabs toggle — keyboard-operable tablist */}
        <div
          role="tablist"
          aria-label={t("viewToggle.label")}
          style={{ display: "flex", gap: 4, border: "1px solid var(--border)", borderRadius: 6, padding: 3 }}
        >
          <button
            role="tab"
            aria-selected={view === "columns"}
            tabIndex={view === "columns" ? 0 : -1}
            onClick={() => setView("columns")}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") setView("tabs");
            }}
            style={{
              ...tabBtn,
              background: view === "columns" ? "var(--bg-hover)" : "transparent",
              color: view === "columns" ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {t("columns")}
          </button>
          <button
            role="tab"
            aria-selected={view === "tabs"}
            tabIndex={view === "tabs" ? 0 : -1}
            onClick={() => setView("tabs")}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setView("columns");
            }}
            style={{
              ...tabBtn,
              background: view === "tabs" ? "var(--bg-hover)" : "transparent",
              color: view === "tabs" ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {t("tabs")}
          </button>
        </div>
      </div>

      {/* Main view */}
      {view === "columns" ? (
        <div style={columnsWrap}>
          {runIds.map((runId) => {
            const summary = runById.get(runId);
            const notFound = !summary && (allRuns !== undefined);
            const liveStatus = getLiveStatus(runId, events);
            const effectiveLiveStatus = liveStatus ?? summary?.status ?? null;
            return (
              <AgentColumn
                key={runId}
                runSummary={summary}
                notFound={notFound}
                findings={findingsByRunId.get(runId) ?? []}
                liveStatus={effectiveLiveStatus}
                onViewTrace={() => setDrawerRunId(runId)}
              />
            );
          })}
        </div>
      ) : (
        /* Tabs view */
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Tab buttons */}
          <div
            role="tablist"
            aria-label={t("title")}
            style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--border)", marginBottom: 16, overflowX: "auto" }}
          >
            {runIds.map((runId) => {
              const summary = runById.get(runId);
              const label = summary?.agent_name ?? runId.slice(0, 8);
              const isActive = activeTab === runId;
              return (
                <button
                  key={runId}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(runId)}
                  onKeyDown={(e) => {
                    const idx = runIds.indexOf(runId);
                    if (e.key === "ArrowRight" && idx < runIds.length - 1) {
                      const next = runIds[idx + 1];
                      if (next) setActiveTab(next);
                    } else if (e.key === "ArrowLeft" && idx > 0) {
                      const prev = runIds[idx - 1];
                      if (prev) setActiveTab(prev);
                    }
                  }}
                  style={{
                    ...agentTabBtn,
                    borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                    color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Active tab panel */}
          {runIds.map((runId) => {
            if (runId !== activeTab) return null;
            const runSummary = runById.get(runId);
            const liveStatus = getLiveStatus(runId, events);
            const effectiveLiveStatus = liveStatus ?? runSummary?.status ?? null;
            return (
              <div key={runId} role="tabpanel">
                <AgentTab
                  runSummary={runSummary}
                  findings={findingsByRunId.get(runId) ?? []}
                  liveStatus={effectiveLiveStatus}
                  prId={prId}
                  onViewTrace={() => setDrawerRunId(runId)}
                  summary={summaryByRunId.get(runId) ?? null}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* DisagreementBlock — shown below both views */}
      <DisagreementBlock
        groups={disagreementGroups}
        runSummaries={runs}
        runIds={runIds}
      />

      {/* RunTraceDrawer — opened via "View trace"; findings passed as prop (no extra fetch) */}
      {drawerRunId && (
        <RunTraceDrawer
          key={drawerRunId}
          runId={drawerRunId}
          agentName={drawerRun?.agent_name}
          findings={drawerFindings}
          running={drawerRunning}
          onClose={() => setDrawerRunId(null)}
        />
      )}
    </div>
  );
}

// ----- Styles -----
const columnsWrap: React.CSSProperties = {
  display: "flex",
  gap: 12,
  overflowX: "auto",
  alignItems: "flex-start",
};

const tabBtn: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 4,
  border: "none",
  cursor: "pointer",
  transition: "background .1s, color .1s",
};

const agentTabBtn: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 13,
  background: "transparent",
  border: "none",
  borderBottom: "2px solid transparent",
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "color .1s, border-color .1s",
};
