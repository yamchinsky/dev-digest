"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "@/components/diff-viewer/SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/providers/toast";
import type { PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Clicking a severity badge navigates to the Findings tab and opens this id. */
  onOpenFinding?: (findingId: string) => void;
}

export function DiffTab({ prId, filesCount, files, canComment, onOpenFinding }: DiffTabProps) {
  // useSearchParams is safe here — DiffTab is always rendered inside the
  // <Suspense> boundary in page.tsx (PRDetailPage wraps PRDetailPageInner).
  const searchParams = useSearchParams();
  const targetFile = searchParams.get("file") ?? undefined;

  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const { data: smartDiff, isLoading: smartDiffLoading, isError: smartDiffError } = useSmartDiff(prId);

  // Scroll the target FileCard into view after the diff renders (D6 / F1).
  // 100 ms delay allows the diff content to paint before scrolling.
  // BOTH renderers (SmartDiffViewer and the flat DiffViewer fallback) add the
  // stable id wrappers — a per-file affordance must exist in both, or the
  // deep-link silently no-ops on whichever branch renders.
  React.useEffect(() => {
    if (!targetFile) return;
    const id = `diff-file-${encodeURIComponent(targetFile)}`;
    const timer = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return () => clearTimeout(timer);
  }, [targetFile]);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {showComments ? "Hide comments" : "Show comments"} ({commentCount})
            </Button>
          ) : undefined
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>

      {/* Use SmartDiffViewer when data is available; fall back to flat DiffViewer
          while loading or on error (the patches are already in `files`). */}
      {smartDiff && !smartDiffLoading && !smartDiffError ? (
        <SmartDiffViewer
          smartDiff={smartDiff}
          files={files}
          commenting={commenting}
          onOpenFinding={onOpenFinding}
          targetFile={targetFile}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} targetFile={targetFile} />
      )}
    </section>
  );
}
