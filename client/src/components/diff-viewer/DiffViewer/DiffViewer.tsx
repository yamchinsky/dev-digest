/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline.
   Optional targetFile: wraps each FileCard in a stable-id div so that the
   DiffTab scroll effect can jump to a file deep-linked from PrBriefCard. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/types";
import { type DiffCommentApi } from "../comments";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  targetFile,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** When set, the matching FileCard is expanded (defaultOpen) and its wrapper
   *  div gets a stable id used by DiffTab's scroll effect. */
  targetFile?: string;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f, i) => (
        // Stable id per file — DiffTab's useEffect calls document.getElementById
        // with this id to scroll the target file into view (D6 / F1 acceptance).
        // key uses f.path (not index) for stable DOM identity across re-renders.
        <div key={f.path || i} id={`diff-file-${encodeURIComponent(f.path)}`}>
          <FileCard
            file={f}
            commenting={commenting}
            // Pass undefined (not false) for non-target files to preserve the
            // existing AUTO_EXPAND_MAX_LINES auto-rule inside FileCard.
            defaultOpen={f.path === targetFile || undefined}
          />
        </div>
      ))}
    </div>
  );
}
