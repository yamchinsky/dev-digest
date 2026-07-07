/* CompareView — side-by-side comparison of two batch runs (AC-26, AC-27).
   Fetches EvalBatchDetail for each selected run and shows metric deltas
   plus a per-case flip table. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@devdigest/ui";
import { useEvalBatch } from "@/lib/hooks/evals";
import { s } from "./styles";

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function signedDelta(b: number | null, a: number | null): React.ReactNode {
  if (b === null || a === null) return <span style={s.deltaFlat}>—</span>;
  const d = b - a;
  const str = `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`;
  if (Math.abs(d) < 0.0001) return <span style={s.deltaFlat}>{str}</span>;
  return d > 0 ? (
    <span style={s.deltaPos}>{str}</span>
  ) : (
    <span style={s.deltaNeg}>{str}</span>
  );
}

export function CompareView({
  ids,
  onClose,
}: {
  ids: [string, string];
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const queryA = useEvalBatch(ids[0]);
  const queryB = useEvalBatch(ids[1]);

  if (queryA.isLoading || queryB.isLoading) {
    return (
      <div style={s.compareWrap}>
        <Skeleton height={120} />
      </div>
    );
  }

  const detailA = queryA.data;
  const detailB = queryB.data;
  const batchA = detailA?.batch;
  const batchB = detailB?.batch;

  // Per-case flip table: rows where pass differs between A and B
  const runsA = detailA?.runs ?? [];
  const runsB = detailB?.runs ?? [];

  const runsAMap = new Map(runsA.map((r) => [r.case_id, r]));
  const runsBMap = new Map(runsB.map((r) => [r.case_id, r]));

  const allCaseIds = new Set([
    ...runsA.map((r) => r.case_id),
    ...runsB.map((r) => r.case_id),
  ]);

  const flips = [...allCaseIds].filter((caseId) => {
    const rA = runsAMap.get(caseId);
    const rB = runsBMap.get(caseId);
    return rA?.pass !== rB?.pass;
  });

  return (
    <div style={s.compareWrap} data-testid="compare-view">
      <div style={s.compareHeader}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>
          {t("compare.title")}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            color: "var(--text-muted)",
          }}
          aria-label={t("compare.close")}
        >
          {t("compare.close")}
        </button>
      </div>

      {/* Metric delta table */}
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Metric</th>
            <th style={s.th}>{t("compare.baseline")}</th>
            <th style={s.th}>{t("compare.candidate")}</th>
            <th style={s.th}>{t("compare.delta")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...s.td, fontWeight: 600 }}>
              {t("dashboard.metrics.recall")}
            </td>
            <td style={{ ...s.td, ...s.monoCell }}>
              {fmtPct(batchA?.recall ?? null)}
            </td>
            <td style={{ ...s.td, ...s.monoCell }}>
              {fmtPct(batchB?.recall ?? null)}
            </td>
            <td style={s.td}>
              {signedDelta(batchB?.recall ?? null, batchA?.recall ?? null)}
            </td>
          </tr>
          <tr>
            <td style={{ ...s.td, fontWeight: 600 }}>
              {t("dashboard.metrics.precision")}
            </td>
            <td style={{ ...s.td, ...s.monoCell }}>
              {fmtPct(batchA?.precision ?? null)}
            </td>
            <td style={{ ...s.td, ...s.monoCell }}>
              {fmtPct(batchB?.precision ?? null)}
            </td>
            <td style={s.td}>
              {signedDelta(batchB?.precision ?? null, batchA?.precision ?? null)}
            </td>
          </tr>
          <tr>
            <td style={{ ...s.td, fontWeight: 600 }}>
              {t("dashboard.metrics.citationAccuracy")}
            </td>
            <td style={{ ...s.td, ...s.monoCell }}>
              {fmtPct(batchA?.citation_accuracy ?? null)}
            </td>
            <td style={{ ...s.td, ...s.monoCell }}>
              {fmtPct(batchB?.citation_accuracy ?? null)}
            </td>
            <td style={s.td}>
              {signedDelta(
                batchB?.citation_accuracy ?? null,
                batchA?.citation_accuracy ?? null,
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Per-case flip table (AC-27) */}
      <div style={{ marginTop: 20 }}>
        <div style={s.sectionTitle}>{t("compare.flipTable")}</div>
        {flips.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("compare.noFlips")}
          </div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>{t("compare.caseName")}</th>
                <th style={s.th}>{t("compare.baseline")}</th>
                <th style={s.th}>{t("compare.candidate")}</th>
              </tr>
            </thead>
            <tbody>
              {flips.map((caseId) => {
                const rA = runsAMap.get(caseId);
                const rB = runsBMap.get(caseId);
                const name =
                  rB?.case_name ?? rA?.case_name ?? caseId;
                return (
                  <tr key={caseId} data-testid={`flip-row-${caseId}`}>
                    <td style={{ ...s.td, ...s.monoCell }}>{name}</td>
                    <td style={s.td}>
                      <span style={s.passBadge(rA?.pass ?? null)}>
                        {rA?.pass === true
                          ? "pass"
                          : rA?.pass === false
                          ? "fail"
                          : "—"}
                      </span>
                    </td>
                    <td style={s.td}>
                      <span style={s.passBadge(rB?.pass ?? null)}>
                        {rB?.pass === true
                          ? "pass"
                          : rB?.pass === false
                          ? "fail"
                          : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
