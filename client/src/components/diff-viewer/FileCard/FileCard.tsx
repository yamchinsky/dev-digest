/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine, type LineFinding } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

interface FileCardProps {
  file: PrFile;
  commenting?: DiffCommentApi;
  /**
   * Override the initial open state (uncontrolled mode).
   * When absent, falls back to the ≤AUTO_EXPAND_MAX_LINES auto-rule.
   */
  defaultOpen?: boolean;
  /**
   * Controlled open state. When provided, FileCard delegates toggle to the
   * caller via `onToggle` instead of managing its own state.
   */
  open?: boolean;
  /** Called when the header is clicked in controlled mode. */
  onToggle?: () => void;
  /** Optional node rendered in the file header (e.g. a finding indicator badge). */
  badge?: React.ReactNode;
  /** new-side line number → findings on that line (Smart Diff in-line badges). */
  findingsByLine?: Map<number, LineFinding[]>;
  /** Navigate to the Findings tab and open the clicked finding's card. */
  onFindingClick?: (findingId: string) => void;
}

export function FileCard({
  file,
  commenting,
  defaultOpen,
  open: controlledOpen,
  onToggle,
  badge,
  findingsByLine,
  onFindingClick,
}: FileCardProps) {
  const t = useTranslations("shell");

  const autoExpand = (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES;
  const initialOpen = defaultOpen !== undefined ? defaultOpen : autoExpand;

  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(initialOpen);

  // Determine effective open value and toggle handler.
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const handleToggle = isControlled
    ? () => onToggle?.()
    : () => setUncontrolledOpen((o) => !o);

  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div onClick={handleToggle} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
        {badge}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                findingsOnLine={ln.newNo != null ? findingsByLine?.get(ln.newNo) : undefined}
                onFindingClick={onFindingClick}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
