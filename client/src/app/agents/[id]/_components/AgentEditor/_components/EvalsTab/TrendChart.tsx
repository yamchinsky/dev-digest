/* TrendChart — three-series eval metric line chart over done batches.
   Returns null when there are no done batches (AC-25). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { LineChart, type ChartSeries } from "@devdigest/ui";
import type { EvalBatch } from "@devdigest/shared";
import { s } from "./styles";

export function TrendChart({ doneBatches }: { doneBatches: EvalBatch[] }) {
  const t = useTranslations("eval");

  if (doneBatches.length === 0) return null;

  // Chronological order (API returns newest-first; reverse for x-axis)
  const sorted = [...doneBatches].reverse();

  const series: ChartSeries[] = [
    {
      name: t("dashboard.legend.recall"),
      color: "#22c55e",
      data: sorted.map((b) => b.recall ?? 0),
    },
    {
      name: t("dashboard.legend.precision"),
      color: "#6366f1",
      data: sorted.map((b) => b.precision ?? 0),
    },
    {
      name: t("dashboard.legend.citation"),
      color: "#f59e0b",
      data: sorted.map((b) => b.citation_accuracy ?? 0),
    },
  ];

  return (
    <div style={s.section} data-testid="trend-chart">
      <div style={s.sectionTitle}>{t("dashboard.metricTrend")}</div>
      <LineChart series={series} yMin={0} yMax={1} />
    </div>
  );
}
