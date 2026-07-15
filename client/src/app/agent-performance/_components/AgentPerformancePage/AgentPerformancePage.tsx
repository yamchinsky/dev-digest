/* AgentPerformancePage — cross-agent leaderboard dashboard (self-mounts
   <AppShell>, mirrors CiRunsPage's shape: header + period selector + table). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, MetricCard, Skeleton, ErrorState, SelectInput, TextInput } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgentPerformance } from "@/lib/hooks/performance";
import { ApiError } from "@/services/api";
import { PerfTable } from "./_components/PerfTable";
import { CostBreakdown } from "./_components/CostBreakdown";
import type { Period } from "./constants";
import { formatUsd, periodLabel, resolveRange } from "./helpers";

export function AgentPerformancePage() {
  const t = useTranslations("agentPerformance");

  // ── Period selector state ───────────────────────────────────────────────
  const [period, setPeriod] = React.useState<Period>("30d");
  const [customSince, setCustomSince] = React.useState("");
  const [customUntil, setCustomUntil] = React.useState("");

  const range = React.useMemo(
    () => resolveRange(period, customSince, customUntil),
    [period, customSince, customUntil],
  );

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: perf, isLoading, isError, error, refetch } = useAgentPerformance(range);

  const crumb = [{ label: t("title"), href: "/agent-performance" }];

  const periodOptions: { value: string; label: string }[] = [
    { value: "30d", label: t("period.d30") },
    { value: "1d", label: t("period.d1") },
    { value: "custom", label: t("period.custom") },
  ];

  const suffix = `(${periodLabel(period)})`;
  const mostActiveRow = perf?.agents.find((a) => a.agent_name === perf.summary.most_active_agent);
  const mostActiveAcceptStr =
    mostActiveRow?.accept_rate != null ? `${Math.round(mostActiveRow.accept_rate * 100)}%` : "—";

  const noData = !!perf && perf.agents.length === 0;
  const allZero = !!perf && perf.agents.length > 0 && perf.summary.runs === 0;
  const isEmpty = noData || allZero;

  return (
    <AppShell crumb={crumb}>
      {/* ── Header ── */}
      <div
        style={{
          padding: "20px 28px 0",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <Icon.Activity size={18} style={{ color: "var(--accent)" }} aria-hidden />
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t("title")}</h1>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("subtitle")}</p>
        </div>

        {/* Period selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <SelectInput value={period} onChange={(v) => setPeriod(v as Period)} options={periodOptions} mono={false} />
          {period === "custom" && (
            <>
              <TextInput
                type="date"
                value={customSince}
                onChange={setCustomSince}
                aria-label={t("period.since")}
              />
              <TextInput
                type="date"
                value={customUntil}
                onChange={setCustomUntil}
                aria-label={t("period.until")}
              />
            </>
          )}
        </div>
      </div>

      <div style={{ padding: "0 28px 44px", display: "flex", flexDirection: "column", gap: 28 }}>
        {isLoading ? (
          <>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <Skeleton height={100} />
              </div>
              <div style={{ flex: 1 }}>
                <Skeleton height={100} />
              </div>
              <div style={{ flex: 1 }}>
                <Skeleton height={100} />
              </div>
              <div style={{ flex: 1 }}>
                <Skeleton height={100} />
              </div>
            </div>
            <Skeleton height={240} />
          </>
        ) : isError ? (
          <ErrorState
            title={t("loadError")}
            body={error instanceof ApiError ? error.message : t("loadError")}
            onRetry={() => refetch()}
          />
        ) : !perf || isEmpty ? (
          <div
            style={{
              padding: "48px 20px",
              textAlign: "center",
              border: "1px dashed var(--border)",
              borderRadius: 8,
            }}
            data-testid="empty-state"
          >
            <Icon.Activity size={32} style={{ color: "var(--text-muted)", marginBottom: 12 }} aria-hidden />
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{t("empty.title")}</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 360, margin: "0 auto" }}>
              {t("empty.body")}
            </p>
          </div>
        ) : (
          <>
            {/* ── Summary cards ── */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <MetricCard label={`${t("summary.totalRuns").toUpperCase()} ${suffix}`} value={perf.summary.runs} />
              <MetricCard
                label={`${t("summary.totalCost").toUpperCase()} ${suffix}`}
                value={formatUsd(perf.summary.total_cost_usd)}
              />
              <MetricCard
                label={`${t("summary.avgAcceptRate").toUpperCase()} ${suffix}`}
                value={
                  perf.summary.avg_accept_rate != null ? `${Math.round(perf.summary.avg_accept_rate * 100)}%` : "—"
                }
              />
              <div
                style={{
                  flex: 1,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 9,
                  padding: 18,
                  minWidth: 200,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
                  {t("summary.mostActive").toUpperCase()} {suffix}
                </div>
                {mostActiveRow ? (
                  <>
                    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 10, letterSpacing: "-0.02em" }}>
                      {mostActiveRow.agent_name}
                    </div>
                    <div className="tnum" style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                      {t("summary.mostActiveDetail", { runs: mostActiveRow.runs, rate: mostActiveAcceptStr })}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 10, color: "var(--text-muted)" }}>
                    {t("summary.noRuns")}
                  </div>
                )}
              </div>
            </div>

            {/* ── Table ── */}
            <PerfTable rows={perf.agents} />

            {/* ── Cost breakdown ── */}
            <CostBreakdown costByAgent={perf.cost_by_agent} costByModel={perf.cost_by_model} agents={perf.agents} />
          </>
        )}
      </div>
    </AppShell>
  );
}
