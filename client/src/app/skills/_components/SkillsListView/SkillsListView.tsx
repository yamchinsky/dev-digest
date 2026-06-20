/* /skills — Skills Lab list (A1). Grid of SkillCards with search + Add menu.
   Clicking a card opens a side preview drawer (no navigation), so users can
   browse the workspace skill library quickly. Edit jumps to /skills/:id. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Dropdown,
  EmptyState,
  ErrorState,
  Skeleton,
  Icon,
} from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import {
  useSkills,
  useToggleSkillEnabled,
  useDeleteSkill,
} from "@/lib/hooks/skills";
import type { Skill } from "@devdigest/shared";
import { SkillCard } from "../SkillCard";
import { SkillPreviewDrawer } from "../SkillPreviewDrawer";
import { ImportSkillDialog } from "../ImportSkillDialog";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const toggle = useToggleSkillEnabled();
  const del = useDeleteSkill();
  const [search, setSearch] = React.useState("");
  const [preview, setPreview] = React.useState<Skill | null>(null);
  const [importing, setImporting] = React.useState(false);

  const list = filterSkills(skills ?? [], search);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {importing && <ImportSkillDialog onClose={() => setImporting(false)} />}
      {preview && <SkillPreviewDrawer skill={preview} onClose={() => setPreview(null)} />}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.heading")}</h1>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={220}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              {
                label: "Create from scratch",
                icon: "Edit",
                onClick: () => router.push("/skills/new"),
              },
              { divider: true },
              {
                label: t("page.menu.fromFile"),
                icon: "Upload",
                onClick: () => setImporting(true),
              },
            ]}
          />
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={140} />
            <Skeleton height={140} />
            <Skeleton height={140} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setImporting(true)}
          />
        )}
        {list.length > 0 && (
          <div style={s.grid}>
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                onClick={() => setPreview(sk)}
                onToggle={(enabled) => toggle.mutate({ id: sk.id, enabled })}
                onDelete={() => del.mutate(sk.id)}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
