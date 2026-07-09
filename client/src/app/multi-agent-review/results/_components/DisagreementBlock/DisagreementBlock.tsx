"use client";

/**
 * DisagreementBlock — "Where agents disagree" section below the Columns/Tabs view.
 * Groups findings by location across agents; shows "did not flag" cells;
 * "Show only conflicts" toggle hides uniform groups.
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, SeverityBadge, Toggle } from "@devdigest/ui";
import type { RunSummary } from "@devdigest/shared";
import type { GroupedLocation, FlaggedCell, Cell } from "../../_lib/groupFindingsByLocation";

export interface DisagreementBlockProps {
  groups: GroupedLocation[];
  runSummaries: RunSummary[];
  /** runId set that is active in the URL */
  runIds: string[];
}

function isFlagged(cell: FlaggedCell | "did-not-flag"): cell is FlaggedCell {
  return cell !== "did-not-flag";
}

export function DisagreementBlock({ groups, runSummaries, runIds }: DisagreementBlockProps) {
  const t = useTranslations("multiAgentReviewResults");
  const [showOnlyConflicts, setShowOnlyConflicts] = React.useState(false);

  // Single-agent edge case
  if (runIds.length <= 1) {
    return (
      <section aria-label={t("disagreement.title")} style={sectionWrap}>
        <div style={sectionHeader}>
          <span style={sectionTitle}>{t("disagreement.title")}</span>
        </div>
        <div style={emptyNote}>{t("disagreement.singleAgent")}</div>
      </section>
    );
  }

  // Zero groups — all agree
  if (groups.length === 0) {
    return (
      <section aria-label={t("disagreement.title")} style={sectionWrap}>
        <div style={sectionHeader}>
          <span style={sectionTitle}>{t("disagreement.title")}</span>
        </div>
        <div style={emptyNote}>{t("disagreement.empty")}</div>
      </section>
    );
  }

  const displayed = showOnlyConflicts ? groups.filter((g) => g.isConflict) : groups;

  // Build runId → agent name lookup
  const agentName = (runId: string): string =>
    runSummaries.find((r) => r.run_id === runId)?.agent_name ?? runId.slice(0, 8);

  return (
    <section aria-label={t("disagreement.title")} style={sectionWrap}>
      <div style={sectionHeader}>
        <span style={sectionTitle}>{t("disagreement.title")}</span>
        <label style={toggleRow}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {t("disagreement.showOnlyConflicts")}
          </span>
          <Toggle
            on={showOnlyConflicts}
            onChange={setShowOnlyConflicts}
          />
        </label>
      </div>

      {displayed.length === 0 ? (
        <div style={emptyNote}>{t("disagreement.emptyConflicts")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {displayed.map((group) => {
            const key = `${group.file}:${group.startLine}-${group.endLine}`;
            return (
              <div key={key} style={{ ...groupRow, borderColor: group.isConflict ? "var(--warning)" : "var(--border)" }}>
                {/* Location header */}
                <div style={groupLocLine}>
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
                    {group.file}:{group.startLine}
                    {group.endLine !== group.startLine && `–${group.endLine}`}
                  </span>
                  {group.isConflict && (
                    <Badge color="var(--warning)" bg="var(--warning-bg)" dot>
                      conflict
                    </Badge>
                  )}
                </div>

                {/* Agent cells */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                  {runIds.map((runId) => {
                    const cell: Cell | undefined = group.cells[runId];
                    return (
                      <div key={runId} style={cellRow}>
                        <span style={agentLabel}>{agentName(runId)}</span>
                        {cell !== undefined && isFlagged(cell) ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <SeverityBadge severity={cell.severity as "CRITICAL" | "WARNING" | "SUGGESTION"} compact />
                            <span style={{ fontSize: 12, color: "var(--text-primary)" }}>{cell.title}</span>
                          </span>
                        ) : (
                          <span style={didNotFlagTag}>{t("disagreement.didNotFlag")}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ----- Styles -----
const sectionWrap: React.CSSProperties = {
  marginTop: 24,
  borderTop: "1px solid var(--border)",
  paddingTop: 16,
};

const sectionHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
  flexWrap: "wrap",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-primary)",
};

const toggleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  cursor: "pointer",
};

const emptyNote: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-muted)",
  padding: "12px 0",
};

const groupRow: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "10px 12px",
  background: "var(--bg-card)",
};

const groupLocLine: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "var(--text-muted)",
};

const cellRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  paddingLeft: 4,
  flexWrap: "wrap",
};

const agentLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  minWidth: 100,
  flexShrink: 0,
};

const didNotFlagTag: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  fontStyle: "italic",
};
