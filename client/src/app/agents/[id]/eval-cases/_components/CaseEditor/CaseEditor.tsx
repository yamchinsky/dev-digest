/* CaseEditor — standalone form for creating or editing an eval case.
   Covers AC-7 (all fields) and AC-8 (client-side start_line/end_line validation).
   DOES NOT import from AgentEditor; fully independent. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  SelectInput,
  Tabs,
  TextInput,
  Textarea,
} from "@devdigest/ui";
import {
  useCreateEvalCase,
  useRunEvalCase,
  useUpdateEvalCase,
} from "@/lib/hooks/evals";
import type { EvalCase } from "@devdigest/shared";
import { DiffPreview } from "./DiffPreview";

export interface CaseEditorProps {
  agentId: string;
  /** Present when editing an existing case; absent when creating a new one. */
  caseId?: string;
  initialValues?: EvalCase;
}

type InputTab = "diff" | "prMeta";

// ---------------------------------------------------------------------------
// Helpers to safely parse unknown JSON fields stored in EvalCase
// ---------------------------------------------------------------------------

function asMeta(v: unknown): { title: string; body: string } {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const r = v as Record<string, unknown>;
    return {
      title: typeof r["title"] === "string" ? r["title"] : "",
      body: typeof r["body"] === "string" ? r["body"] : "",
    };
  }
  return { title: "", body: "" };
}

function asExpected(v: unknown): {
  type: string;
  file: string;
  start_line: string;
  end_line: string;
  note: string;
} {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const r = v as Record<string, unknown>;
    return {
      type: typeof r["type"] === "string" ? r["type"] : "must_find",
      file: typeof r["file"] === "string" ? r["file"] : "",
      start_line:
        typeof r["start_line"] === "number" ? String(r["start_line"]) : "",
      end_line:
        typeof r["end_line"] === "number" ? String(r["end_line"]) : "",
      note: typeof r["note"] === "string" ? r["note"] : "",
    };
  }
  return { type: "must_find", file: "", start_line: "", end_line: "", note: "" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CaseEditor({ agentId, caseId, initialValues }: CaseEditorProps) {
  const t = useTranslations("eval");
  const router = useRouter();

  // ---- Name ----
  const [name, setName] = React.useState(initialValues?.name ?? "");

  // ---- Input tabs ----
  const [inputTab, setInputTab] = React.useState<InputTab>("diff");
  const [diff, setDiff] = React.useState(initialValues?.input_diff ?? "");
  const [showPreview, setShowPreview] = React.useState(false);

  const meta = asMeta(initialValues?.input_meta);
  const [prTitle, setPrTitle] = React.useState(meta.title);
  const [prBody, setPrBody] = React.useState(meta.body);

  // ---- Expected output ----
  const exp = asExpected(initialValues?.expected_output);
  const [expType, setExpType] = React.useState(exp.type);
  const [expFile, setExpFile] = React.useState(exp.file);
  const [startLine, setStartLine] = React.useState(exp.start_line);
  const [endLine, setEndLine] = React.useState(exp.end_line);
  const [expNote, setExpNote] = React.useState(exp.note);

  // ---- Validation ----
  const [lineError, setLineError] = React.useState<string | null>(null);

  // ---- Mutations ----
  const create = useCreateEvalCase();
  const update = useUpdateEvalCase();
  const run = useRunEvalCase();

  const isSaving = create.isPending || update.isPending;
  const isRunning = run.isPending;

  // ---- Handlers ----
  const handleSave = () => {
    const sl = parseInt(startLine, 10);
    const el = parseInt(endLine, 10);

    if (!isNaN(sl) && !isNaN(el) && sl > el) {
      setLineError("start_line must be ≤ end_line");
      return;
    }
    setLineError(null);

    const payload = {
      owner_kind: "agent" as const,
      owner_id: agentId,
      name,
      input_diff: diff,
      input_meta: { title: prTitle, body: prBody },
      expected_output: {
        type: expType,
        file: expFile,
        start_line: isNaN(sl) ? 1 : sl,
        end_line: isNaN(el) ? 1 : el,
        ...(expNote ? { note: expNote } : {}),
      },
    };

    if (caseId) {
      update.mutate(
        { id: caseId, patch: payload },
        {
          onSuccess: () =>
            router.push(`/agents/${agentId}?tab=evals`),
        },
      );
    } else {
      create.mutate(payload, {
        onSuccess: () =>
          router.push(`/agents/${agentId}?tab=evals`),
      });
    }
  };

  const handleRun = () => {
    if (caseId) {
      run.mutate(caseId);
    }
  };

  // ---- Run result display ----
  let runResult: React.ReactNode = null;
  if (run.isSuccess && run.data) {
    const r = run.data.result;
    const passed = r.traces_passed === r.traces_total;
    runResult = (
      <div
        style={{
          marginBottom: 16,
          padding: "10px 14px",
          borderRadius: 7,
          background: passed ? "var(--ok-bg, #052e1c)" : "var(--crit-bg, #2e0a0a)",
          border: `1px solid ${passed ? "var(--ok, #22c55e)" : "var(--crit, #ef4444)"}`,
          fontSize: 13,
          color: "var(--text-primary)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {passed
            ? t("caseEditor.lastRunPassed")
            : t("caseEditor.lastRunFailed")}
        </div>
        <div>
          {t("caseEditor.resultSummary", {
            recall: Math.round(r.recall * 100),
            precision: Math.round(r.precision * 100),
            citation: Math.round(r.citation_accuracy * 100),
            duration: (r.duration_ms / 1000).toFixed(1),
          })}
        </div>
      </div>
    );
  }

  // ---- Tabs config ----
  const inputTabs = [
    { key: "diff", label: t("caseEditor.tabs.diff") },
    { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
  ];

  const expectationTypeOptions = [
    { value: "must_find", label: t("caseEditor.expectation.mustFind") },
    { value: "must_not_flag", label: t("caseEditor.expectation.mustNotFlag") },
  ];

  return (
    <div style={{ padding: "24px 32px", maxWidth: 720 }}>
      {/* Name */}
      <FormField label={t("caseEditor.nameLabel")} required>
        <TextInput
          value={name}
          onChange={setName}
          placeholder={t("caseEditor.namePlaceholder")}
        />
      </FormField>

      {/* Input section */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 8,
          }}
        >
          {t("caseEditor.inputLabel")}
        </div>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 7,
            overflow: "hidden",
          }}
        >
          <Tabs
            tabs={inputTabs}
            value={inputTab}
            onChange={(k) => setInputTab(k as InputTab)}
            pad="0 12px"
          />
          <div style={{ padding: "12px 14px" }}>
            {inputTab === "diff" ? (
              <>
                <Textarea
                  value={diff}
                  onChange={setDiff}
                  placeholder={t("caseEditor.diffPlaceholder")}
                  rows={8}
                  mono
                />
                {diff.trim() && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() => setShowPreview(!showPreview)}
                      style={{
                        fontSize: 12,
                        color: "var(--accent)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        textDecoration: "underline",
                      }}
                    >
                      {t("caseEditor.preview")}
                    </button>
                    {showPreview && <DiffPreview content={diff} />}
                  </div>
                )}
              </>
            ) : (
              <>
                <FormField label={t("caseEditor.titleLabel")}>
                  <TextInput
                    value={prTitle}
                    onChange={setPrTitle}
                    placeholder={t("caseEditor.titlePlaceholder")}
                  />
                </FormField>
                <FormField label={t("caseEditor.bodyLabel")}>
                  <Textarea
                    value={prBody}
                    onChange={setPrBody}
                    placeholder={t("caseEditor.bodyPlaceholder")}
                    rows={5}
                  />
                </FormField>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Expected output */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 12,
          }}
        >
          {t("caseEditor.expectedOutput")}
        </div>

        <FormField label={t("caseEditor.expectation.type")}>
          <SelectInput
            value={expType}
            onChange={setExpType}
            options={expectationTypeOptions}
          />
        </FormField>

        <FormField label={t("caseEditor.expectation.file")}>
          <TextInput value={expFile} onChange={setExpFile} mono />
        </FormField>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          <FormField label={t("caseEditor.expectation.startLine")}>
            <TextInput
              value={startLine}
              onChange={setStartLine}
              type="number"
              aria-label={t("caseEditor.expectation.startLine")}
            />
          </FormField>
          <FormField label={t("caseEditor.expectation.endLine")}>
            <TextInput
              value={endLine}
              onChange={setEndLine}
              type="number"
              aria-label={t("caseEditor.expectation.endLine")}
            />
          </FormField>
        </div>

        {lineError && (
          <div
            role="alert"
            style={{
              color: "var(--crit, #ef4444)",
              fontSize: 12,
              marginTop: 4,
              marginBottom: 8,
            }}
          >
            {lineError}
          </div>
        )}

        <FormField label={t("caseEditor.expectation.note")}>
          <TextInput value={expNote} onChange={setExpNote} />
        </FormField>
      </div>

      {/* Run result */}
      {runResult}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        {caseId && (
          <Button
            kind="secondary"
            onClick={handleRun}
            loading={isRunning}
            disabled={isRunning}
          >
            {isRunning ? t("caseEditor.running") : t("caseEditor.runCase")}
          </Button>
        )}
        <Button
          kind="primary"
          onClick={handleSave}
          loading={isSaving}
          disabled={isSaving}
        >
          {isSaving ? t("caseEditor.saving") : t("caseEditor.save")}
        </Button>
      </div>
    </div>
  );
}
