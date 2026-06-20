"use client";

import type { RunSummary, PrCommit } from "@devdigest/shared";
import { CommitRow } from "./_components/CommitRow";
import { RunRow } from "./_components/RunRow";
import { tsOf, type TimelineItem } from "./helpers";
import { s } from "./styles";

/**
 * PR timeline — every agent run interleaved with the PR's commits, newest-first
 * and DB-backed so it survives reload. Showing commits between runs makes it
 * clear which commit each review ran against. Failed runs show their error
 * inline; clicking a run row opens its trace.
 *
 * Outcome derivation, row styles, and row JSX are siblings (`helpers.ts`,
 * `styles.ts`, `_components/{CommitRow,RunRow}.tsx`); this file only does the
 * timeline merge + iteration.
 */
export function RunHistory({
  runs,
  commits = [],
  onOpenTrace,
  onGoToReview,
  onDelete,
}: {
  runs: RunSummary[];
  commits?: PrCommit[];
  /** Open the trace + log drawer for a run (the logs icon). */
  onOpenTrace: (runId: string) => void;
  /** Jump to this run's inline review accordion below (clicking the agent name). */
  onGoToReview?: (runId: string) => void;
  onDelete?: (runId: string) => void;
}) {
  if (runs.length === 0 && commits.length === 0) return null;

  const items: TimelineItem[] = [
    ...runs.map((run) => ({ kind: "run" as const, ts: tsOf(run.ran_at), run })),
    ...commits.map((commit) => ({
      kind: "commit" as const,
      ts: tsOf(commit.committed_at),
      commit,
    })),
  ].sort((a, b) => b.ts - a.ts);

  return (
    <div style={s.list}>
      {items.map((item) =>
        item.kind === "commit" ? (
          <CommitRow key={`commit:${item.commit.sha}`} commit={item.commit} />
        ) : (
          <RunRow
            key={`run:${item.run.run_id}`}
            run={item.run}
            onOpenTrace={onOpenTrace}
            onGoToReview={onGoToReview}
            onDelete={onDelete}
          />
        ),
      )}
    </div>
  );
}
