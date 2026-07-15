/* colors.ts — stable palette-by-key helper for the Agent Performance screen.
 *
 * PerfCostSegment ({label,value}) and AgentPerfRow carry no color of their
 * own, so we assign one client-side: hash the key (agent id, or a cost
 * segment's label when no id is available) into a fixed-order, 8-hue
 * categorical palette. Fixed order (never re-cycled per render) is the
 * CVD-safety mechanism per the dataviz skill — colors must follow the
 * entity, not its rank in whatever list happens to be sorted/filtered.
 *
 * Palette = the dataviz skill's validated categorical set (`references/
 * palette.md`), dark-surface steps — this app's default theme is dark
 * (`:root` in vendor/ui/styles.css ships the dark tokens), and these steps
 * are the ones validated to clear 3:1 contrast on a dark surface.
 */

const PALETTE = [
  "#3987e5", // blue
  "#199e70", // aqua
  "#c98500", // yellow
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
  "#d55181", // magenta
  "#d95926", // orange
] as const;

/** Deterministic string hash (FNV-1a-ish) — stable across renders/reloads. */
function hashString(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Stable color for any string key (agent id, model name, cost-segment label). */
export function colorForKey(key: string): string {
  return PALETTE[hashString(key) % PALETTE.length]!;
}
