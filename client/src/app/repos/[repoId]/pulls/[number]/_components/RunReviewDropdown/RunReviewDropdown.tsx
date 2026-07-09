/* RunReviewDropdown — multi-agent picker popover.
   Replaces the old single-agent dropdown. Shows a checkbox per enabled agent
   with pre-run estimates (~Xs / ~$X.XX or ~? / ~$?). On launch, POSTs
   agentIds to /pulls/:id/review and navigates to the results URL. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useRunMultiAgentReview } from "@/lib/hooks/reviews";

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  /** Fired when runs are successfully started (no run ids; parent invalidates). */
  onRunsStarted?: () => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const run = useRunMultiAgentReview();

  const [open, setOpen] = React.useState(false);
  const popoverRef = React.useRef<HTMLDivElement>(null);

  // Pre-select all enabled agents by default.
  const enabledAgents = React.useMemo(() => (agents ?? []).filter((a) => a.enabled), [agents]);
  const [checked, setChecked] = React.useState<Set<string>>(() => new Set(enabledAgents.map((a) => a.id)));

  // When the agent list loads / changes, re-initialize checked to all enabled.
  React.useEffect(() => {
    setChecked(new Set(enabledAgents.map((a) => a.id)));
  }, [enabledAgents.map((a) => a.id).join(",")]);

  // Close on outside click.
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const checkedIds = [...checked];
  const canRun = checkedIds.length > 0 && !run.isPending;

  const kick = async () => {
    if (!canRun) return;
    onRunStart?.();
    try {
      const res = await run.mutateAsync({ prId, agentIds: checkedIds });
      onRunsStarted?.();
      const runIds = res.runs.map((r) => r.run_id).join(",");
      router.push(`/multi-agent-review/results?pr=${prId}&runs=${runIds}`);
    } finally {
      onRunSettled?.();
      setOpen(false);
    }
  };

  const formatDuration = (ms: number | null | undefined): string => {
    if (ms == null) return t("picker.estimateUnknown");
    return t("picker.estimateDuration", { s: (ms / 1000).toFixed(0) });
  };

  const formatCost = (usd: number | null | undefined): string => {
    if (usd == null) return t("picker.estimateCostUnknown");
    return t("picker.estimateCost", { cost: usd.toFixed(2) });
  };

  const triggerBtn = (
    <span
      title={warnMerged ? t("runReview.mergedTooltip") : undefined}
      style={warnMerged ? { opacity: 0.6 } : undefined}
    >
      <Button
        kind={kind}
        size={size}
        iconRight="ChevronDown"
        icon="Sparkles"
        loading={run.isPending}
        onClick={() => setOpen((o) => !o)}
      >
        {run.isPending ? t("picker.runButtonLoading") : t("runReview.runReview")}
      </Button>
    </span>
  );

  return (
    <div ref={popoverRef} style={{ position: "relative", display: "inline-block" }}>
      {triggerBtn}

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 300,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 9,
            boxShadow: "var(--shadow-modal)",
            zIndex: 40,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "10px 14px",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-muted)",
              borderBottom: "1px solid var(--border)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {t("picker.title")}
          </div>

          {/* Agent list */}
          {enabledAgents.length === 0 ? (
            <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>
                {t("picker.emptyTitle")}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("picker.emptyBody")}</div>
              <button
                type="button"
                onClick={() => { setOpen(false); router.push("/agents"); }}
                style={{
                  fontSize: 12,
                  color: "var(--accent-text)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  textAlign: "left",
                }}
              >
                {t("picker.goToAgents")}
              </button>
            </div>
          ) : (
            <div style={{ padding: "8px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
              {enabledAgents.map((agent) => (
                <label
                  key={agent.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  <Checkbox
                    checked={checked.has(agent.id)}
                    onChange={() => toggle(agent.id)}
                  />
                  <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>
                    {agent.name}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 6 }}>
                    <span>{formatDuration(agent.estimate?.duration_avg_ms)}</span>
                    <span>{formatCost(agent.estimate?.cost_avg_usd)}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* Footer run button */}
          <div
            style={{
              padding: "8px 10px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <Button
              kind="primary"
              size="sm"
              icon="Sparkles"
              disabled={!canRun}
              loading={run.isPending}
              onClick={kick}
            >
              {run.isPending
                ? t("picker.runButtonLoading")
                : t("picker.runButton", { count: checkedIds.length })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
