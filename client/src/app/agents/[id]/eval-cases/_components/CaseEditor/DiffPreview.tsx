/* DiffPreview — renders a raw unified-diff string line-by-line with colour
   coding. Pure presentational; no third-party diff libraries.
   Lines starting with "+" → green, "-" → red, "@@" → accent, else default. */

import React from "react";

function lineColor(line: string): string {
  if (line.startsWith("+")) return "var(--ok, #22c55e)";
  if (line.startsWith("-")) return "var(--crit, #ef4444)";
  if (line.startsWith("@@")) return "var(--accent)";
  return "var(--text-secondary)";
}

export function DiffPreview({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <pre
      style={{
        fontFamily: "monospace",
        fontSize: 12,
        lineHeight: 1.6,
        margin: "8px 0 0",
        padding: "10px 12px",
        borderRadius: 7,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        overflow: "auto",
        maxHeight: 320,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ color: lineColor(line) }}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}
