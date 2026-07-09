/* ConfigureRunPage — multi-agent review configuration UI.
   Step 1: PR selector (workspace-wide, all repos).
   Step 2: Agent panel (per-agent card with estimates, checkboxes).
   Summary line + launch button. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueries } from "@tanstack/react-query";
import { Button } from "@devdigest/ui";
import { api } from "@/services/api";
import { useRepos } from "@/lib/hooks/core";
import { useAgents } from "@/lib/hooks/agents";
import { useRunMultiAgentReview } from "@/lib/hooks/reviews";
import { AppShell } from "@/components/app-shell";
import type { PrMeta, Repo } from "@devdigest/shared";
import { AgentEstimateCard } from "../AgentEstimateCard/AgentEstimateCard";

// ---- PR label builder ----
function prLabel(pr: PrMeta): string {
  return `#${pr.number} ${pr.title}`;
}

// ---- Summary computation ----
interface SummaryValues {
  durationLabel: string;
  costLabel: string;
}

function computeSummary(
  checkedIds: string[],
  agents: ReturnType<typeof useAgents>["data"],
  t: ReturnType<typeof useTranslations>,
): SummaryValues {
  if (checkedIds.length === 0 || !agents) {
    return {
      durationLabel: t("summary.timeUnknown"),
      costLabel: t("summary.costUnknown"),
    };
  }

  const selected = agents.filter((a) => checkedIds.includes(a.id));
  const anyNullDuration = selected.some((a) => a.estimate?.duration_avg_ms == null);
  const anyNullCost = selected.some((a) => a.estimate?.cost_avg_usd == null);

  let durationLabel: string;
  if (anyNullDuration) {
    durationLabel = t("summary.timeUnknown");
  } else {
    const maxMs = Math.max(...selected.map((a) => a.estimate!.duration_avg_ms!));
    durationLabel = t("summary.timeValue", { s: Math.round(maxMs / 1000) });
  }

  let costLabel: string;
  if (anyNullCost) {
    costLabel = t("summary.costUnknown");
  } else {
    const totalCost = selected.reduce((sum, a) => sum + a.estimate!.cost_avg_usd!, 0);
    costLabel = t("summary.costValue", { cost: totalCost.toFixed(2) });
  }

  return { durationLabel, costLabel };
}

export function ConfigureRunPage() {
  const t = useTranslations("multiAgentReview");
  const router = useRouter();
  const run = useRunMultiAgentReview();

  // ---- Load repos ----
  const { data: repos = [] } = useRepos();

  // ---- Load pulls for all repos (workspace-wide) ----
  const pullsQueries = useQueries({
    queries: repos.map((repo: Repo) => ({
      queryKey: ["pulls", repo.id],
      queryFn: () => api.get<PrMeta[]>(`/repos/${repo.id}/pulls`),
      enabled: !!repo.id,
    })),
  });

  const allPulls: PrMeta[] = pullsQueries.flatMap((q) => q.data ?? []);
  const pullsLoading = pullsQueries.some((q) => q.isLoading);

  // ---- Load agents ----
  const { data: agents } = useAgents();
  const enabledAgents = React.useMemo(() => (agents ?? []).filter((a) => a.enabled), [agents]);

  // ---- PR selection state ----
  const [selectedPrId, setSelectedPrId] = React.useState<string>("");

  // ---- Agent checkbox state — pre-check all enabled agents ----
  const [checked, setChecked] = React.useState<Set<string>>(() => new Set(enabledAgents.map((a) => a.id)));

  // When agent list loads, re-init checked to all enabled.
  React.useEffect(() => {
    setChecked(new Set(enabledAgents.map((a) => a.id)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledAgents.map((a) => a.id).join(",")]);

  const toggleAgent = React.useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ---- Summary ----
  const checkedIds = [...checked];
  const { durationLabel, costLabel } = computeSummary(checkedIds, agents, t);

  // ---- Launch ----
  const prSelected = !!selectedPrId;
  const canLaunch = prSelected && checkedIds.length > 0 && !run.isPending;

  const handleLaunch = async () => {
    if (!canLaunch) return;
    const res = await run.mutateAsync({ prId: selectedPrId, agentIds: checkedIds });
    const runIds = res.runs.map((r) => r.run_id).join(",");
    router.push(`/multi-agent-review/results?pr=${selectedPrId}&runs=${runIds}`);
  };

  // ---- PR selector options ----
  const prOptions = allPulls
    .filter((pr) => pr.id != null)
    .map((pr) => ({ value: pr.id as string, label: prLabel(pr) }));

  const noPrs = !pullsLoading && prOptions.length === 0;

  return (
    <AppShell crumb={[{ label: t("page.breadcrumb") }]}>
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        {/* Page header */}
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            {t("page.title")}
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0 }}>
            {t("page.subtitle")}
          </p>
        </div>

        {/* Step 1 — PR selector */}
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label
            htmlFor="pr-select"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}
          >
            {t("prSelector.label")}
          </label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 7,
              border: "1px solid var(--border-strong)",
              background: noPrs ? "var(--bg)" : "var(--bg-elevated)",
              opacity: noPrs ? 0.6 : 1,
            }}
          >
            <select
              id="pr-select"
              disabled={noPrs}
              value={selectedPrId}
              onChange={(e) => setSelectedPrId(e.target.value)}
              aria-label={t("prSelector.label")}
              style={{
                flex: 1,
                fontSize: 14,
                color: selectedPrId ? "var(--text-primary)" : "var(--text-muted)",
                background: "transparent",
                border: "none",
                outline: "none",
                appearance: "none",
                cursor: noPrs ? "not-allowed" : "pointer",
              }}
            >
              <option value="" disabled>
                {pullsLoading
                  ? t("prSelector.loading")
                  : noPrs
                    ? t("prSelector.noPrs")
                    : t("prSelector.placeholder")}
              </option>
              {prOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Step 2 — Agent panel */}
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {t("agentPanel.title")}
          </div>

          {!prSelected ? (
            <div
              style={{
                padding: "24px 16px",
                borderRadius: 8,
                border: "1px dashed var(--border)",
                color: "var(--text-muted)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              {t("agentPanel.selectPrFirst")}
            </div>
          ) : enabledAgents.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                padding: "40px 24px",
                gap: 8,
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                {t("agentPanel.noAgentsTitle")}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 320, lineHeight: 1.5 }}>
                {t("agentPanel.noAgentsBody")}
              </div>
              <button
                type="button"
                onClick={() => router.push("/agents")}
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  color: "var(--accent-text)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {t("agentPanel.goToAgents")}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {enabledAgents.map((agent) => (
                <AgentEstimateCard
                  key={agent.id}
                  agent={agent}
                  checked={checked.has(agent.id)}
                  onToggle={toggleAgent}
                />
              ))}
            </div>
          )}
        </section>

        {/* Summary line */}
        {prSelected && enabledAgents.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 20,
              fontSize: 13,
              color: "var(--text-secondary)",
              padding: "10px 14px",
              borderRadius: 7,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
            }}
          >
            <span>
              {t("summary.time", { value: durationLabel })}
            </span>
            <span>
              {t("summary.cost", { value: costLabel })}
            </span>
          </div>
        )}

        {/* Launch button */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            kind="primary"
            size="md"
            icon="Sparkles"
            disabled={!canLaunch}
            loading={run.isPending}
            onClick={handleLaunch}
          >
            {run.isPending
              ? t("launch.loading")
              : t("launch.button", { count: checkedIds.length })}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
