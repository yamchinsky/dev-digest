import type { CSSProperties } from "react";

// Base badge styles shared by all risk-level variants.
// All border properties use the shorthand form only — avoid mixing
// `border` shorthand with `borderColor` / `borderWidth` longhand in
// swapped-style objects, which triggers React DOM warnings.
const riskBadgeBase = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 10px",
  borderRadius: 5,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.01em" as const,
  lineHeight: 1.4,
  whiteSpace: "nowrap" as const,
} satisfies CSSProperties;

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "var(--card-pad)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  } satisfies CSSProperties,

  /** Color-coded badge per risk level (low/medium/high). */
  riskBadge: {
    low: { ...riskBadgeBase, color: "var(--sugg)", background: "var(--sugg-bg)" } satisfies CSSProperties,
    medium: { ...riskBadgeBase, color: "var(--warn)", background: "var(--warn-bg)" } satisfies CSSProperties,
    high: { ...riskBadgeBase, color: "var(--crit)", background: "var(--crit-bg)" } satisfies CSSProperties,
  },

  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    margin: "0 0 6px",
  } satisfies CSSProperties,

  sectionBody: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,

  riskList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  } satisfies CSSProperties,

  riskItem: {
    fontSize: 14,
    color: "var(--text-primary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  fileRefList: {
    listStyle: "none",
    margin: "6px 0 0",
    padding: "0 0 0 12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  } satisfies CSSProperties,

  focusList: {
    margin: 0,
    paddingLeft: 20,
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } satisfies CSSProperties,

  focusItem: {
    fontSize: 14,
    lineHeight: 1.5,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  fileLink: {
    color: "var(--accent)",
    textDecoration: "none",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
  } satisfies CSSProperties,

  usage: {
    fontSize: 12,
    color: "var(--text-muted)",
    margin: 0,
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
} as const;
