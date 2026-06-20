/* ImportSkillDialog — upload .md or .zip → preview parsed items → trust gate →
   commit. Two-step on purpose: the user MUST see what they're about to add
   to an agent's prompt before it lands in the DB.

   - Drop zone is a thin overlay on a native <input type="file">; we don't
     reach for any drag-drop lib (no new deps, accessibility stays trivial).
   - Trust banner + checkbox: the model treats skill bodies as TRUSTED text
     (rules it must follow), so the user has to acknowledge they vetted them. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Modal,
  Button,
  TextInput,
  SelectInput,
  Textarea,
  FormField,
  Checkbox,
  Icon,
} from "@devdigest/ui";
import type { ImportPreviewItem, SkillType } from "@devdigest/shared";
import { ApiError } from "@/services/api";
import { useImportPreview, useImportCommit } from "@/lib/hooks/skills";
import { fileToBase64, isAcceptedFilename } from "./helpers";

type Stage = "pick" | "review";

const TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "rubric" },
  { value: "convention", label: "convention" },
  { value: "security", label: "security" },
  { value: "custom", label: "custom" },
];

export function ImportSkillDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const preview = useImportPreview();
  const commit = useImportCommit();

  const [stage, setStage] = React.useState<Stage>("pick");
  const [items, setItems] = React.useState<ImportPreviewItem[]>([]);
  const [trusted, setTrusted] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const submitting = preview.isPending || commit.isPending;

  async function handleFile(file: File) {
    setError(null);
    if (!isAcceptedFilename(file.name)) {
      setError("Unsupported file. Accepted: .md, .markdown, .txt, .zip");
      return;
    }
    try {
      const contentBase64 = await fileToBase64(file);
      const res = await preview.mutateAsync({ filename: file.name, contentBase64 });
      setItems(res.items);
      setStage("review");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  function patchItem(index: number, patch: Partial<ImportPreviewItem>) {
    setItems((curr) => curr.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  async function handleCommit() {
    setError(null);
    const missing = items.find((it) => !it.name.trim() || !it.description.trim() || !it.body.trim());
    if (missing) {
      setError(`"${missing.name || missing.filename || "skill"}" is missing name, description, or body.`);
      return;
    }
    try {
      await commit.mutateAsync(items);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  return (
    <Modal
      width={720}
      title={t("drawer.title")}
      subtitle={stage === "pick" ? t("drawer.subtitle") : `${items.length} skill(s) ready to save`}
      onClose={onClose}
      footer={
        stage === "review" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Checkbox checked={trusted} onChange={setTrusted} />
            <span style={{ fontSize: 13, color: "var(--text-secondary)", flex: 1 }}>
              I&apos;ve reviewed each skill body — it becomes part of my agent&apos;s prompt.
            </span>
            <Button kind="secondary" size="sm" onClick={() => setStage("pick")}>
              Back
            </Button>
            <Button
              kind="primary"
              size="sm"
              disabled={!trusted || submitting}
              onClick={handleCommit}
            >
              {commit.isPending ? "Saving…" : `Save ${items.length} skill${items.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div style={{ padding: 24 }}>
        {error && (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 8,
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "var(--sev-critical, #ef4444)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {stage === "pick" && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            onClick={() => inputRef.current?.click()}
            style={{
              padding: "40px 24px",
              borderRadius: 12,
              border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border-strong)"}`,
              background: dragOver ? "var(--accent-bg)" : "var(--bg-surface)",
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            <Icon.Upload size={28} style={{ color: "var(--text-muted)", marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              Drop a skill file or click to browse
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Accepts .md, .markdown, .txt, or a .zip of markdown files (max 1 MB)
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".md,.markdown,.txt,.zip"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
            {preview.isPending && (
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary)" }}>
                Parsing…
              </div>
            )}
          </div>
        )}

        {stage === "review" && (
          <>
            <div
              style={{
                marginBottom: 18,
                padding: 12,
                borderRadius: 8,
                background: "rgba(251, 191, 36, 0.08)",
                border: "1px solid rgba(251, 191, 36, 0.35)",
                fontSize: 13,
                color: "var(--text-primary)",
              }}
            >
              <strong>Heads up:</strong> a skill is a set of instructions that will be appended to
              your agent&apos;s system prompt. Treat imported skills like third-party code —
              read each one before saving.
            </div>

            {items.map((item, i) => (
              <div
                key={i}
                style={{
                  marginBottom: 16,
                  padding: 14,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--bg-surface)",
                }}
              >
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                  From <span className="mono">{item.filename ?? "(direct upload)"}</span>
                </div>

                <FormField label="Name" required>
                  <TextInput value={item.name} onChange={(v) => patchItem(i, { name: v })} />
                </FormField>

                <FormField label="Description (interface)" required hint="What the skill does, in imperative voice — what the agent reads when picking it.">
                  <TextInput
                    value={item.description}
                    onChange={(v) => patchItem(i, { description: v })}
                  />
                </FormField>

                <FormField label="Type">
                  <SelectInput
                    value={item.type}
                    onChange={(v) => patchItem(i, { type: v as SkillType })}
                    options={TYPE_OPTIONS}
                  />
                </FormField>

                <FormField label="Body (markdown)">
                  <Textarea
                    mono
                    rows={8}
                    value={item.body}
                    onChange={(v) => patchItem(i, { body: v })}
                  />
                </FormField>
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
