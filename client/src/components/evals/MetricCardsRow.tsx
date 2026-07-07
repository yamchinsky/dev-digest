/* MetricCardsRow — the three KPI tiles (recall / precision / citation accuracy)
   derived from the latest and previous done EvalBatch. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MetricCard } from "@devdigest/ui";
import type { EvalBatch } from "@devdigest/shared";
import { s } from "./styles";

/** Format a 0-1 fraction as a percentage string, or "—" for null. */
export function fmtMetric(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export function MetricCardsRow({
  latestDone,
  prevDone,
}: {
  latestDone: EvalBatch | undefined;
  prevDone: EvalBatch | undefined;
}) {
  const t = useTranslations("eval");

  return (
    <div style={s.metricsRow}>
      <MetricCard
        label={t("dashboard.metrics.recall")}
        value={fmtMetric(latestDone?.recall)}
        delta={
          latestDone?.recall != null && prevDone?.recall != null
            ? latestDone.recall - prevDone.recall
            : undefined
        }
        color="#22c55e"
      />
      <MetricCard
        label={t("dashboard.metrics.precision")}
        value={fmtMetric(latestDone?.precision)}
        delta={
          latestDone?.precision != null && prevDone?.precision != null
            ? latestDone.precision - prevDone.precision
            : undefined
        }
        color="#6366f1"
      />
      <MetricCard
        label={t("dashboard.metrics.citationAccuracy")}
        value={fmtMetric(latestDone?.citation_accuracy)}
        delta={
          latestDone?.citation_accuracy != null &&
          prevDone?.citation_accuracy != null
            ? latestDone.citation_accuracy - prevDone.citation_accuracy
            : undefined
        }
        color="#f59e0b"
      />
    </div>
  );
}
