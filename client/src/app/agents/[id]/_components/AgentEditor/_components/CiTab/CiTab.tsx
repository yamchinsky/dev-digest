/* CiTab.tsx — CI tab in AgentEditor.
 *
 * Sections (top to bottom):
 *  1. ci_fail_on selector — reads agent.ci_fail_on; updates via useUpdateAgent.
 *  2. Installations list — or empty state + "Export to CI" button (a11y: aria-label).
 *  3. CI Runs compact history sub-list.
 *
 * ACs covered:
 *   AC-27  list of installations (date, target badge, PR link)
 *   AC-28  empty state + "Export to CI" button with aria-label + keyboard-operable
 *   AC-29  ci_fail_on selector → useUpdateAgent (existing mutation, NOT duplicated)
 *   AC-30  compact CI run history sub-list
 */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, SelectInput, Skeleton } from "@devdigest/ui";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { useCiInstallations, useCiRuns } from "@/lib/hooks/ci";
import { ExportWizard } from "./ExportWizard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

const TARGET_BADGE_COLOR: Record<string, string> = {
  gha: "var(--accent)",
  circle: "var(--ok)",
  jenkins: "var(--warn)",
  cli: "var(--text-muted)",
};

// ---------------------------------------------------------------------------
// CiTab
// ---------------------------------------------------------------------------

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const tAgents = useTranslations("agents");

  const [showWizard, setShowWizard] = React.useState(false);

  const { data: installations, isLoading: loadingInstalls } =
    useCiInstallations(agent.id);

  // NO refetchInterval — the CI tab does not auto-poll
  const { data: ciRuns, isLoading: loadingRuns } = useCiRuns(
    { agent_id: agent.id },
    {},
  );

  const updateAgent = useUpdateAgent();

  function handleCiFailOnChange(value: string) {
    updateAgent.mutate({
      id: agent.id,
      patch: { ci_fail_on: value as CiFailOn },
    });
  }

  const CI_FAIL_ON_OPTIONS: { value: string; label: string }[] = [
    { value: "never", label: tAgents("config.ciFailOnOptions.never") },
    { value: "critical", label: tAgents("config.ciFailOnOptions.critical") },
    { value: "warning", label: tAgents("config.ciFailOnOptions.warning") },
    { value: "any", label: tAgents("config.ciFailOnOptions.any") },
  ];

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 28 }}>
      {/* 1. CI gate selector */}
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: 6,
          }}
        >
          {tAgents("config.ciFailOn")}
        </div>
        <div style={{ maxWidth: 360 }}>
          <SelectInput
            value={agent.ci_fail_on ?? "critical"}
            onChange={handleCiFailOnChange}
            options={CI_FAIL_ON_OPTIONS}
            mono={false}
          />
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
          {tAgents("config.ciFailOnHint")}
        </div>
      </div>

      {/* 2. Installations */}
      <div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--text-primary)",
            marginBottom: 12,
          }}
        >
          {t("ciTab.heading")}
        </div>

        {loadingInstalls ? (
          <Skeleton height={80} />
        ) : installations && installations.length > 0 ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
            data-testid="installations-list"
          >
            {installations.map((inst) => (
              <div
                key={inst.id}
                data-testid={`installation-${inst.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderRadius: 9,
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                }}
              >
                <Badge
                  color={
                    TARGET_BADGE_COLOR[inst.target_type] ?? "var(--text-muted)"
                  }
                  bg="var(--bg-hover)"
                >
                  {inst.target_type.toUpperCase()}
                </Badge>
                <span
                  className="mono"
                  style={{ fontSize: 13, color: "var(--text-primary)", flex: 1 }}
                >
                  {inst.repo}
                </span>
                <span
                  style={{ fontSize: 12, color: "var(--text-muted)" }}
                  data-testid={`install-date-${inst.id}`}
                >
                  {t("ciTab.installed", { date: formatDate(inst.installed_at) })}
                </span>
              </div>
            ))}
            {/* Allow exporting again (update) */}
            <div style={{ marginTop: 8 }}>
              <Button
                kind="secondary"
                icon="Upload"
                onClick={() => setShowWizard(true)}
                aria-label={t("ciTab.update")}
              >
                {t("ciTab.update")}
              </Button>
            </div>
          </div>
        ) : (
          /* Empty state */
          <div
            data-testid="ci-empty-state"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              padding: "40px 0",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 340 }}>
              {t("ciTab.empty")}
            </div>
            <Button
              kind="primary"
              icon="Upload"
              onClick={() => setShowWizard(true)}
              aria-label={t("ciTab.exportToCi")}
              data-testid="export-to-ci-button"
            >
              {t("ciTab.exportToCi")}
            </Button>
          </div>
        )}
      </div>

      {/* 3. CI Runs history (compact sub-list) */}
      <div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--text-primary)",
            marginBottom: 12,
          }}
        >
          {t("runs.title")}
        </div>
        {loadingRuns ? (
          <Skeleton height={80} />
        ) : !ciRuns || ciRuns.length === 0 ? (
          <div
            data-testid="ci-runs-empty"
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              padding: "16px 0",
            }}
          >
            {t("runs.emptyTitle")}
          </div>
        ) : (
          <div
            data-testid="ci-runs-list"
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            {ciRuns.map((run) => (
              <div
                key={run.id}
                data-testid={`ci-run-${run.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                  fontSize: 13,
                }}
              >
                {/* Timestamp */}
                <span
                  style={{ color: "var(--text-muted)", whiteSpace: "nowrap", fontSize: 12 }}
                >
                  {run.ran_at ? formatDate(run.ran_at) : "—"}
                </span>

                {/* PR number */}
                <span style={{ color: "var(--text-secondary)", flex: 1 }}>
                  {run.pr_number != null ? `#${run.pr_number}` : "—"}
                </span>

                {/* Findings */}
                <span
                  className="tnum"
                  style={{ color: "var(--text-primary)", minWidth: 24, textAlign: "right" }}
                  data-testid={`run-findings-${run.id}`}
                >
                  {run.findings_count ?? "—"}
                </span>

                {/* Status badge */}
                <Badge
                  color={
                    run.status === "succeeded" || run.status === "no_findings"
                      ? "var(--ok)"
                      : run.status === "failed"
                        ? "var(--crit)"
                        : "var(--warn)"
                  }
                  bg="var(--bg-hover)"
                >
                  {run.status ?? "—"}
                </Badge>

                {/* GitHub link */}
                {run.github_url && (
                  <a
                    href={run.github_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--accent)", fontSize: 12 }}
                  >
                    {t("runs.view")}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export Wizard modal */}
      {showWizard && (
        <ExportWizard
          agentId={agent.id}
          agentName={agent.name}
          onClose={() => setShowWizard(false)}
        />
      )}
    </div>
  );
}
