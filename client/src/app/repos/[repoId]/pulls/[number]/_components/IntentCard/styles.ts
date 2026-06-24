import type { CSSProperties } from "react";

/** Co-located styles for IntentCard. */
export const s = {
  card: {
    padding: "var(--card-pad)",
  } satisfies CSSProperties,

  loadingText: {
    height: 14,
    borderRadius: 4,
    background: "var(--bg-hover)",
    width: "60%",
    animation: "pulse 1.5s ease-in-out infinite",
  } satisfies CSSProperties,

  intentText: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-primary)",
    margin: "0 0 16px",
  } satisfies CSSProperties,

  modelRow: {
    marginBottom: 14,
  } satisfies CSSProperties,

  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  } satisfies CSSProperties,

  scopeLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,

  scopeList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } satisfies CSSProperties,

  scopeItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  scopeDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--accent)",
    flexShrink: 0,
    marginTop: 5,
  } satisfies CSSProperties,
} as const;
