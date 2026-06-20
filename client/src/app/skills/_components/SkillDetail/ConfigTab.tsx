/* ConfigTab — name / description / type / body editor for one skill. Body has
 *  an Edit/Preview toggle so the user can see how the markdown will render in
 *  the trace + drawer without leaving the page. Saving a changed body bumps
 *  version (server side) and writes a new row to skill_versions. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  TextInput,
  SelectInput,
  Textarea,
  FormField,
  Markdown,
} from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { s } from "./styles";

const TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "rubric" },
  { value: "convention", label: "convention" },
  { value: "security", label: "security" },
  { value: "custom", label: "custom" },
];

function approxTokens(body: string): number {
  return Math.max(1, Math.round(body.length / 4));
}

export function ConfigTab({ skill, onDelete }: { skill: Skill; onDelete: () => void }) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const [form, setForm] = React.useState({
    name: skill.name,
    description: skill.description,
    type: skill.type,
    body: skill.body,
  });
  const [bodyTab, setBodyTab] = React.useState<"edit" | "preview">("edit");

  // Switching skills swaps the parent's `skill` prop; reset local form to
  // match the newly-selected skill. (We could `key={skill.id}` higher up, but
  // useEffect keeps state if the user is editing live and a refetch refreshes
  // the skill object with identical contents.)
  React.useEffect(() => {
    setForm({
      name: skill.name,
      description: skill.description,
      type: skill.type,
      body: skill.body,
    });
  }, [skill.id, skill.version]);

  const dirty =
    form.name !== skill.name ||
    form.description !== skill.description ||
    form.type !== skill.type ||
    form.body !== skill.body;
  const canSave = !!form.name.trim() && !!form.description.trim() && !!form.body.trim() && dirty;

  async function handleSave() {
    if (!canSave) return;
    await update.mutateAsync({ id: skill.id, patch: form });
  }

  return (
    <div style={s.pane}>
      <div style={s.sectionTitle}>Configuration</div>

      <FormField label="Name" required>
        <TextInput value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
      </FormField>

      <FormField
        label="Description (interface)"
        required
        hint="Write as a directive — what this skill instructs the agent to do."
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
        label="Skill body (Markdown)"
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

      <div style={s.footer}>
        <Button kind="danger" size="sm" icon="Trash" onClick={onDelete}>
          Delete
        </Button>
        <div style={{ flex: 1 }} />
        <Button kind="primary" size="sm" disabled={!canSave || update.isPending} onClick={handleSave}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
