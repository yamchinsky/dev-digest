import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffViewer. */
export const sv = {
  container: { display: "flex", flexDirection: "column", gap: 0 } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 0 14px",
  } satisfies CSSProperties,

  headerSummary: {
    fontSize: 13,
    color: "var(--text-secondary)",
    fontWeight: 500,
  } satisfies CSSProperties,

  toggleRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 0,
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
  } satisfies CSSProperties,

  toggleBtn: (active: boolean): CSSProperties => ({
    padding: "5px 13px",
    fontSize: 12.5,
    fontWeight: 500,
    background: active ? "var(--accent-bg)" : "transparent",
    color: active ? "var(--accent-text)" : "var(--text-secondary)",
    border: "none",
    cursor: "pointer",
    borderRight: "1px solid var(--border)",
    transition: "background .1s, color .1s",
  }),

  splitBanner: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "12px 16px",
    borderRadius: 7,
    background: "var(--warn-bg, rgba(255,160,0,.10))",
    border: "1px solid var(--warn, #f59e0b)",
    marginBottom: 14,
  } satisfies CSSProperties,

  splitBannerTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--warn, #f59e0b)",
  } satisfies CSSProperties,

  splitBannerItem: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  groupSection: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    marginBottom: 14,
  } satisfies CSSProperties,

  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 0 8px",
  } satisfies CSSProperties,

  groupDot: (color: string): CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),

  groupLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  groupDesc: {
    fontSize: 12,
    color: "var(--text-muted)",
    flex: 1,
  } satisfies CSSProperties,

  groupCount: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontWeight: 500,
  } satisfies CSSProperties,

  fileList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  findingDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    background: "var(--crit, #ef4444)",
    display: "inline-block",
    flexShrink: 0,
  } satisfies CSSProperties,

  findingBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 7px",
    borderRadius: 5,
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--crit, #ef4444)",
    background: "var(--crit-bg, rgba(239,68,68,.10))",
    cursor: "pointer",
    border: "none",
    whiteSpace: "nowrap",
    marginLeft: 4,
  } satisfies CSSProperties,
} as const;
