/* FindingsCell — per-PR severity pills + hover tooltip on the PR list.
   Ported 1-to-1 from screen_dashboard.jsx (FindingsCell, lines 44-59)
   and prdetail_runs.jsx (FindingsTooltip, lines 38-54). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, SeverityBadge, CategoryTag } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { s } from "./styles";

const SEVERITY_ORDER = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

type Findings = NonNullable<PrMeta["findings"]>;

export function FindingsCell({ findings }: { findings: PrMeta["findings"] }) {
  const t = useTranslations("prReview");
  const [show, setShow] = React.useState(false);

  if (!findings) {
    return <span style={s.empty}>{t("list.findingsCell.empty")}</span>;
  }
  const total =
    findings.counts.CRITICAL + findings.counts.WARNING + findings.counts.SUGGESTION;
  if (total === 0) {
    return <span style={s.empty}>{t("list.findingsCell.empty")}</span>;
  }
  return (
    <div
      style={s.cell}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {SEVERITY_ORDER.filter((sv) => findings.counts[sv] > 0).map((sv) => {
        const meta = SEV[sv];
        const I = Icon[meta.icon];
        return (
          <span key={sv} style={s.pill(meta.c)}>
            <I size={12} />
            <span className="tnum">{findings.counts[sv]}</span>
          </span>
        );
      })}
      {show && findings.items.length > 0 && (
        <FindingsTooltip items={findings.items} count={total} />
      )}
    </div>
  );
}

function FindingsTooltip({
  items,
  count,
}: {
  items: Findings["items"];
  count: number;
}) {
  const t = useTranslations("prReview");
  return (
    <div style={s.tooltip} onClick={(e) => e.stopPropagation()}>
      <div style={s.tooltipHeader}>
        <Icon.AlertOctagon size={12} />
        {t("list.findingsCell.tooltipTitle", { count })}
      </div>
      <div style={s.tooltipList}>
        {items.map((f, i) => (
          <div key={i} style={s.tooltipItem(i === items.length - 1)}>
            <div style={s.tooltipTitleRow}>
              <SeverityBadge severity={f.severity} compact />
              <span style={s.tooltipTitle}>{f.title}</span>
              <CategoryTag category={f.category} />
            </div>
            <div style={s.tooltipMetaRow}>
              <span className="mono" style={s.tooltipFileLink}>
                {f.file}:
                {f.start_line === f.end_line ? f.start_line : `${f.start_line}-${f.end_line}`}
              </span>
              <span className="tnum" style={s.tooltipConfidence}>
                {Math.round(f.confidence * 100)}% conf
              </span>
            </div>
            <div style={s.tooltipRationale}>{f.rationale_excerpt}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
