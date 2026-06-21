/**
 * Format a USD cost for display.
 *
 * - null/undefined → "—" (the slide explicitly forbids "$0.00" for "no data").
 * - 0 → "$0.00" (a real free-model run is a legitimate zero, distinct from null).
 * - <$1 → 3 decimals ("$0.012") so sub-cent reviews are still distinguishable.
 * - ≥$1 → 2 decimals ("$1.20") to keep the badge narrow.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
