"use client";

import React from "react";
import { formatCost } from "@/utils/format-cost";

/**
 * RunCostBadge — surfaces the cost of one agent run (or an aggregate). Two
 * visual variants:
 *
 *  - `compact` (default): just the dollar amount. Used in the PR list and
 *    anywhere the row already shows tokens separately.
 *  - `full`: dollar + "tokensIn→tokensOut" cluster. Used in the run timeline
 *    on the PR detail page, where this is the only token cue per row.
 *
 * null/undefined cost renders as "—" via `formatCost`; we never render
 * "$0.00" for "no data" (per slide).
 */
type Variant = "compact" | "full";

const muted: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  fontVariantNumeric: "tabular-nums",
};

function shortK(n: number): string {
  if (n >= 1_000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function RunCostBadge({
  cost,
  tokensIn,
  tokensOut,
  variant = "compact",
}: {
  cost: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: Variant;
}) {
  if (variant === "full") {
    const haveTokens = tokensIn != null && tokensOut != null;
    return (
      <span className="mono" style={muted}>
        {haveTokens && (
          <>
            {shortK(tokensIn!)}→{shortK(tokensOut!)} tok ·{" "}
          </>
        )}
        {formatCost(cost)}
      </span>
    );
  }
  return (
    <span className="mono" style={muted}>
      {formatCost(cost)}
    </span>
  );
}
