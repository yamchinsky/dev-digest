import type { CSSProperties } from "react";

export const s = {
  body: {
    padding: 20,
    overflow: "auto",
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  } satisfies CSSProperties,
  preview: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12,
    lineHeight: 1.6,
    padding: 14,
    background: "var(--bg-subtle, var(--bg))",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text-secondary)",
    maxHeight: 460,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    margin: 0,
  } satisfies CSSProperties,
} as const;
