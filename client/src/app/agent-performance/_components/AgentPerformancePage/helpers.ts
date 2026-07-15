/* helpers.ts — period → since/until ISO conversion, table sort comparator,
   and the small display formatters this screen needs (that aren't already
   covered by src/utils/format-cost.ts, whose <$1 3-decimal behavior doesn't
   match this screen's fixed 2-decimal design spec). */
import type { AgentPerfRow } from "@devdigest/shared";
import { DAY_MS, type Period, type SortDir, type SortKey, type SortState } from "./constants";

export interface DateRange {
  since?: string;
  until?: string;
}

/** Resolve the selected period into the {since,until} ISO window the API expects. */
export function resolveRange(period: Period, customSince: string, customUntil: string): DateRange {
  if (period === "30d") {
    return { since: new Date(Date.now() - 30 * DAY_MS).toISOString() };
  }
  if (period === "1d") {
    return { since: new Date(Date.now() - 1 * DAY_MS).toISOString() };
  }
  // custom — plain <input type="date"> values ("YYYY-MM-DD"); only send a
  // bound once it parses to a real date (an empty/partial input is common
  // mid-typing and must not produce an "Invalid Date" ISO string).
  const since = parseIso(customSince);
  const until = parseIso(customUntil);
  return {
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
  };
}

function parseIso(dateStr: string): string | undefined {
  if (!dateStr) return undefined;
  const ms = Date.parse(dateStr);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString();
}

/** Card-label period suffix, e.g. "TOTAL RUNS (30D)". */
export function periodLabel(period: Period): string {
  return period === "30d" ? "30D" : period === "1d" ? "1D" : "CUSTOM";
}

/** "$x.xx" — "—" for null (never a fake $0.00). */
export function formatUsd(v: number | null | undefined): string {
  return v == null ? "—" : `$${v.toFixed(2)}`;
}

/** "N%" rounded — "—" for null. */
export function formatPercent(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** "x.xs" from milliseconds — "—" for null. */
export function formatDurationS(ms: number | null | undefined): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

/** Accept-rate color: green ≥60%, amber otherwise; muted when unknown. */
export function acceptRateColor(rate: number | null | undefined): string {
  if (rate == null) return "var(--text-muted)";
  return rate >= 0.6 ? "var(--ok)" : "var(--warn)";
}

/**
 * Sort rows by `key`, nulls always last regardless of direction (matches the
 * dashboard's default "accept_rate desc, nulls last" and generalizes it to
 * every sortable column so a zero-run / no-findings agent never floats above
 * agents with real data just because the user flipped direction).
 */
export function sortRows(rows: AgentPerfRow[], sort: SortState): AgentPerfRow[] {
  const factor: number = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => compareByKey(a, b, sort.key, factor));
}

function compareByKey(a: AgentPerfRow, b: AgentPerfRow, key: SortKey, factor: number): number {
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (av < bv) return -1 * factor;
  if (av > bv) return 1 * factor;
  return 0;
}

/** Toggle logic for clicking a column header: same column flips direction;
    a new column starts at its natural default direction. */
export function nextSort(current: SortState, key: SortKey, defaultDir: SortDir): SortState {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: defaultDir };
}
