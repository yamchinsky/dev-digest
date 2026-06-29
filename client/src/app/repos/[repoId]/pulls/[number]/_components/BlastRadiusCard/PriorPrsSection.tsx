/* PriorPrsSection — collapsible list of prior PRs whose changed files overlap
   the current PR's changed files. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PriorPr } from "@devdigest/shared";
import { s } from "./styles";

interface PriorPrsSectionProps {
  priorPrs: PriorPr[];
}

export function PriorPrsSection({ priorPrs }: PriorPrsSectionProps) {
  const t = useTranslations("blast");
  const [expanded, setExpanded] = React.useState(false);

  // Always render the header (even when empty) so the user knows the query ran.
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        style={s.collapsibleHeader}
      >
        <Icon.History size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span style={s.collapsibleLabel}>
          {t("priorPrs", { count: priorPrs.length })}
        </span>
        <Icon.ChevronDown
          size={13}
          style={{
            color: "var(--text-muted)",
            transition: "transform .15s",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </div>

      {expanded && (
        <div style={s.priorPrList}>
          {priorPrs.length === 0 ? (
            <span
              style={{ fontSize: 13, color: "var(--text-muted)", paddingLeft: 4 }}
            >
              {t("priorPrsNone")}
            </span>
          ) : (
            priorPrs.map((pr) => (
              <div key={pr.pull_id} style={s.priorPrRow}>
                <span style={s.priorPrNumber}>#{pr.number}</span>
                <span>{pr.title}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
