import type { CSSProperties } from "react";

export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 880, margin: "0 auto" } satisfies CSSProperties,
  header: { marginBottom: 24, display: "flex", alignItems: "center", gap: 14 } satisfies CSSProperties,
  back: {
    fontSize: 13,
    color: "var(--text-secondary)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
  } satisfies CSSProperties,
  title: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    flex: 1,
  } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 14 } satisfies CSSProperties,
  bodyTabs: { display: "flex", gap: 6, marginBottom: 8 } satisfies CSSProperties,
  bodyTab: (active: boolean): CSSProperties => ({
    padding: "5px 12px",
    fontSize: 12.5,
    fontWeight: 600,
    background: "none",
    border: "none",
    borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    cursor: "pointer",
  }),
  preview: {
    minHeight: 260,
    padding: 16,
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  tokenCounter: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 24,
    padding: "16px 0",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
} as const;
