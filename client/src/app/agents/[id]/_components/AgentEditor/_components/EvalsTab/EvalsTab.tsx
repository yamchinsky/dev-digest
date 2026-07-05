/* EvalsTab — eval pipeline UI for an agent (SPEC-04).
 *
 * Sections (top to bottom):
 *  1. Three MetricCards — recall / precision / citation for latest done batch.
 *  2. TrendChart — three series over all done batches.
 *  3. Run controls — start a full eval batch; disabled while one is running.
 *  4. CasesList — eval cases with per-case pass/fail and CRUD actions.
 *  5. RunHistory — batch history with compare checkboxes.
 *  6. CompareView — side-by-side metric delta + per-case flip table.
 */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, MetricCard, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import {
  useEvalBatches,
  useEvalBatch,
  useStartEvalBatch,
} from "@/lib/hooks/evals";
import { TrendChart } from "./TrendChart";
import { CasesList } from "./CasesList";
import { RunHistory } from "./RunHistory";
import { CompareView } from "./CompareView";
import { s } from "./styles";

function fmtMetric(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");

  // Running batch tracking (for polling — AC-24)
  const [runningBatchId, setRunningBatchId] = React.useState<
    string | undefined
  >(undefined);

  // Compare selection state (AC-26)
  const [compareIds, setCompareIds] = React.useState<string[]>([]);

  // ── Data hooks ──────────────────────────────────────────────────────────
  const { data: batches, isLoading: loadingBatches } = useEvalBatches(
    agent.id,
  );

  // Poll the running batch; the hook auto-stops when done/failed and
  // invalidates the batches list (AC-24).
  const runningBatchQuery = useEvalBatch(runningBatchId);

  // Clear local tracking once the batch reaches a terminal state.
  React.useEffect(() => {
    const status = runningBatchQuery.data?.batch.status;
    if ((status === "done" || status === "failed") && runningBatchId) {
      setRunningBatchId(undefined);
    }
  }, [runningBatchQuery.data?.batch.status, runningBatchId]);

  const startBatch = useStartEvalBatch(agent.id);

  // ── Derived state ────────────────────────────────────────────────────────
  // Done batches newest-first (API already orders by created_at desc).
  const doneBatches = (batches ?? []).filter((b) => b.status === "done");
  const latestDone = doneBatches[0];
  const prevDone = doneBatches[1];

  // "Is an eval currently running?" — covers isPending (before response)
  // and the polling phase (after response arrives with status=running).
  const isRunning =
    startBatch.isPending ||
    (batches ?? []).some((b) => b.status === "running") ||
    runningBatchQuery.data?.batch.status === "running";

  const casesCount = (batches ?? []).reduce(
    (acc, b) => Math.max(acc, b.cases_total),
    0,
  );

  // Fetch the latest done batch's run details for per-case status in CasesList.
  const latestDoneBatchDetail = useEvalBatch(latestDone?.id);

  // ── Compare helpers ───────────────────────────────────────────────────────
  function handleToggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev; // max 2
      return [...prev, id];
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={s.wrap}>
      {/* 1. Metric cards */}
      <div style={s.metricsRow}>
        <MetricCard
          label={t("dashboard.metrics.recall")}
          value={fmtMetric(latestDone?.recall ?? null)}
          delta={
            latestDone?.recall != null && prevDone?.recall != null
              ? latestDone.recall - prevDone.recall
              : undefined
          }
          color="#22c55e"
        />
        <MetricCard
          label={t("dashboard.metrics.precision")}
          value={fmtMetric(latestDone?.precision ?? null)}
          delta={
            latestDone?.precision != null && prevDone?.precision != null
              ? latestDone.precision - prevDone.precision
              : undefined
          }
          color="#6366f1"
        />
        <MetricCard
          label={t("dashboard.metrics.citationAccuracy")}
          value={fmtMetric(latestDone?.citation_accuracy ?? null)}
          delta={
            latestDone?.citation_accuracy != null &&
            prevDone?.citation_accuracy != null
              ? latestDone.citation_accuracy - prevDone.citation_accuracy
              : undefined
          }
          color="#f59e0b"
        />
      </div>

      {/* 2. Trend chart (AC-25: only when ≥1 done batch) */}
      <TrendChart doneBatches={doneBatches} />

      {/* 3. Run controls */}
      <div style={s.runControls}>
        <Button
          kind="primary"
          size="sm"
          icon="Play"
          disabled={isRunning}
          loading={isRunning}
          onClick={() =>
            startBatch.mutate(
              {},
              {
                onSuccess: (batch) => {
                  setRunningBatchId(batch.id);
                },
              },
            )
          }
        >
          {isRunning
            ? t("dashboard.running")
            : t("evalsTab.runAll", { count: casesCount })}
        </Button>
      </div>

      {/* 4. Cases list */}
      <div style={s.section}>
        <div style={s.sectionTitle}>{t("evalsTab.casesHeading")}</div>
        {loadingBatches ? (
          <Skeleton height={80} />
        ) : (
          <CasesList
            agent={agent}
            latestDoneBatchDetail={latestDoneBatchDetail.data}
          />
        )}
      </div>

      {/* 5. Run history */}
      <div style={s.section}>
        <div style={s.sectionTitle}>{t("evalsTab.history.title")}</div>
        {loadingBatches ? (
          <Skeleton height={80} />
        ) : (
          <RunHistory
            batches={batches ?? []}
            compareIds={compareIds}
            onToggleCompare={handleToggleCompare}
          />
        )}
      </div>

      {/* 6. Compare view (AC-26/27: appears when exactly 2 runs selected) */}
      {compareIds.length === 2 && (
        <CompareView
          ids={[compareIds[0]!, compareIds[1]!]}
          onClose={() => setCompareIds([])}
        />
      )}
    </div>
  );
}
