/* SkillEditor — shared form for /skills/new (create) and /skills/[id] (edit).
   Body has an Edit/Preview toggle so the user can see how the markdown will
   render in the trace + drawer without leaving the page. Token count is a
   rough char/4 estimate — the trace shows the real tiktoken value. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  TextInput,
  SelectInput,
  Textarea,
  FormField,
  Toggle,
  Markdown,
  ErrorState,
  Skeleton,
  Icon,
} from "@devdigest/ui";
import type { ContextDoc, Skill, SkillType } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import {
  useSkill,
  useCreateSkill,
  useUpdateSkill,
  useDeleteSkill,
  useToggleSkillEnabled,
} from "@/lib/hooks/skills";
import {
  useWorkspaceContextDocs,
  useSkillContextDocs,
  useSetSkillContextDocs,
} from "@/lib/hooks";
import { s } from "./styles";

type Mode = "create" | "edit";

const TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "rubric" },
  { value: "convention", label: "convention" },
  { value: "security", label: "security" },
  { value: "custom", label: "custom" },
];

const EMPTY = {
  name: "",
  description: "",
  type: "custom" as SkillType,
  body: "",
};

// Category badge colors: specs → blue, docs → green, insights → amber
const CATEGORY_COLORS: Record<string, { color: string; bg: string }> = {
  specs: { color: "#2563eb", bg: "#eff6ff" },
  docs: { color: "#16a34a", bg: "#f0fdf4" },
  insights: { color: "#d97706", bg: "#fffbeb" },
};

function approxTokens(body: string): number {
  return Math.max(1, Math.round(body.length / 4));
}

function CategoryBadge({ category }: { category: string }) {
  const c = CATEGORY_COLORS[category] ?? { color: "var(--text-secondary)", bg: "var(--bg-hover)" };
  return <Badge color={c.color} bg={c.bg}>{category}</Badge>;
}

// ---------------------------------------------------------------------------
// SkillContextSection — "Context docs" block rendered in edit mode only.
// All data is fetched via hooks; no raw fetch calls; no useMemo (arrays are
// small, derivations are cheap). Filter is purely client-side (AC-11).
// ---------------------------------------------------------------------------

interface SkillContextSectionProps {
  skillId: string;
}

function SkillContextSection({ skillId }: SkillContextSectionProps) {
  const t = useTranslations("skills");
  const [filter, setFilter] = React.useState("");

  const { data: allDocs = [] } = useWorkspaceContextDocs();
  const { data: skillDocs = [] } = useSkillContextDocs(skillId);
  const setDocs = useSetSkillContextDocs(skillId);

  // O(1) attachment lookup — derived inline (small array, no memoization needed)
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
      ? "\n" + attachedDocs.map((d) => `• ${d.relative_path}`).join("\n")
      : "");

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20, marginTop: 4, marginBottom: 4 }}>
      {/* Heading + "N attached" chip */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
          {t("contextSection.heading")}
        </span>
        <Badge>{t("contextSection.nAttached", { count: attachedDocs.length })}</Badge>
      </div>

      {/* Path filter — client-side only */}
      <div style={{ marginBottom: 10 }}>
        <TextInput
          value={filter}
          onChange={setFilter}
          placeholder={t("contextSection.filterPlaceholder")}
        />
      </div>

      {/* Checkbox list */}
      {allDocs.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "8px 0" }}>
          {t("contextSection.empty")}
        </p>
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}
        >
          {filteredDocs.map((doc) => (
            <div
              key={`${doc.repo_id}:${doc.relative_path}`}
              style={{ display: "flex", alignItems: "center", gap: 10 }}
            >
              <Checkbox checked={isAttached(doc)} onChange={() => handleToggle(doc)} />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  flex: 1,
                  color: "var(--text-primary)",
                  wordBreak: "break-all",
                }}
              >
                {doc.relative_path}
              </span>
              <CategoryBadge category={doc.category} />
            </div>
          ))}
        </div>
      )}

      {/* SERIALIZES AS — pre-formatted prompt preview, client-derived (AC-13) */}
      <div style={{ marginTop: 14 }}>
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

// ---------------------------------------------------------------------------
// SkillEditor — main form component
// ---------------------------------------------------------------------------

interface Props {
  mode: Mode;
  skillId?: string;
}

export function SkillEditor({ mode, skillId }: Props) {
  const t = useTranslations("skills");
  const router = useRouter();
  const isEdit = mode === "edit";
  const { data: existing, isLoading, isError, refetch } = useSkill(isEdit ? skillId : undefined);
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const toggle = useToggleSkillEnabled();

  const [form, setForm] = React.useState(EMPTY);
  const [bodyTab, setBodyTab] = React.useState<"edit" | "preview">("edit");

  // Hydrate the form from the loaded skill once (and on identity change).
  React.useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name,
        description: existing.description,
        type: existing.type,
        body: existing.body,
      });
    }
  }, [existing]);

  async function handleSave() {
    if (!form.name.trim() || !form.description.trim() || !form.body.trim()) return;
    if (isEdit && existing) {
      await update.mutateAsync({ id: existing.id, patch: form });
    } else {
      const created = await create.mutateAsync(form);
      router.replace(`/skills/${created.id}`);
      return;
    }
    router.push("/skills");
  }

  async function handleDelete() {
    if (!isEdit || !existing) return;
    if (!window.confirm(`Delete skill "${existing.name}"? This cannot be undone.`)) return;
    await del.mutateAsync(existing.id);
    router.push("/skills");
  }

  const saving = create.isPending || update.isPending;
  const dirty =
    !isEdit ||
    !existing ||
    form.name !== existing.name ||
    form.description !== existing.description ||
    form.type !== existing.type ||
    form.body !== existing.body;
  const canSave = !!form.name.trim() && !!form.description.trim() && !!form.body.trim() && dirty;

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills"), href: "/skills" }, { label: isEdit ? existing?.name ?? t("detail.crumbSkill") : "New" }]}>
      <div style={s.page}>
        <div style={s.header}>
          <button style={s.back} onClick={() => router.push("/skills")}>
            {t("detail.back")}
          </button>
        </div>

        {isEdit && isLoading && <Skeleton height={400} />}
        {isEdit && isError && <ErrorState body={t("detail.loadError")} onRetry={() => refetch()} />}
        {(!isEdit || existing) && (
          <>
            <div style={{ ...s.header, marginTop: 0 }}>
              <Icon.Sparkles size={20} style={{ color: "var(--accent)" }} />
              <div style={s.title}>{isEdit ? existing!.name : "New skill"}</div>
              {isEdit && existing && (
                <div style={s.metaRow}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    {t("preview.version", { version: existing.version })}
                  </span>
                  <Toggle
                    on={existing.enabled}
                    onChange={(enabled) => toggle.mutate({ id: existing.id, enabled })}
                    size={14}
                  />
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    {existing.enabled ? t("preview.enabled") : t("preview.disabled")}
                  </span>
                </div>
              )}
            </div>

            <FormField label="Name" required>
              <TextInput value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            </FormField>

            <FormField
              label="Description (interface)"
              required
              hint="Imperative tone — what the skill makes the agent do. The agent reads this when picking it."
            >
              <TextInput
                value={form.description}
                onChange={(v) => setForm({ ...form, description: v })}
              />
            </FormField>

            <FormField label="Type">
              <SelectInput
                value={form.type}
                onChange={(v) => setForm({ ...form, type: v as SkillType })}
                options={TYPE_OPTIONS}
              />
            </FormField>

            <FormField
              label="Body (markdown)"
              hint={t("preview.bodyHint")}
              right={<span style={s.tokenCounter}>~{approxTokens(form.body)} tokens</span>}
            >
              <div style={s.bodyTabs}>
                <button style={s.bodyTab(bodyTab === "edit")} onClick={() => setBodyTab("edit")}>
                  Edit
                </button>
                <button style={s.bodyTab(bodyTab === "preview")} onClick={() => setBodyTab("preview")}>
                  Preview
                </button>
              </div>
              {bodyTab === "edit" ? (
                <Textarea
                  mono
                  rows={14}
                  value={form.body}
                  onChange={(v) => setForm({ ...form, body: v })}
                  placeholder={"# Rule\nDescribe the rule…"}
                />
              ) : (
                <div style={s.preview}>
                  {form.body.trim().length > 0 ? (
                    <Markdown>{form.body}</Markdown>
                  ) : (
                    <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Nothing to preview yet.</div>
                  )}
                </div>
              )}
            </FormField>

            {/* Context docs section — edit mode only (skill must exist to have an ID) */}
            {isEdit && existing && <SkillContextSection skillId={existing.id} />}

            <div style={s.footer}>
              {isEdit && (
                <Button kind="danger" size="sm" icon="Trash" onClick={handleDelete} disabled={del.isPending}>
                  Delete
                </Button>
              )}
              <div style={{ flex: 1 }} />
              <Button kind="secondary" size="sm" onClick={() => router.push("/skills")}>
                Cancel
              </Button>
              <Button kind="primary" size="sm" disabled={!canSave || saving} onClick={handleSave}>
                {saving ? "Saving…" : isEdit ? "Save" : "Create skill"}
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
