"use client";

/**
 * AgentTab — one tab panel in the Tabs view of the Results page.
 * Shows summary banner (score, summary, View trace, duration, cost)
 * and expandable finding cards with all action buttons.
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, CategoryTag, SeverityBadge } from "@devdigest/ui";
import type { RunSummary, FindingRecord, FindingActionKind } from "@devdigest/shared";
import { useFindingAction } from "@/lib/hooks/reviews";

export interface AgentTabProps {
  runSummary: RunSummary | null | undefined;
  findings: FindingRecord[];
  liveStatus: string | null;
  prId: string;
  onViewTrace: () => void;
  /** One-line summary text from ReviewRecord.summary. LLM-generated; rendered as a text node. */
  summary?: string | null;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "n/a";
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "n/a";
  return `$${usd.toFixed(4)}`;
}

function FindingExpanded({
  finding,
  prId,
}: {
  finding: FindingRecord;
  prId: string;
}) {
  const t = useTranslations("multiAgentReviewResults");
  const findingAction = useFindingAction();
  const [localState, setLocalState] = React.useState<"accepted" | "dismissed" | null>(() => {
    if (finding.accepted_at) return "accepted";
    if (finding.dismissed_at) return "dismissed";
    return null;
  });

  const handleAction = (action: FindingActionKind) => {
    findingAction.mutate(
      { findingId: finding.id, action, prId },
      {
        onSuccess: () => {
          if (action === "accept") setLocalState("accepted");
          else if (action === "dismiss") setLocalState("dismissed");
        },
      },
    );
  };

  const confidencePct = Math.round(finding.confidence * 100);

  return (
    <div style={expandedBody}>
      {/* Category + file:line */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <CategoryTag category={finding.category} />
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)" }}>
          {finding.file}:{finding.start_line}
        </span>
        <Badge color="var(--text-secondary)" bg="var(--bg-elevated)">
          {t("finding.confidence", { pct: confidencePct })}
        </Badge>
      </div>

      {/* Rationale — LLM text rendered as JSX text node, never dangerouslySetInnerHTML */}
      <div style={{ marginTop: 8 }}>
        <div style={sectionLabel}>{t("finding.rationale")}</div>
        <div style={textBlock}>{finding.rationale}</div>
      </div>

      {/* Suggested fix */}
      {finding.suggestion && (
        <div style={{ marginTop: 8 }}>
          <div style={sectionLabel}>{t("finding.suggestion")}</div>
          <div style={textBlock}>{finding.suggestion}</div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        <Button
          kind={localState === "accepted" ? "primary" : "secondary"}
          size="sm"
          icon="Check"
          onClick={() => handleAction("accept")}
          disabled={localState !== null || findingAction.isPending}
        >
          {localState === "accepted" ? t("finding.accepted") : t("finding.accept")}
        </Button>
        <Button
          kind={localState === "dismissed" ? "danger" : "secondary"}
          size="sm"
          icon="X"
          onClick={() => handleAction("dismiss")}
          disabled={localState !== null || findingAction.isPending}
        >
          {localState === "dismissed" ? t("finding.dismissed") : t("finding.dismiss")}
        </Button>
        {/* Learn — stub for Memory homework */}
        <button
          disabled
          title={t("finding.learnTooltip")}
          style={stubBtn}
        >
          {t("finding.learn")}
        </button>
        {/* Turn into eval case — stub for L06 evals */}
        <button
          disabled
          title={t("finding.toEvalCaseTooltip")}
          style={stubBtn}
        >
          {t("finding.toEvalCase")}
        </button>
      </div>
    </div>
  );
}

function FindingRow({
  finding,
  prId,
}: {
  finding: FindingRecord;
  prId: string;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div style={findingRow}>
      <button
        style={findingRowHeader}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <SeverityBadge severity={finding.severity} compact />
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", flex: 1, textAlign: "left" }}>
          {finding.title}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)" }}>
          {finding.file}:{finding.start_line}
        </span>
      </button>
      {expanded && <FindingExpanded finding={finding} prId={prId} />}
    </div>
  );
}

export function AgentTab({
  runSummary,
  findings,
  liveStatus,
  prId,
  onViewTrace,
  summary,
}: AgentTabProps) {
  const t = useTranslations("multiAgentReviewResults");
  const effectiveStatus = liveStatus ?? runSummary?.status ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Summary banner */}
      <div style={summaryBanner}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {runSummary?.score != null && (
            <Badge color="var(--text-primary)" bg="var(--bg-elevated)">
              {t("score")}: {runSummary.score}
            </Badge>
          )}
          {effectiveStatus && (
            <Badge
              color={
                effectiveStatus === "failed"
                  ? "var(--crit)"
                  : effectiveStatus === "done"
                    ? "var(--success)"
                    : "var(--accent)"
              }
              bg={
                effectiveStatus === "failed"
                  ? "var(--crit-bg)"
                  : effectiveStatus === "done"
                    ? "var(--success-bg)"
                    : "var(--accent-bg)"
              }
              dot
            >
              {t(`status.${effectiveStatus}` as "status.running" | "status.done" | "status.failed" | "status.cancelled" | "status.pending")}
            </Badge>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
          {summary ? (
            <span style={{ display: "inline-block" }}>{summary}</span>
          ) : (
            <span>{t("tab.noSummary")}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("tab.duration")}: {formatDuration(runSummary?.duration_ms)}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("tab.cost")}: {formatCost(runSummary?.cost_usd)}
          </span>
          <Button kind="ghost" size="sm" icon="GitPullRequest" onClick={onViewTrace} disabled={!runSummary}>
            {t("viewTrace")}
          </Button>
        </div>
      </div>

      {/* Findings */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {findings.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "16px 0" }}>
            {t("column.noFindings")}
          </div>
        ) : (
          findings.map((f) => <FindingRow key={f.id} finding={f} prId={prId} />)
        )}
      </div>
    </div>
  );
}

// ----- Styles -----
const summaryBanner: React.CSSProperties = {
  padding: "12px 14px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-card)",
};

const findingRow: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 6,
  overflow: "hidden",
  background: "var(--bg-card)",
};

const findingRowHeader: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  flexWrap: "wrap",
};

const expandedBody: React.CSSProperties = {
  padding: "10px 12px 12px",
  borderTop: "1px solid var(--border)",
  background: "var(--bg-elevated)",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  color: "var(--text-muted)",
  letterSpacing: "0.04em",
  marginBottom: 4,
};

const textBlock: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};

const stubBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "not-allowed",
  opacity: 0.6,
};
