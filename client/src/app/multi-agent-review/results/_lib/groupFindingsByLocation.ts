/**
 * Pure client helper — no I/O, no hooks, no DOM.
 * Groups findings from multiple agents by overlapping file+line-range.
 *
 * Two intervals [a.start, a.end] and [b.start, b.end] overlap iff:
 *   a.start <= b.end && b.start <= a.end
 */

export interface FindingInput {
  findingId: string;
  runId: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: string;
  title: string;
}

export interface FlaggedCell {
  severity: string;
  title: string;
}

export type Cell = FlaggedCell | "did-not-flag";

export interface GroupedLocation {
  file: string;
  startLine: number;
  endLine: number;
  /** Keyed by runId — every runId in the input runIds array appears here. */
  cells: Record<string, Cell>;
  /** True iff at least one runId flagged and at least one did not flag. */
  isConflict: boolean;
}

/**
 * Groups findings by file + overlapping startLine..endLine range across a set
 * of runs (agents). Each group carries one cell per runId: either the finding
 * info or "did-not-flag". Conflicts = groups where flag/no-flag differs across
 * agents.
 *
 * Returns [] when there are no findings at all or all agents agree uniformly.
 */
export function groupFindingsByLocation(
  findings: FindingInput[],
  runIds: string[],
): GroupedLocation[] {
  if (findings.length === 0 || runIds.length === 0) return [];

  // Cluster findings into overlap groups using a greedy sweep per file.
  // We process each file independently.
  const byFile = new Map<string, FindingInput[]>();
  for (const f of findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  const groups: GroupedLocation[] = [];

  for (const [file, filefindings] of byFile) {
    // Sort by startLine so we can merge overlapping intervals in one pass.
    const sorted = [...filefindings].sort((a, b) => a.startLine - b.startLine);

    // Build overlap clusters: intervals A and B overlap iff A.start <= B.end && B.start <= A.end
    const clusters: FindingInput[][] = [];
    for (const finding of sorted) {
      let merged = false;
      for (const cluster of clusters) {
        // Check if this finding overlaps with any existing finding in the cluster.
        const overlaps = cluster.some(
          (c) => c.startLine <= finding.endLine && finding.startLine <= c.endLine,
        );
        if (overlaps) {
          cluster.push(finding);
          merged = true;
          break;
        }
      }
      if (!merged) {
        clusters.push([finding]);
      }
    }

    for (const cluster of clusters) {
      // The group's line range is the union of all findings' ranges.
      const startLine = Math.min(...cluster.map((f) => f.startLine));
      const endLine = Math.max(...cluster.map((f) => f.endLine));

      // Build cells: one per runId in the run set.
      const cells: Record<string, Cell> = {};
      for (const runId of runIds) {
        const match = cluster.find((f) => f.runId === runId);
        cells[runId] = match ? { severity: match.severity, title: match.title } : "did-not-flag";
      }

      // A conflict exists when at least one agent flagged and at least one did not.
      const flaggedCount = Object.values(cells).filter((c) => c !== "did-not-flag").length;
      const isConflict = flaggedCount > 0 && flaggedCount < runIds.length;

      groups.push({ file, startLine, endLine, cells, isConflict });
    }
  }

  return groups;
}
