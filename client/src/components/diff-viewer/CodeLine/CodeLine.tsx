/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { SEV, Icon, type Severity } from "@devdigest/ui";
import { commentTargetFor, keysForLine, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

/** A finding anchored to this line, enough to render + deep-link an in-diff badge. */
export interface LineFinding {
  id: string;
  severity: Severity;
}

/** Reviewer-facing label per severity (matches the in-diff design: lowercase,
 *  CRITICAL renders as "blocker"). */
const INLINE_LABEL: Record<Severity, string> = {
  CRITICAL: "blocker",
  WARNING: "warning",
  SUGGESTION: "suggestion",
  INFO: "info",
};

/** A single clickable in-line finding badge: icon + label, severity-tinted. */
function InlineFindingBadge({
  finding,
  onClick,
}: {
  finding: LineFinding;
  onClick?: (findingId: string) => void;
}) {
  const sev = SEV[finding.severity];
  const I = Icon[sev.icon];
  const label = INLINE_LABEL[finding.severity];
  return (
    <button
      type="button"
      aria-label={`View ${label} finding`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(finding.id);
      }}
      style={cs.lineBadgeBtn(sev.c, sev.bg)}
    >
      <I size={12} />
      {label}
    </button>
  );
}

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  findingsOnLine,
  onFindingClick,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Findings whose start_line is this line's new-side number (Smart Diff only). */
  findingsOnLine?: LineFinding[];
  /** Navigate to the Findings tab and open the clicked finding's card. */
  onFindingClick?: (findingId: string) => void;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;

  // Stable, file-namespaced scroll anchor for finding-to-line navigation.
  // Prefer RIGHT:n (new-side) because findings are keyed to the new side.
  const firstKey = keysForLine(ln)[0];
  const lineId = firstKey ? `dl:${path}:${firstKey}` : undefined;

  return (
    <div
      id={lineId}
      data-line-key={lineId}
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={lineRowFor(ln.kind)}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {findingsOnLine && findingsOnLine.length > 0 && (
          <span style={cs.lineBadges}>
            {findingsOnLine.map((f) => (
              <InlineFindingBadge key={f.id} finding={f} onClick={onFindingClick} />
            ))}
          </span>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
