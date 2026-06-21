import type { CSSProperties } from "react";

export const s = {
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 22,
    fontWeight: 700,
    margin: 0,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginTop: 4,
    margin: 0,
  } satisfies CSSProperties,
  tabsRow: {
    display: "flex",
    gap: 4,
    borderBottom: "1px solid var(--border)",
    marginBottom: 16,
  } satisfies CSSProperties,
  tab: (active: boolean): CSSProperties => ({
    appearance: "none",
    border: "none",
    background: "transparent",
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    cursor: "pointer",
    borderBottom: active ? "2px solid var(--text-primary)" : "2px solid transparent",
    marginBottom: -1,
  }),
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  stickyBar: {
    position: "sticky",
    bottom: 0,
    marginTop: 16,
    padding: "12px 16px",
    background: "var(--bg)",
    borderTop: "1px solid var(--border)",
    display: "flex",
    justifyContent: "flex-end",
  } satisfies CSSProperties,
} as const;
