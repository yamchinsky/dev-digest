/* ContextTab — skill ↔ context-docs binding tab ("Project context to use").
 *
 *  Semantics: a checkbox = "this doc is attached to this skill" (unordered,
 *  AC-11..13). Any agent using this skill inherits the attached docs into the
 *  ## Project context prompt slot at run time. The SERIALIZES AS block shows
 *  the client-derived prompt heading + path list — no API call. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, Markdown, Skeleton, TextInput } from "@devdigest/ui";
import type { ContextDoc, ContextDocCategory, Skill } from "@devdigest/shared";
import {
  useWorkspaceContextDocs,
  useSkillContextDocs,
  useSetSkillContextDocs,
  useContextDocPreview,
} from "@/lib/hooks";

const CAT_COLOR: Record<ContextDocCategory, string> = {
  specs: "#6366f1",
  docs: "#16a34a",
  insights: "#d97706",
};

function CategoryBadge({ category }: { category: ContextDocCategory }) {
  const color = CAT_COLOR[category] ?? "var(--text-secondary)";
  return (
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
        flexShrink: 0,
      }}
    >
      {category}
    </span>
  );
}

function DocRow({
  doc,
  attached,
  onToggle,
}: {
  doc: ContextDoc;
  attached: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("skills");
  const [previewOpen, setPreviewOpen] = React.useState(false);

  // Fetched lazily — only once the preview pane is opened.
  const { data: preview, isFetching: previewLoading } = useContextDocPreview(
    previewOpen ? doc.repo_id : null,
    previewOpen ? doc.relative_path : null,
  );

  return (
    <div
      style={{
        borderRadius: 7,
        border: "1px solid var(--border)",
        overflow: "hidden",
        background: attached ? "var(--bg-elevated)" : "var(--bg-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        <Checkbox checked={attached} onChange={onToggle} />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={doc.relative_path}
        >
          {doc.relative_path}
        </span>
        <CategoryBadge category={doc.category} />
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: previewOpen ? "var(--accent-bg)" : "transparent",
            color: previewOpen ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
          aria-expanded={previewOpen}
          aria-label={
            previewOpen
              ? t("contextSection.previewHide")
              : t("contextSection.previewShow")
          }
        >
          <Icon.Eye size={13} />
        </button>
      </div>

      {previewOpen && (
        <div
          style={{
            padding: "8px 12px 12px 34px",
            borderTop: "1px solid var(--border)",
            fontSize: 12.5,
            color: "var(--text-secondary)",
            maxHeight: 300,
            overflowY: "auto",
          }}
        >
          {previewLoading ? (
            <Skeleton height={80} />
          ) : preview ? (
            <Markdown>{preview.content}</Markdown>
          ) : (
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
          )}
        </div>
      )}
    </div>
  );
}

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const [filter, setFilter] = React.useState("");

  const { data: allDocs = [] } = useWorkspaceContextDocs();
  const { data: skillDocs = [] } = useSkillContextDocs(skill.id);
  const setDocs = useSetSkillContextDocs(skill.id);

  const attachedKeySet = new Set(skillDocs.map((d) => `${d.repo_id}:${d.relative_path}`));
  const isAttached = (doc: ContextDoc) =>
    attachedKeySet.has(`${doc.repo_id}:${doc.relative_path}`);

  // Client-side filter — no API call (AC-11)
  const filteredDocs = filter.trim()
    ? allDocs.filter((d) => d.relative_path.includes(filter))
    : allDocs;

  // Attached docs in workspace order — used for mutation payload and SERIALIZES AS
  const attachedDocs = allDocs.filter(isAttached);

  // AC-12: send full flat set on every toggle
  function handleToggle(doc: ContextDoc) {
    const docKey = `${doc.repo_id}:${doc.relative_path}`;
    const next = isAttached(doc)
      ? attachedDocs.filter((d) => `${d.repo_id}:${d.relative_path}` !== docKey)
      : [...attachedDocs, doc];
    setDocs.mutate({ items: next.map((d) => ({ path: d.relative_path, repo_id: d.repo_id })) });
  }

  // AC-13: client-side derivation only — no API call
  const serializesText =
    "## Project context" +
    (attachedDocs.length > 0
      ? "\n" + attachedDocs.map((d) => `- ${d.relative_path}`).join("\n")
      : "");

  return (
    <div style={{ padding: "20px 28px 44px" }}>
      {/* header: heading + N attached chip + filter */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
          {t("contextSection.heading")}
        </span>
        <Badge color="var(--accent)" bg="var(--accent-bg)">
          {t("contextSection.nAttached", { count: attachedDocs.length })}
        </Badge>
        <div style={{ marginLeft: "auto", width: 240 }}>
          <TextInput
            value={filter}
            onChange={setFilter}
            placeholder={t("contextSection.filterPlaceholder")}
          />
        </div>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
        {t("contextSection.inheritHint")}
      </div>

      {/* checkbox list */}
      {allDocs.length === 0 ? (
        <div
          style={{
            padding: "32px 20px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-muted)",
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          {t("contextSection.empty")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filteredDocs.map((doc) => (
            <DocRow
              key={`${doc.repo_id}:${doc.relative_path}`}
              doc={doc}
              attached={isAttached(doc)}
              onToggle={() => handleToggle(doc)}
            />
          ))}
        </div>
      )}

      {/* SERIALIZES AS — pre-formatted prompt preview, client-derived (AC-13) */}
      <div style={{ marginTop: 18 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          {t("contextSection.serializesAs")}
        </div>
        <pre
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: 7,
            border: "1px solid var(--border-strong)",
            background: "var(--bg-elevated)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {serializesText}
        </pre>
      </div>
    </div>
  );
}
