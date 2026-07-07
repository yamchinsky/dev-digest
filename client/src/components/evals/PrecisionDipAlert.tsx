/* PrecisionDipAlert — warning banner shown when the latest completed batch's
   precision is lower than the previous completed batch's precision. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalBatch } from "@devdigest/shared";
import { Icon } from "@devdigest/ui";

/** Returns precision-dip data when the latest done run dropped vs. the prior one.
    Takes batches in newest-first order (as the API returns them).
    Exported for unit testing. */
export function computePrecisionDip(
  doneBatches: EvalBatch[],
): { pts: number; version: number } | null {
  if (doneBatches.length < 2) return null;
  const latest = doneBatches[0]!;
  const prev = doneBatches[1]!;
  if (latest.precision === null || prev.precision === null) return null;
  if (latest.precision >= prev.precision) return null;
  const pts = Math.round((prev.precision - latest.precision) * 100);
  const version = latest.agent_version ?? 0;
  return { pts, version };
}

/** Renders a warning banner when precision dropped between the two latest
    completed runs; renders nothing otherwise. */
export function PrecisionDipAlert({
  doneBatches,
}: {
  doneBatches: EvalBatch[];
}) {
  const t = useTranslations("eval");
  const dip = computePrecisionDip(doneBatches);
  if (!dip) return null;

  return (
    <div
      role="alert"
      data-testid="precision-dip-alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        marginBottom: 20,
        borderRadius: 7,
        border: "1px solid #f59e0b44",
        background: "#f59e0b11",
        fontSize: 13,
        color: "var(--text-primary)",
      }}
    >
      <Icon.AlertTriangle size={15} style={{ color: "#f59e0b", flexShrink: 0 }} />
      <span>
        {t("dashboard.alertPrecisionDip", {
          pts: dip.pts,
          version: dip.version,
        })}
      </span>
    </div>
  );
}
