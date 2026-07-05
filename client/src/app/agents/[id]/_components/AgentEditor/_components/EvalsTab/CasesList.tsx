/* CasesList — table of eval cases with per-case pass/fail status derived
   from the latest done batch's runs. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import type { Agent, EvalBatchDetail } from "@devdigest/shared";
import { useEvalCases, useDeleteEvalCase, useRunEvalCase } from "@/lib/hooks/evals";
import { s } from "./styles";

// ---------------------------------------------------------------------------
// Helpers (module-level, pure — not recreated on every render)
// ---------------------------------------------------------------------------

function getExpectationType(expected: unknown): string | null {
  if (expected !== null && typeof expected === "object" && "type" in expected) {
    const t = (expected as Record<string, unknown>).type;
    return typeof t === "string" ? t : null;
  }
  return null;
}

function getFileRange(expected: unknown): string | null {
  if (expected !== null && typeof expected === "object") {
    const o = expected as Record<string, unknown>;
    if (typeof o.file === "string" && typeof o.start_line === "number") {
      const end = typeof o.end_line === "number" ? o.end_line : o.start_line;
      return `${o.file}:${o.start_line}–${end}`;
    }
  }
  return null;
}

function getLastRunPass(
  caseId: string,
  latestDone: EvalBatchDetail | undefined,
): boolean | null {
  if (!latestDone) return null;
  const run = latestDone.runs.find((r) => r.case_id === caseId);
  return run ? (run.pass ?? null) : null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CasesList({
  agent,
  latestDoneBatchDetail,
}: {
  agent: Agent;
  latestDoneBatchDetail: EvalBatchDetail | undefined;
}) {
  const t = useTranslations("eval");
  const {
    data: cases,
    isLoading,
    isError,
    refetch,
  } = useEvalCases(agent.id);
  const deleteCase = useDeleteEvalCase();
  const runCase = useRunEvalCase();

  if (isLoading) {
    return <Skeleton height={120} />;
  }
  if (isError) {
    return (
      <ErrorState
        body={t("evalsTab.loadingCases")}
        onRetry={() => { void refetch(); }}
      />
    );
  }
  if (!cases || cases.length === 0) {
    return (
      <div style={s.emptyState} data-testid="cases-empty">
        {t("evalsTab.emptyCases")}
      </div>
    );
  }

  return (
    <div>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Name</th>
            <th style={s.th}>Type</th>
            <th style={s.th}>File</th>
            <th style={s.th}>Status</th>
            <th style={s.th} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const expectType = getExpectationType(c.expected_output);
            const fileRange = getFileRange(c.expected_output);
            const pass = getLastRunPass(c.id, latestDoneBatchDetail);
            return (
              <tr key={c.id} data-testid={`case-row-${c.id}`}>
                <td style={s.td}>{c.name}</td>
                <td style={s.td}>
                  {expectType ? (
                    <span style={s.typeChip(expectType)} data-testid="type-chip">
                      {expectType}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  )}
                </td>
                <td style={s.td}>
                  <span style={s.monoCell}>{fileRange ?? "—"}</span>
                </td>
                <td style={s.td}>
                  <span
                    style={s.passBadge(pass)}
                    data-testid={`case-status-${c.id}`}
                  >
                    {pass === null
                      ? t("evalsTab.neverRun")
                      : pass
                      ? t("evalsTab.passed")
                      : t("evalsTab.failed")}
                  </span>
                </td>
                <td style={s.td}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button
                      style={s.actionBtn}
                      onClick={() => runCase.mutate(c.id)}
                      aria-label={`${t("evalsTab.run")} ${c.name}`}
                    >
                      {t("evalsTab.run")}
                    </button>
                    <a
                      href={`/agents/${agent.id}/eval-cases/${c.id}`}
                      style={s.actionBtn}
                      aria-label={`${t("evalsTab.edit")} ${c.name}`}
                    >
                      {t("evalsTab.edit")}
                    </a>
                    <button
                      style={s.deleteBtn}
                      onClick={() =>
                        deleteCase.mutate({ id: c.id, owner_id: agent.id })
                      }
                      aria-label={`${t("evalsTab.delete")} ${c.name}`}
                    >
                      {t("evalsTab.delete")}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 12 }}>
        <a
          href={`/agents/${agent.id}/eval-cases/new`}
          style={{ fontSize: 13, color: "var(--accent)" }}
        >
          + {t("evalsTab.newCase")}
        </a>
      </div>
    </div>
  );
}
