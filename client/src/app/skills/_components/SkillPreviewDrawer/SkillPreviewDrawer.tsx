/* SkillPreviewDrawer — side preview of a skill's body (markdown rendered).
   Used from the Skills Lab list page; clicking a card opens the drawer rather
   than navigating, so the user can browse skills without losing list scroll. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Drawer, Button, Markdown, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useToggleSkillEnabled } from "@/lib/hooks/skills";
import { typeColor } from "../SkillsListView/helpers";

export function SkillPreviewDrawer({
  skill,
  onClose,
}: {
  skill: Skill;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toggle = useToggleSkillEnabled();
  const color = typeColor(skill.type);

  return (
    <Drawer
      width={620}
      onClose={onClose}
      title={skill.name}
      subtitle={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color,
              background: color + "1f",
              padding: "2px 8px",
              borderRadius: 4,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {t(`listItem.type.${skill.type}`)}
          </span>
          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {t("preview.version", { version: skill.version })}
          </span>
        </span>
      }
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle
            on={skill.enabled}
            onChange={(enabled) => toggle.mutate({ id: skill.id, enabled })}
            size={14}
          />
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {skill.enabled ? t("preview.enabled") : t("preview.disabled")}
          </span>
          <div style={{ flex: 1 }} />
          <Button kind="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Edit"
            onClick={() => router.push(`/skills/${skill.id}`)}
          >
            {t("preview.edit")}
          </Button>
        </div>
      }
    >
      <div style={{ marginBottom: 16, fontSize: 13, color: "var(--text-secondary)" }}>
        {skill.description}
      </div>
      <Markdown>{skill.body}</Markdown>
    </Drawer>
  );
}
