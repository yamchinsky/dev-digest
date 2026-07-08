import type { CSSProperties } from "react";

/** Co-located styles for the Skills Lab EvalsTab (benchmark view). */
export const e = {
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  } satisfies CSSProperties,

  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  error: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--sev-critical, #ef4444)",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid rgba(239, 68, 68, 0.35)",
    background: "rgba(239, 68, 68, 0.08)",
  } satisfies CSSProperties,

  // Summary: Metric | with_skill | without_skill | Δ
  table: {
    display: "grid",
    gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr",
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    fontSize: 13.5,
  } satisfies CSSProperties,

  // Qualitative diff: Aspect | with_skill | without_skill
  aspectTable: {
    display: "grid",
    gridTemplateColumns: "1fr 1.6fr 1.6fr",
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    fontSize: 13,
  } satisfies CSSProperties,

  headCell: {
    padding: "9px 14px",
    fontWeight: 700,
    fontSize: 12,
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
    borderBottom: "1px solid var(--border)",
    fontFamily: "var(--font-mono)",
  } satisfies CSSProperties,

  cell: {
    padding: "9px 14px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  cellStrong: {
    padding: "9px 14px",
    borderBottom: "1px solid var(--border)",
    fontWeight: 700,
    fontFamily: "var(--font-mono)",
  } satisfies CSSProperties,

  aspectCell: {
    padding: "9px 14px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text-secondary)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    lineHeight: 1.4,
  } satisfies CSSProperties,

  caseBlock: { marginTop: 14 } satisfies CSSProperties,

  caseName: {
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "var(--font-mono)",
    color: "var(--accent)",
    marginBottom: 8,
  } satisfies CSSProperties,

  historyList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  historyRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  historyModel: {
    fontSize: 12.5,
    fontFamily: "var(--font-mono)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  historyVersion: {
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  historyMetric: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono)",
  } satisfies CSSProperties,
} as const;
