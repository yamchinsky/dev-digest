/* Shared style tokens for eval pipeline components (MetricCardsRow, TrendChart,
   RunHistory, CompareView, CasesList, EvalsTab). */
import type { CSSProperties } from "react";

export const s = {
  wrap: { padding: "24px 28px 44px" } satisfies CSSProperties,
  metricsRow: {
    display: "flex",
    gap: 12,
    marginBottom: 28,
  } satisfies CSSProperties,
  section: {
    marginBottom: 28,
  } satisfies CSSProperties,
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 12,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
  runControls: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 28,
    paddingBottom: 20,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  emptyState: {
    padding: "32px 20px",
    textAlign: "center" as const,
    fontSize: 13,
    color: "var(--text-muted)",
    border: "1px dashed var(--border)",
    borderRadius: 8,
  } satisfies CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  } satisfies CSSProperties,
  th: {
    textAlign: "left" as const,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    padding: "6px 8px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: {
    padding: "10px 8px",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle" as const,
  } satisfies CSSProperties,
  passBadge: (pass: boolean | null): CSSProperties => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background:
      pass === null
        ? "var(--bg-elevated)"
        : pass
        ? "#22c55e22"
        : "#ef444422",
    color:
      pass === null ? "var(--text-muted)" : pass ? "#22c55e" : "#ef4444",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  }),
  typeChip: (type: string): CSSProperties => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 500,
    background: type === "must_find" ? "#6366f122" : "#f59e0b22",
    color: type === "must_find" ? "#6366f1" : "#f59e0b",
    textTransform: "none" as const,
  }),
  actionBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 500,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    textDecoration: "none",
  } satisfies CSSProperties,
  deleteBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 500,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--crit, #ef4444)",
    cursor: "pointer",
  } satisfies CSSProperties,
  compareWrap: {
    border: "1px solid var(--accent, #6366f1)",
    borderRadius: 9,
    padding: 20,
    marginBottom: 28,
    background: "var(--accent-bg, #6366f108)",
  } satisfies CSSProperties,
  compareHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  } satisfies CSSProperties,
  deltaPos: {
    color: "var(--ok, #22c55e)",
    fontWeight: 600,
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12,
  } satisfies CSSProperties,
  deltaNeg: {
    color: "var(--crit, #ef4444)",
    fontWeight: 600,
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12,
  } satisfies CSSProperties,
  deltaFlat: {
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12,
  } satisfies CSSProperties,
  monoCell: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12,
  } satisfies CSSProperties,
} as const;
