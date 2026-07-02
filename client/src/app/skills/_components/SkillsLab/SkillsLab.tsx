/* SkillsLab — 3-pane shell for /skills and /skills/[id].
 *
 *  Mirrors /agents/[id]'s layout: middle column is the scrollable workspace
 *  skill list (cards, with search + Add menu); right column shows the
 *  selected skill (Config / Preview / Versions / Stats tabs) or an
 *  empty-state when nothing is selected.
 *
 *  Selection is URL-driven (clicking a card navigates to /skills/<id>);
 *  the active tab is in ?tab=. Both pages route here, so navigating between
 *  skills is a soft route change — the list scroll persists. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Dropdown,
  EmptyState,
  ErrorState,
  Skeleton,
  Icon,
  Tabs,
  Badge,
  Toggle,
} from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import {
  useSkills,
  useSkill,
  useToggleSkillEnabled,
  useDeleteSkill,
} from "@/lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { ImportSkillDialog } from "../ImportSkillDialog";
import { ConfigTab } from "../SkillDetail/ConfigTab";
import { ContextTab } from "../SkillDetail/ContextTab";
import { PreviewTab } from "../SkillDetail/PreviewTab";
import { VersionsTab } from "../SkillDetail/VersionsTab";
import { StatsTab } from "../SkillDetail/StatsTab";
import { filterSkills, typeColor } from "../SkillsListView/helpers";
import { s } from "./styles";

const VALID_TABS = ["config", "context", "preview", "stats", "versions"] as const;
type TabKey = (typeof VALID_TABS)[number];

// Design order: Config | Context | Preview | Stats | Versions (Evals tab from
// the design is intentionally omitted — agreed to skip eval in this iteration).
const TAB_DEFS = [
  { key: "config", label: "Config", icon: "Settings" as const },
  { key: "context", label: "Context", icon: "FileText" as const },
  { key: "preview", label: "Preview", icon: "Eye" as const },
  { key: "stats", label: "Stats", icon: "BarChart" as const },
  { key: "versions", label: "Versions", icon: "History" as const },
];

export function SkillsLab({ skillId }: { skillId?: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const { data: selected, isLoading: selectedLoading, isError: selectedError, refetch: refetchSelected } = useSkill(skillId);
  const toggle = useToggleSkillEnabled();
  const del = useDeleteSkill();
  const [query, setQuery] = React.useState("");
  const [importing, setImporting] = React.useState(false);

  const tabParam = search.get("tab") ?? "";
  const tab: TabKey = (VALID_TABS as readonly string[]).includes(tabParam) ? (tabParam as TabKey) : "config";
  const setTab = (next: string) => {
    if (!skillId) return;
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${skillId}?${sp.toString()}`);
  };

  const list = filterSkills(skills ?? [], query);

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete skill "${name}"? This cannot be undone.`)) return;
    await del.mutateAsync(id);
    if (id === skillId) router.replace("/skills");
  }

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills"), href: "/skills" }, ...(selected ? [{ label: selected.name, mono: true }] : [])]}>
      {importing && <ImportSkillDialog onClose={() => setImporting(false)} />}
      <div style={s.shell}>
        {/* middle: skills list */}
        <div style={s.listCol}>
          <div style={s.listHeader}>
            <div style={s.listHeaderRow}>
              <h1 style={s.h1}>{t("page.heading")}</h1>
              <Dropdown
                width={210}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus">
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
            <div style={s.search}>
              <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                style={s.searchInput}
              />
            </div>
          </div>

          <div style={s.list}>
            {isLoading && <Skeleton height={120} />}
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
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === skillId}
                onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
                onToggle={(enabled) => toggle.mutate({ id: sk.id, enabled })}
                onDelete={() => handleDelete(sk.id, sk.name)}
              />
            ))}
          </div>
        </div>

        {/* right: detail */}
        <div style={s.detailCol}>
          {!skillId ? (
            <EmptyState
              icon="Sparkles"
              title={t("page.selectPrompt.title")}
              body={t("page.selectPrompt.body")}
            />
          ) : selectedLoading ? (
            <div style={{ padding: 28 }}>
              <Skeleton height={28} width={240} />
              <div style={{ height: 16 }} />
              <Skeleton height={320} />
            </div>
          ) : selectedError || !selected ? (
            <ErrorState
              fullScreen
              title={t("detail.notFound.title")}
              body={t("detail.loadError")}
              onRetry={() => refetchSelected()}
            />
          ) : (
            <DetailPane
              skill={selected}
              tab={tab}
              onTab={setTab}
              onToggle={(enabled) => toggle.mutate({ id: selected.id, enabled })}
              onDelete={() => handleDelete(selected.id, selected.name)}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function DetailPane({
  skill,
  tab,
  onTab,
  onToggle,
  onDelete,
}: {
  skill: Skill;
  tab: TabKey;
  onTab: (t: string) => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("skills");
  const color = typeColor(skill.type);
  return (
    <>
      <div style={s.detailHeader}>
        <Icon.Sparkles size={18} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
          {skill.name}
        </h1>
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
        <Badge color="var(--text-muted)" mono>
          v{skill.version}
        </Badge>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {skill.enabled ? t("preview.enabled") : t("preview.disabled")}
          </span>
        </div>
      </div>
      <div style={{ borderBottom: "1px solid var(--border)", marginTop: 12 }}>
        <Tabs
          tabs={TAB_DEFS.map((d) => ({ key: d.key, label: d.label, icon: d.icon }))}
          value={tab}
          onChange={onTab}
          pad="0 24px"
        />
      </div>
      <div style={s.detailBody}>
        {tab === "config" && <ConfigTab skill={skill} onDelete={onDelete} />}
        {tab === "context" && <ContextTab skill={skill} />}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "versions" && <VersionsTab skill={skill} />}
        {tab === "stats" && <StatsTab skill={skill} />}
      </div>
    </>
  );
}
