/* EvalDashboard — standalone dashboard page for the eval pipeline.
 *
 * Sections (top to bottom):
 *  1. Header: agent name, model chip, cases/runs subtitle.
 *  2. Agent selector + "Run eval" button (top-right toolbar).
 *  3. Precision-dip alert banner (conditional).
 *  4. Three MetricCards (recall / precision / citation).
 *  5. TrendChart (≥1 done batch).
 *  6. RunHistory table with compare checkboxes.
 *  7. CompareView (exactly 2 runs selected).
 */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, SelectInput, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import {
  useEvalBatches,
  useEvalCases,
  useStartEvalBatch,
} from "@/lib/hooks/evals";
import { MetricCardsRow } from "@/components/evals/MetricCardsRow";
import { TrendChart } from "@/components/evals/TrendChart";
import { RunHistory } from "@/components/evals/RunHistory";
import { CompareView } from "@/components/evals/CompareView";
import { PrecisionDipAlert } from "@/components/evals/PrecisionDipAlert";

export function EvalDashboard() {
  const t = useTranslations("eval");

  // ── Agent selection ────────────────────────────────────────────────────
  const { data: agents, isLoading: loadingAgents } = useAgents();

  // Explicit selection; undefined means "use the default".
  const [selectedAgentId, setSelectedAgentId] = React.useState<
    string | undefined
  >(undefined);

  // Derive the effective agent: explicit pick → first agent → empty fallback.
  const effectiveAgentId =
    selectedAgentId ?? agents?.[0]?.id ?? "";
  const selectedAgent = agents?.find((a) => a.id === effectiveAgentId);

  // ── Eval data ──────────────────────────────────────────────────────────
  const { data: batches, isLoading: loadingBatches } =
    useEvalBatches(effectiveAgentId);
  const { data: cases } = useEvalCases(effectiveAgentId);

  const startBatch = useStartEvalBatch(effectiveAgentId);

  // ── Compare state ──────────────────────────────────────────────────────
  const [compareIds, setCompareIds] = React.useState<string[]>([]);

  // ── Derived values ─────────────────────────────────────────────────────
  const doneBatches = (batches ?? []).filter((b) => b.status === "done");
  const latestDone = doneBatches[0];
  const prevDone = doneBatches[1];
  const isRunning =
    startBatch.isPending ||
    (batches ?? []).some((b) => b.status === "running");
  const casesCount = cases?.length ?? 0;
  const hasRuns = batches !== undefined && batches.length > 0;

  // ── Helpers ────────────────────────────────────────────────────────────
  function handleToggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev; // max 2
      return [...prev, id];
    });
  }

  // ── Layout config ──────────────────────────────────────────────────────
  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval-dashboard" },
    { label: selectedAgent?.name ?? "…" },
  ];

  const agentOptions = (agents ?? []).map((a) => ({
    value: a.id,
    label: a.name,
  }));

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <AppShell crumb={crumb}>
      {/* ── Header row ── */}
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
        {/* Left: title + subtitle */}
        <div>
          {loadingAgents ? (
            <>
              <Skeleton height={24} width={200} />
              <Skeleton height={16} width={280} style={{ marginTop: 8 }} />
            </>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 4,
                }}
              >
                <Icon.Gauge
                  size={18}
                  style={{ color: "var(--accent)" }}
                  aria-hidden
                />
                <h1 style={{ fontSize: 20, fontWeight: 700 }}>
                  {selectedAgent?.name ?? t("dashboard.defaultTitle")}
                </h1>
                {selectedAgent && (
                  <Badge color="var(--text-secondary)" mono>
                    {selectedAgent.provider}/{selectedAgent.model}
                  </Badge>
                )}
              </div>
              <p
                style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}
                data-testid="cases-summary"
              >
                {t("dashboard.casesSummary", {
                  count: casesCount,
                  runs: doneBatches.length,
                })}
              </p>
            </>
          )}
        </div>

        {/* Right: agent selector + run button */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {agentOptions.length > 1 && (
            <SelectInput
              value={effectiveAgentId}
              onChange={setSelectedAgentId}
              options={agentOptions}
              mono={false}
            />
          )}
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={!effectiveAgentId || isRunning}
            loading={isRunning}
            onClick={() => startBatch.mutate({})}
            data-testid="run-eval-btn"
          >
            {isRunning
              ? t("dashboard.running")
              : t("dashboard.runEval", { count: casesCount })}
          </Button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ padding: "0 28px 44px" }}>
        {/* Alert banner */}
        <PrecisionDipAlert doneBatches={doneBatches} />

        {/* Metric cards */}
        <MetricCardsRow latestDone={latestDone} prevDone={prevDone} />

        {/* Trend chart — only when ≥1 done batch */}
        {!loadingBatches && <TrendChart doneBatches={doneBatches} />}

        {/* Recent runs */}
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-secondary)",
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {t("dashboard.recentRuns")}
          </div>

          {loadingBatches ? (
            <Skeleton height={80} />
          ) : !hasRuns ? (
            <div
              style={{
                padding: "32px 20px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--text-muted)",
                border: "1px dashed var(--border)",
                borderRadius: 8,
              }}
              data-testid="no-runs"
            >
              {t("dashboard.noRuns")}
            </div>
          ) : (
            <RunHistory
              batches={batches ?? []}
              compareIds={compareIds}
              onToggleCompare={handleToggleCompare}
            />
          )}
        </div>

        {/* Compare panel — appears when exactly 2 runs are selected */}
        {compareIds.length === 2 && (
          <CompareView
            ids={[compareIds[0]!, compareIds[1]!]}
            onClose={() => setCompareIds([])}
          />
        )}
      </div>
    </AppShell>
  );
}
