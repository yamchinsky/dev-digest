/* RunHistory — table of batch runs with checkboxes for compare selection.
   Only done batches get a compare checkbox (AC-26). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalBatch } from "@devdigest/shared";
import { s } from "./styles";

function fmtCost(cost: number | null): string {
  if (cost === null || cost === undefined) return "—";
  return `$${cost.toFixed(3)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export function RunHistory({
  batches,
  compareIds,
  onToggleCompare,
}: {
  batches: EvalBatch[];
  compareIds: string[];
  onToggleCompare: (id: string) => void;
}) {
  const t = useTranslations("eval");

  if (batches.length === 0) {
    return (
      <div style={s.emptyState} data-testid="history-empty">
        {t("dashboard.noRuns")}
      </div>
    );
  }

  return (
    <div>
      {compareIds.length > 0 && compareIds.length < 2 && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            marginBottom: 8,
          }}
          data-testid="compare-hint"
        >
          {t("evalsTab.history.selectTwo")}
        </div>
      )}
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th} aria-label="Compare select" />
            <th style={s.th}>{t("evalsTab.history.ranAt")}</th>
            <th style={s.th}>{t("evalsTab.history.model")}</th>
            <th style={s.th}>{t("evalsTab.history.version")}</th>
            <th style={s.th}>{t("evalsTab.history.recall")}</th>
            <th style={s.th}>{t("evalsTab.history.precision")}</th>
            <th style={s.th}>{t("evalsTab.history.citation")}</th>
            <th style={s.th}>{t("evalsTab.history.cost")}</th>
            <th style={s.th}>{t("evalsTab.history.status")}</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => {
            const isDone = b.status === "done";
            const isChecked = compareIds.includes(b.id);
            const isDisabled = !isDone || (compareIds.length >= 2 && !isChecked);
            return (
              <tr key={b.id} data-testid={`batch-row-${b.id}`}>
                <td style={s.td}>
                  {isDone && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isDisabled}
                      onChange={() => onToggleCompare(b.id)}
                      aria-label={`${t("evalsTab.history.compare")} ${b.id}`}
                    />
                  )}
                </td>
                <td style={{ ...s.td, ...s.monoCell }}>
                  {fmtDate(b.created_at)}
                </td>
                <td style={{ ...s.td, ...s.monoCell }}>{b.model}</td>
                <td style={s.td}>
                  {b.agent_version !== null ? `v${b.agent_version}` : "—"}
                </td>
                <td style={{ ...s.td, ...s.monoCell }}>{fmtPct(b.recall)}</td>
                <td style={{ ...s.td, ...s.monoCell }}>{fmtPct(b.precision)}</td>
                <td style={{ ...s.td, ...s.monoCell }}>
                  {fmtPct(b.citation_accuracy)}
                </td>
                <td
                  style={{ ...s.td, ...s.monoCell }}
                  data-testid={`cost-${b.id}`}
                >
                  {fmtCost(b.cost_usd)}
                </td>
                <td style={s.td}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color:
                        b.status === "done"
                          ? "#22c55e"
                          : b.status === "failed"
                          ? "#ef4444"
                          : "var(--accent)",
                    }}
                  >
                    {b.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
