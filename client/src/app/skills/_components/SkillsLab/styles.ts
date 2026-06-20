import type { CSSProperties } from "react";

/** 3-pane layout: middle skill list + right detail pane.
 *  Mirrors /agents/[id]/page.tsx so the two SKILLS LAB pages feel symmetric. */
export const s = {
  shell: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  listCol: {
    width: 320,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  listHeader: { padding: "16px 16px 12px" } satisfies CSSProperties,
  listHeaderRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  } satisfies CSSProperties,
  h1: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  list: {
    flex: 1,
    overflow: "auto",
    padding: "0 12px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  detailCol: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  detailHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  detailBody: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
  } satisfies CSSProperties,
} as const;
