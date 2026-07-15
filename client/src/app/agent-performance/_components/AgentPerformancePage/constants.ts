/* constants.ts — period selector + sortable column registry for the
   Agent Performance dashboard table. */

export const PERIODS = ["30d", "1d", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export const DAY_MS = 86_400_000;

/** Keys the table can sort by (subset of AgentPerfRow, all nullable-safe). */
export type SortKey = "agent_name" | "runs" | "avg_cost_usd" | "avg_latency_ms" | "accept_rate" | "last_run_at";
export type SortDir = "asc" | "desc";

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** Default sort: accept_rate desc, nulls last (the quality-signal column). */
export const DEFAULT_SORT: SortState = { key: "accept_rate", dir: "desc" };

/** Column → the AgentPerfRow field it sorts by, its i18n label key (under
    the `agentPerformance.table` namespace), and its default click direction. */
export const COLUMNS: { key: SortKey; labelKey: string; defaultDir: SortDir; align?: "right" }[] = [
  { key: "agent_name", labelKey: "agent", defaultDir: "asc" },
  { key: "runs", labelKey: "runs", defaultDir: "desc", align: "right" },
  { key: "avg_cost_usd", labelKey: "avgCost", defaultDir: "desc", align: "right" },
  { key: "avg_latency_ms", labelKey: "avgDuration", defaultDir: "desc", align: "right" },
  { key: "accept_rate", labelKey: "accept", defaultDir: "desc", align: "right" },
  { key: "last_run_at", labelKey: "lastRun", defaultDir: "desc", align: "right" },
];
