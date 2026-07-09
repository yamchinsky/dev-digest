/* CiRunsPage — global CI Runs dashboard. Auto-polls every 60 s (AC-24). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Skeleton, SelectInput, TextInput, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import {
  useCiRuns,
  useSyncCiRuns,
  type CiRunsFilters,
} from "@/lib/hooks/ci";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIME_WINDOWS = ["7d", "30d", "90d"] as const;
type TimeWindow = (typeof TIME_WINDOWS)[number];

// The `since` API param is an ISO datetime (z.string().datetime on the server),
// so the UI window token is converted at the call boundary.
const WINDOW_DAYS: Record<TimeWindow, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

const STATUS_VALUES = ["", "succeeded", "failed", "no_findings", "running"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];


// Status → color tokens (always includes accessible text label, not colour-only)
const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  succeeded: { color: "var(--green)", bg: "var(--green-bg, rgba(34,197,94,0.12))" },
  no_findings: { color: "var(--blue)", bg: "var(--blue-bg, rgba(59,130,246,0.12))" },
  running: { color: "var(--yellow)", bg: "var(--yellow-bg, rgba(234,179,8,0.12))" },
  failed: { color: "var(--red)", bg: "var(--red-bg, rgba(239,68,68,0.12))" },
};

function getStatusColors(status: string | null | undefined) {
  const key = status ?? "";
  return STATUS_COLORS[key] ?? { color: "var(--text-muted)", bg: "var(--bg-hover)" };
}

type TFn = ReturnType<typeof useTranslations<"ci">>;

function translateStatus(t: TFn, status: string | null | undefined): string {
  switch (status) {
    case "succeeded":
      return t("runs.status.succeeded");
    case "no_findings":
      return t("runs.status.noFindings");
    case "running":
      return t("runs.status.running");
    case "failed":
      return t("runs.status.failed");
    default:
      return status ?? "—";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CiRunsPage() {
  const t = useTranslations("ci");

  // ── Filter state ──────────────────────────────────────────────────────────
  const [since, setSince] = React.useState<TimeWindow>("7d");
  const [agentId, setAgentId] = React.useState<string>("");
  const [repo, setRepo] = React.useState<string>("");
  const [status, setStatus] = React.useState<StatusFilter>("");

  const sinceIso = React.useMemo(
    () => new Date(Date.now() - WINDOW_DAYS[since] * DAY_MS).toISOString(),
    [since],
  );

  const filters: CiRunsFilters = {
    since: sinceIso,
    ...(agentId ? { agent_id: agentId } : {}),
    ...(repo.trim() ? { repo: repo.trim() } : {}),
    ...(status ? { status } : {}),
  };

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: runs, isLoading } = useCiRuns(filters, { refetchInterval: 60_000 });
  const sync = useSyncCiRuns();

  // ── Agent list for the agent selector ─────────────────────────────────────
  const { data: agents } = useAgents();

  // ── Helpers ───────────────────────────────────────────────────────────────
  const crumb = [
    { label: t("page.crumb"), href: "/ci-runs" },
  ];

  const agentOptions: { value: string; label: string }[] = [
    { value: "", label: t("runs.filters.allAgents") },
    ...((agents ?? []).map((a) => ({ value: a.id, label: a.name }))),
  ];

  const timeOptions: { value: string; label: string }[] = [
    { value: "7d", label: t("runs.filters.last7Days") },
    { value: "30d", label: "Last 30 days" },
    { value: "90d", label: "Last 90 days" },
  ];

  const statusOptions: { value: string; label: string }[] = [
    { value: "", label: t("runs.filters.allStatuses") },
    { value: "succeeded", label: t("runs.status.succeeded") },
    { value: "no_findings", label: t("runs.status.noFindings") },
    { value: "running", label: t("runs.status.running") },
    { value: "failed", label: t("runs.status.failed") },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 4,
            }}
          >
            <Icon.GitBranch size={18} style={{ color: "var(--accent)" }} aria-hidden />
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t("runs.title")}</h1>
            <Badge color="var(--text-secondary)" mono>
              {t("runs.autoRefresh")}
            </Badge>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            {t("runs.subtitle")}
          </p>
        </div>

        {/* Sync button */}
        <Button
          kind="primary"
          size="sm"
          icon="RefreshCw"
          loading={sync.isPending}
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
          data-testid="sync-btn"
        >
          {sync.isPending ? t("runs.refreshing") : t("runs.refresh")}
        </Button>
      </div>

      {/* ── Filters ── */}
      <div
        style={{
          padding: "0 28px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
        data-testid="filters"
      >
        {/* Time window */}
        <SelectInput
          value={since}
          onChange={(v) => setSince(v as TimeWindow)}
          options={timeOptions}
          mono={false}
        />

        {/* Agent selector */}
        <SelectInput
          value={agentId}
          onChange={setAgentId}
          options={agentOptions}
          mono={false}
        />

        {/* Repo input */}
        <TextInput
          value={repo}
          onChange={setRepo}
          placeholder={t("runs.filters.allRepos")}
          data-testid="repo-filter"
        />

        {/* Status selector */}
        <SelectInput
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          options={statusOptions}
          mono={false}
        />
      </div>

      {/* ── Table ── */}
      <div style={{ padding: "0 28px 44px" }}>
        {isLoading ? (
          <Skeleton height={200} />
        ) : !runs || runs.length === 0 ? (
          /* ── Empty state (AC-21) ── */
          <div
            style={{
              padding: "48px 20px",
              textAlign: "center",
              border: "1px dashed var(--border)",
              borderRadius: 8,
            }}
            data-testid="empty-state"
          >
            <Icon.GitBranch
              size={32}
              style={{ color: "var(--text-muted)", marginBottom: 12 }}
              aria-hidden
            />
            <p
              style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}
              data-testid="empty-title"
            >
              {t("runs.emptyTitle")}
            </p>
            <p
              style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 360, margin: "0 auto" }}
              data-testid="empty-body"
            >
              {t("runs.emptyBody")}
            </p>
          </div>
        ) : (
          /* ── Run table (AC-20) ── */
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
              aria-label={t("runs.title")}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>
                    {t("runs.table.timestamp")}
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>
                    {t("runs.table.pullRequest")}
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>
                    {t("runs.table.source")}
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>
                    Agent
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>
                    {t("runs.table.status")}
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>
                    {t("runs.table.findings")}
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>
                    {t("runs.table.cost")}
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }} />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const statusColors = getStatusColors(run.status);
                  return (
                    <tr
                      key={run.id}
                      style={{ borderBottom: "1px solid var(--border-subtle, var(--border))" }}
                      data-testid="ci-run-row"
                    >
                      {/* Timestamp */}
                      <td
                        style={{ padding: "10px 12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}
                      >
                        {run.ran_at
                          ? new Date(run.ran_at).toLocaleString()
                          : "—"}
                      </td>

                      {/* PR number — link to GitHub PR (AC-20) */}
                      <td style={{ padding: "10px 12px" }}>
                        {run.pr_number != null && run.github_url ? (
                          <a
                            href={run.github_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--accent)", textDecoration: "none" }}
                            aria-label={`PR #${run.pr_number}`}
                          >
                            #{run.pr_number}
                          </a>
                        ) : run.pr_number != null ? (
                          `#${run.pr_number}`
                        ) : (
                          "—"
                        )}
                      </td>

                      {/* Repository (source) */}
                      <td
                        style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12 }}
                        data-testid="run-source"
                      >
                        {run.source ?? "—"}
                      </td>

                      {/* Agent name */}
                      <td style={{ padding: "10px 12px" }} data-testid="run-agent">
                        {run.agent ?? "—"}
                      </td>

                      {/* Status badge — accessible text, not colour-only (a11y) */}
                      <td style={{ padding: "10px 12px" }}>
                        <Badge
                          color={statusColors.color}
                          bg={statusColors.bg}
                          dot
                        >
                          <span data-testid="run-status">
                            {translateStatus(t, run.status)}
                          </span>
                        </Badge>
                      </td>

                      {/* Findings count */}
                      <td
                        style={{ padding: "10px 12px", textAlign: "right" }}
                        data-testid="run-findings"
                      >
                        {run.findings_count ?? "—"}
                      </td>

                      {/* Cost */}
                      <td
                        style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 12 }}
                        data-testid="run-cost"
                      >
                        {run.cost_usd != null
                          ? `$${run.cost_usd.toFixed(4)}`
                          : "—"}
                      </td>

                      {/* Link to GitHub Actions job (AC-20) */}
                      <td style={{ padding: "10px 12px" }}>
                        {run.github_url ? (
                          <a
                            href={run.github_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--text-muted)", fontSize: 12 }}
                            aria-label={t("runs.view")}
                          >
                            {t("runs.view")}
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
