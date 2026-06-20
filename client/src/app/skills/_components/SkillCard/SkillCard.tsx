/* SkillCard — name (mono), description, type badge, version, enabled toggle.
   Clicking the card opens the preview drawer; the toggle stops propagation so
   it doesn't double-fire. Disabled skills render at lower opacity (workspace-
   level disable — they won't be included in any agent run). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { typeColor } from "../SkillsListView/helpers";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
  onDelete,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("skills");
  const color = typeColor(skill.type);
  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={14} />
        </div>
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Delete skill "${skill.name}"? This cannot be undone.`)) onDelete();
            }}
            title="Delete skill"
            aria-label="Delete skill"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              display: "inline-flex",
              padding: 4,
            }}
          >
            <Icon.Trash size={14} />
          </button>
        )}
      </div>
      <div style={s.description}>{skill.description}</div>
      <div style={s.metaRow}>
        <span style={s.typeBadge(color)}>{t(`listItem.type.${skill.type}`)}</span>
        <span style={s.sourcePill}>{t(`listItem.source.${skill.source}`)}</span>
        {/* "needs vetting" mirrors the design: any non-manual skill body is
            third-party text that will land in an agent's prompt. The pill is
            advisory — it doesn't gate enable; users acknowledge during import. */}
        {skill.source !== "manual" && (
          <span style={s.vetting} title={t("listItem.vettingTitle")}>
            <Icon.AlertTriangle size={11} />
            {t("listItem.needsVetting")}
          </span>
        )}
        <span style={s.versionPill}>v{skill.version}</span>
      </div>
    </div>
  );
}
