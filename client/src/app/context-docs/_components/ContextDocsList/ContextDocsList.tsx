/* ContextDocsList — scrollable list of workspace-wide context docs.
   Each row shows the relative path (monospace), a color-coded category badge,
   and an agent-count chip. Selection is lifted to the parent page. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, Skeleton } from "@devdigest/ui";
import type { ContextDocCategory } from "@devdigest/shared";
import { useWorkspaceContextDocs } from "@/lib/hooks";

type SelectedDoc = { repoId: string; path: string };

interface Props {
  selected: SelectedDoc | null;
  onSelect: (doc: SelectedDoc) => void;
}

/** Badge colors for each ContextDoc category: specs=blue, docs=green, insights=amber. */
const CATEGORY_STYLE: Record<ContextDocCategory, { color: string; bg: string }> = {
  specs:    { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  docs:     { color: "var(--ok)",          bg: "var(--ok-bg)" },
  insights: { color: "var(--warn)",        bg: "var(--warn-bg)" },
};

export function ContextDocsList({ selected, onSelect }: Props) {
  const t = useTranslations("contextDocs");
  const { data: docs, isLoading } = useWorkspaceContextDocs();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* column heading */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {t("list.heading")}
        </h2>
      </div>

      {/* scrollable list body */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {isLoading && (
          <div
            style={{
              padding: "12px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        )}

        {/* Empty state per AC-6: no error boundary — just inline empty state */}
        {!isLoading && (!docs || docs.length === 0) && (
          <EmptyState
            icon="FileText"
            title={t("list.empty.title")}
            body={t("list.empty.body")}
          />
        )}

        {docs &&
          docs.map((doc) => {
            const isActive =
              selected?.repoId === doc.repo_id &&
              selected?.path === doc.relative_path;
            const cat = CATEGORY_STYLE[doc.category];

            return (
              <button
                key={`${doc.repo_id}::${doc.relative_path}`}
                onClick={() =>
                  onSelect({ repoId: doc.repo_id, path: doc.relative_path })
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "10px 20px",
                  textAlign: "left",
                  background: isActive ? "var(--accent-bg)" : "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  transition: "background .1s",
                }}
              >
                {/* relative path — monospace, truncated */}
                <span
                  className="mono"
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: isActive
                      ? "var(--accent-text)"
                      : "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {doc.relative_path}
                </span>

                {/* category badge */}
                <Badge color={cat.color} bg={cat.bg}>
                  {t(`list.badge.${doc.category}`)}
                </Badge>

                {/* agent-count chip */}
                <Badge
                  color="var(--text-muted)"
                  bg="var(--bg-elevated)"
                >
                  {t("list.usedBy", { count: doc.agent_count })}
                </Badge>
              </button>
            );
          })}
      </div>
    </div>
  );
}
