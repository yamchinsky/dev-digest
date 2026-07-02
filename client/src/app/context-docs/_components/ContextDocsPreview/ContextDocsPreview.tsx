/* ContextDocsPreview — right pane; Preview | Edit toggle over the selected
   context doc. Preview renders Markdown; Edit is a plain-text editor whose
   Save writes back to the file in the repo clone (whitelist-gated server
   side). Shows a placeholder when nothing is selected and a skeleton while
   the content is being fetched.

   NOTE: the parent keys this component by `repoId:path`, so switching docs
   remounts it — tab and draft state never leak between documents. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Markdown, Skeleton, Textarea } from "@devdigest/ui";
import {
  useContextDocPreview,
  useUpdateContextDocContent,
  useWorkspaceContextDocs,
} from "@/lib/hooks";

type SelectedDoc = { repoId: string; path: string };

interface Props {
  selected: SelectedDoc | null;
}

type PaneTab = "preview" | "edit";

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: 600,
  padding: "4px 12px",
  borderRadius: 5,
  border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
  background: active ? "var(--accent-bg)" : "transparent",
  color: active ? "var(--accent)" : "var(--text-muted)",
  cursor: "pointer",
});

export function ContextDocsPreview({ selected }: Props) {
  const t = useTranslations("contextDocs");
  const [tab, setTab] = React.useState<PaneTab>("preview");
  // Draft is null until the user enters Edit; hydrated from the fetched content.
  const [draft, setDraft] = React.useState<string | null>(null);

  const { data, isLoading } = useContextDocPreview(
    selected?.repoId ?? null,
    selected?.path ?? null,
  );
  const { data: allDocs } = useWorkspaceContextDocs();
  const update = useUpdateContextDocContent();

  /* No selection — placeholder */
  if (!selected) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <EmptyState
          icon="FileText"
          title={t("preview.placeholder.title")}
          body={t("preview.placeholder.body")}
        />
      </div>
    );
  }

  /* Loading skeleton */
  if (isLoading) {
    return (
      <div
        style={{
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <Skeleton height={20} width={280} />
        <div style={{ height: 4 }} />
        <Skeleton height={14} />
        <Skeleton height={14} width="85%" />
        <Skeleton height={14} width="70%" />
        <div style={{ height: 8 }} />
        <Skeleton height={220} />
      </div>
    );
  }

  const content = data?.content ?? "";
  const agentCount =
    allDocs?.find(
      (d) => d.repo_id === selected.repoId && d.relative_path === selected.path,
    )?.agent_count ?? 0;

  const dirty = draft !== null && draft !== content;

  function enterEdit() {
    if (draft === null) setDraft(content);
    setTab("edit");
  }

  async function handleSave() {
    if (draft === null) return;
    await update.mutateAsync({
      repoId: selected!.repoId,
      path: selected!.path,
      content: draft,
    });
    setTab("preview");
  }

  function handleCancel() {
    setDraft(null);
    setTab("preview");
  }

  /* Content */
  return (
    <div style={{ padding: 28 }}>
      {/* header: path + Preview|Edit toggle + used-by chip */}
      <div
        style={{
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <p
          className="mono"
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--text-muted)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={selected.path}
        >
          {selected.path}
        </p>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            style={tabBtnStyle(tab === "preview")}
            onClick={() => setTab("preview")}
          >
            {t("preview.tabs.preview")}
          </button>
          <button
            type="button"
            style={tabBtnStyle(tab === "edit")}
            onClick={enterEdit}
          >
            {t("preview.tabs.edit")}
          </button>
        </div>
        <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
          {t("list.usedBy", { count: agentCount })}
        </span>
      </div>

      {tab === "preview" ? (
        /* Markdown content — uses existing Markdown primitive (react-markdown + remark-gfm) */
        <Markdown>{content}</Markdown>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Textarea
            rows={22}
            mono
            value={draft ?? content}
            onChange={(v) => setDraft(v)}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, fontSize: 12, color: "var(--text-muted)" }}>
              {t("preview.editHint")}
            </span>
            <Button kind="secondary" size="sm" onClick={handleCancel}>
              {t("preview.cancel")}
            </Button>
            <Button
              kind="primary"
              size="sm"
              disabled={!dirty || update.isPending}
              onClick={handleSave}
            >
              {update.isPending ? t("preview.saving") : t("preview.save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
