import React from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    textAlign: "left",
  } satisfies React.CSSProperties,
  iconBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-muted)",
    cursor: "pointer",
    flexShrink: 0,
  } satisfies React.CSSProperties,
  // Commits are markers, not actions — lighter (dashed, transparent) so they
  // read as separators between the runs they sit chronologically between.
  commitRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px dashed var(--border)",
    background: "transparent",
  } satisfies React.CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies React.CSSProperties,
  deleteBtn: {
    display: "inline-flex",
    padding: 3,
    borderRadius: 5,
    color: "var(--text-muted)",
    flexShrink: 0,
    cursor: "pointer",
  } satisfies React.CSSProperties,
};
