/* ContextDocsPreview — right pane; renders the raw content of the selected
   context doc as Markdown. Shows a placeholder when nothing is selected and
   a skeleton while the content is being fetched. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Markdown, Skeleton } from "@devdigest/ui";
import { useContextDocPreview } from "@/lib/hooks";

type SelectedDoc = { repoId: string; path: string };

interface Props {
  selected: SelectedDoc | null;
}

export function ContextDocsPreview({ selected }: Props) {
  const t = useTranslations("contextDocs");
  const { data, isLoading } = useContextDocPreview(
    selected?.repoId ?? null,
    selected?.path ?? null,
  );

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

  /* Content */
  return (
    <div style={{ padding: 28 }}>
      {/* file path header */}
      <div
        style={{
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <p
          className="mono"
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          {selected.path}
        </p>
      </div>

      {/* Markdown content — uses existing Markdown primitive (react-markdown + remark-gfm) */}
      <Markdown>{data?.content}</Markdown>
    </div>
  );
}
