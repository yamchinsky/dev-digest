"use client";

/**
 * AgentColumn — one column in the Columns view of the Results page.
 * Shows: agent name, live status badge, score badge, finding cards, "View trace".
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, SeverityBadge } from "@devdigest/ui";
import type { RunSummary, FindingRecord } from "@devdigest/shared";

const statusColor: Record<string, string> = {
  running: "var(--accent)",
  done: "var(--success)",
  failed: "var(--crit)",
  cancelled: "var(--text-muted)",
};

function statusBg(status: string | null): string {
  const colors: Record<string, string> = {
    running: "var(--accent-bg)",
    done: "var(--success-bg)",
    failed: "var(--crit-bg)",
    cancelled: "var(--bg-elevated)",
  };
  return colors[status ?? ""] ?? "var(--bg-elevated)";
}

export interface AgentColumnProps {
  runSummary: RunSummary | null | undefined;
  /** "not-found" if the run_id was in URL but isn't in the workspace run list. */
  notFound?: boolean;
  findings: FindingRecord[];
  liveStatus: string | null;
  onViewTrace: () => void;
}

export function AgentColumn({
  runSummary,
  notFound,
  findings,
  liveStatus,
  onViewTrace,
}: AgentColumnProps) {
  const t = useTranslations("multiAgentReviewResults");

  if (notFound) {
    return (
      <div style={col}>
        <div style={header}>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
            {t("column.notFound")}
          </span>
        </div>
      </div>
    );
  }

  const effectiveStatus = liveStatus ?? runSummary?.status ?? null;
  const isFailed = effectiveStatus === "failed" || effectiveStatus === "cancelled";

  return (
    <div style={col}>
      {/* Column header */}
      <div style={header}>
        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
          {runSummary?.agent_name ?? "Agent"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {effectiveStatus && (
            <Badge
              color={statusColor[effectiveStatus] ?? "var(--text-secondary)"}
              bg={statusBg(effectiveStatus)}
              dot
            >
              {t(`status.${effectiveStatus}` as "status.running" | "status.done" | "status.failed" | "status.cancelled" | "status.pending")}
            </Badge>
          )}
          {runSummary?.score != null && (
            <Badge color="var(--text-primary)" bg="var(--bg-elevated)">
              {runSummary.score}
            </Badge>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={body}>
        {isFailed ? (
          <div style={errorBox}>
            <span style={{ fontWeight: 600, color: "var(--crit)", fontSize: 13 }}>
              {effectiveStatus === "cancelled" ? t("column.cancelled") : t("column.error")}
            </span>
            {runSummary?.error && (
              <span style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4, display: "block" }}>
                {runSummary.error}
              </span>
            )}
          </div>
        ) : findings.length === 0 ? (
          <div style={emptyNote}>{t("column.noFindings")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {findings.map((f) => (
              <div key={f.id} style={findingCard}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <SeverityBadge severity={f.severity} compact />
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      flex: 1,
                    }}
                  >
                    {f.title}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono, monospace)",
                    marginTop: 2,
                    display: "block",
                  }}
                >
                  {t("column.findingAt", { file: f.file, line: f.start_line })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={footer}>
        <Button
          kind="ghost"
          size="sm"
          icon="GitPullRequest"
          onClick={onViewTrace}
          disabled={!runSummary}
        >
          {t("viewTrace")}
        </Button>
      </div>
    </div>
  );
}

// ----- Styles -----
const col: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 260,
  flex: "1 1 260px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  overflow: "hidden",
  background: "var(--bg-card)",
};

const header: React.CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const body: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 14px",
};

const footer: React.CSSProperties = {
  padding: "8px 14px",
  borderTop: "1px solid var(--border)",
};

const findingCard: React.CSSProperties = {
  padding: "8px 10px",
  background: "var(--bg-elevated)",
  borderRadius: 6,
  border: "1px solid var(--border)",
};

const errorBox: React.CSSProperties = {
  padding: "12px",
  background: "var(--crit-bg)",
  border: "1px solid var(--crit)",
  borderRadius: 6,
};

const emptyNote: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: 13,
  textAlign: "center",
  padding: "24px 0",
};
