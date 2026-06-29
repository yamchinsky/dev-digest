import type { CSSProperties } from "react";

/** Co-located styles for BlastRadiusCard and its sub-components. */
export const s = {
  card: {
    padding: "var(--card-pad)",
  } satisfies CSSProperties,

  statRow: {
    display: "flex",
    gap: 16,
    marginBottom: 16,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  statItem: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  } satisfies CSSProperties,

  statValue: {
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.2,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,

  statLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  statusBadgeRow: {
    marginBottom: 12,
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
  } satisfies CSSProperties,

  degradedReason: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 4,
    lineHeight: 1.4,
  } satisfies CSSProperties,

  symbolList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  } satisfies CSSProperties,

  symbolRow: {
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,

  symbolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    cursor: "pointer",
    userSelect: "none" as const,
    background: "var(--bg-hover)",
    borderRadius: 6,
    transition: "background .12s",
  } satisfies CSSProperties,

  symbolName: {
    flex: 1,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-primary)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  callerList: {
    borderLeft: "2px solid var(--border)",
    marginLeft: 14,
    paddingLeft: 12,
    marginTop: 4,
    marginBottom: 4,
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } satisfies CSSProperties,

  callerRow: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
  } satisfies CSSProperties,

  callerName: {
    fontSize: 12,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,

  badgeRow: {
    display: "flex",
    gap: 4,
    flexWrap: "wrap" as const,
    marginTop: 4,
    marginLeft: 2,
  } satisfies CSSProperties,

  collapsibleHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingTop: 12,
    cursor: "pointer",
    userSelect: "none" as const,
    borderTop: "1px solid var(--border)",
    marginTop: 14,
  } satisfies CSSProperties,

  collapsibleLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    flex: 1,
  } satisfies CSSProperties,

  priorPrList: {
    marginTop: 8,
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  } satisfies CSSProperties,

  priorPrRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  priorPrNumber: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,

  /** Outer pill container for the Tree / Graph segmented toggle. */
  viewToggle: {
    display: "flex",
    gap: 2,
    background: "var(--bg-hover)",
    borderRadius: 6,
    padding: 2,
    marginBottom: 12,
    alignSelf: "flex-start" as const,
  } satisfies CSSProperties,

  /** Individual option button inside the segmented toggle. */
  viewToggleBtn: {
    padding: "3px 12px",
    border: "none",
    background: "transparent",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-muted)",
    cursor: "pointer",
    textTransform: "capitalize" as const,
    transition: "background .12s, color .12s",
  } satisfies CSSProperties,

  /** Active state for the selected option in the segmented toggle. */
  viewToggleBtnActive: {
    background: "var(--bg-base)",
    color: "var(--text-primary)",
    fontWeight: 600,
    boxShadow: "0 1px 3px rgba(0,0,0,.2)",
  } satisfies CSSProperties,
} as const;
