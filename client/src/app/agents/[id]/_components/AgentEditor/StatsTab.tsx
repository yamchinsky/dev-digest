/* StatsTab — this agent's slice of the Agent Performance dashboard.
 *
 * This is the reconciliation surface: GET /agents/:id/stats shares the same
 * server aggregation as GET /agents/performance, so every number here MUST
 * equal the dashboard row for this agent — it just renders AgentStats
 * faithfully, no client-side recomputation that could let the two drift.
 */
"use client";

import { useTranslations } from "next-intl";
import { Icon, Skeleton, ErrorState, SeverityBadge, Sparkline } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentStats } from "@/lib/hooks/performance";
import { ApiError } from "@/services/api";

function fmtUsd(v: number | null | undefined): string {
  return v == null ? "—" : `$${v.toFixed(2)}`;
}

function fmtPercent(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

function fmtDurationS(ms: number | null | undefined): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

export function StatsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data, isLoading, isError, error, refetch } = useAgentStats(agent.id);

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton height={200} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorState
          body={error instanceof ApiError ? error.message : t("stats.loadError")}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (data.runs === 0) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center" }} data-testid="stats-empty-state">
        <Icon.Activity size={32} style={{ color: "var(--text-muted)", marginBottom: 12 }} aria-hidden />
        <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{t("stats.empty.title")}</p>
        <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 360, margin: "0 auto" }}>
          {t("stats.empty.body")}
        </p>
      </div>
    );
  }

  const cards: { label: string; value: string }[] = [
    { label: t("stats.runs"), value: String(data.runs) },
    { label: t("stats.findingsTotal"), value: String(data.findings_total) },
    { label: t("stats.accepted"), value: String(data.accepted) },
    { label: t("stats.dismissed"), value: String(data.dismissed) },
    { label: t("stats.pending"), value: String(data.pending) },
    { label: t("stats.acceptRate"), value: fmtPercent(data.accept_rate) },
    { label: t("stats.avgCost"), value: fmtUsd(data.avg_cost_usd) },
    { label: t("stats.avgDuration"), value: fmtDurationS(data.avg_latency_ms) },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Metric grid — same fields as the AgentPerfRow, rendered from AgentStats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 9,
              padding: 14,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
              {c.label.toUpperCase()}
            </div>
            <div className="tnum" style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Findings by severity */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{t("stats.findingsBySeverity")}</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <SeverityBadge severity="CRITICAL" count={data.findings_by_severity.CRITICAL} />
          <SeverityBadge severity="WARNING" count={data.findings_by_severity.WARNING} />
          <SeverityBadge severity="SUGGESTION" count={data.findings_by_severity.SUGGESTION} />
        </div>
      </div>

      {/* Trend */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{t("stats.trend")}</div>
        {data.trend.length > 0 ? (
          <Sparkline data={data.trend.map((p) => p.value)} w={200} h={40} />
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>
        )}
      </div>
    </div>
  );
}
