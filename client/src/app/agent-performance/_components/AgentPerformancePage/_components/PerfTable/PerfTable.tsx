/* PerfTable — the Agent Performance leaderboard table.
 *
 * Default sort: accept_rate desc, nulls last (DEFAULT_SORT). Clicking a
 * header toggles that column's sort. Expanding a row reveals a Sparkline of
 * its `trend` (recent findings-per-run, oldest→newest). Every value renders
 * straight off AgentPerfRow — no client-side recomputation that could
 * diverge from the per-agent Stats tab (same server aggregation).
 */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, Sparkline } from "@devdigest/ui";
import type { AgentPerfRow } from "@devdigest/shared";
import { relativeTime } from "@/app/repos/[repoId]/pulls/helpers";
import { colorForKey } from "../../colors";
import { COLUMNS, DEFAULT_SORT, type SortKey } from "../../constants";
import { acceptRateColor, formatDurationS, formatPercent, formatUsd, nextSort, sortRows } from "../../helpers";

export function PerfTable({ rows }: { rows: AgentPerfRow[] }) {
  const t = useTranslations("agentPerformance");
  const [sort, setSort] = React.useState(DEFAULT_SORT);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const sorted = React.useMemo(() => sortRows(rows, sort), [rows, sort]);

  function handleSortClick(key: SortKey, defaultDir: "asc" | "desc") {
    setSort((cur) => nextSort(cur, key, defaultDir));
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        aria-label={t("title")}
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
            <th style={{ padding: "8px 4px", width: 28 }} />
            {COLUMNS.map((col) => {
              const active = sort.key === col.key;
              return (
                <th
                  key={col.key}
                  style={{
                    padding: "8px 12px",
                    textAlign: col.align === "right" ? "right" : "left",
                    cursor: "pointer",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                  onClick={() => handleSortClick(col.key, col.defaultDir)}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      flexDirection: col.align === "right" ? "row-reverse" : "row",
                    }}
                  >
                    {col.labelKey === "agent"
                      ? t("table.agent")
                      : col.labelKey === "runs"
                        ? t("table.runs")
                        : col.labelKey === "avgCost"
                          ? t("table.avgCost")
                          : col.labelKey === "avgDuration"
                            ? t("table.avgDuration")
                            : col.labelKey === "accept"
                              ? t("table.accept")
                              : t("table.lastRun")}
                    {active &&
                      (sort.dir === "asc" ? (
                        <Icon.ArrowUp size={11} aria-hidden />
                      ) : (
                        <Icon.ArrowDown size={11} aria-hidden />
                      ))}
                  </span>
                </th>
              );
            })}
            <th style={{ padding: "8px 12px" }} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const expanded = expandedId === row.agent_id;
            const color = colorForKey(row.agent_id);
            return (
              <React.Fragment key={row.agent_id}>
                <tr
                  style={{ borderBottom: "1px solid var(--border-subtle, var(--border))" }}
                  data-testid="perf-row"
                >
                  <td style={{ padding: "10px 4px", textAlign: "center" }}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : row.agent_id)}
                      aria-label={t("table.trend")}
                      aria-expanded={expanded}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "none",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        padding: 2,
                      }}
                    >
                      {expanded ? <Icon.ChevronDown size={14} /> : <Icon.ChevronRight size={14} />}
                    </button>
                  </td>

                  {/* Agent — colored icon + name */}
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Icon.Cpu size={14} style={{ color }} aria-hidden />
                      <span style={{ fontWeight: 600 }}>{row.agent_name}</span>
                    </div>
                  </td>

                  {/* Runs */}
                  <td className="tnum" style={{ padding: "10px 12px", textAlign: "right" }}>
                    {row.runs}
                  </td>

                  {/* Avg cost */}
                  <td className="tnum" style={{ padding: "10px 12px", textAlign: "right" }}>
                    {formatUsd(row.avg_cost_usd)}
                  </td>

                  {/* Avg duration */}
                  <td className="tnum" style={{ padding: "10px 12px", textAlign: "right" }}>
                    {formatDurationS(row.avg_latency_ms)}
                  </td>

                  {/* Accept rate */}
                  <td
                    className="tnum"
                    style={{
                      padding: "10px 12px",
                      textAlign: "right",
                      fontWeight: 600,
                      color: acceptRateColor(row.accept_rate),
                    }}
                  >
                    {formatPercent(row.accept_rate)}
                  </td>

                  {/* Last run */}
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-muted)" }}>
                    {row.last_run_at ? relativeTime(row.last_run_at) : "—"}
                  </td>

                  {/* View */}
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    <Link
                      href={`/agents/${row.agent_id}`}
                      style={{ color: "var(--accent)", fontSize: 12, textDecoration: "none" }}
                    >
                      {t("table.view")}
                    </Link>
                  </td>
                </tr>

                {expanded && (
                  <tr style={{ borderBottom: "1px solid var(--border-subtle, var(--border))" }}>
                    <td />
                    <td colSpan={7} style={{ padding: "6px 12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("table.trend")}</span>
                        {row.trend.length > 0 ? (
                          <Sparkline data={row.trend} color={color} w={100} h={26} />
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
