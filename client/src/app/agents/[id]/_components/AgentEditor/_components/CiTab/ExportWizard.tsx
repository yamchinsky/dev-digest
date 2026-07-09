/* ExportWizard.tsx — 4-step wizard for exporting an agent to CI.
   Steps: Target → Preview → Configure → Install.

   AC coverage:
     AC-1  GHA selected + repo matches owner/name → Continue enabled
     AC-2  CircleCI/Jenkins/Generic CLI disabled with "coming soon" badge
     AC-3  blank or non-matching repo blocks Continue
     AC-4  preview shows CiFile[] list (path + contents)
     AC-5  editable file in <textarea>; non-editable in <pre>
     AC-6  DEVDIGEST_POST_AS present in workflow / absent from manifest
     AC-7  trigger checkboxes: opened+synchronize checked+disabled, reopened unchecked+enabled
     AC-8  post_as selector with 3 options; default "github_review"
     AC-9  "Open a PR" → action:'open_pr' → shows PR URL
     AC-12 "Copy as zip" → action:'files' → browser download
*/
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ExportWizardSteps, Button, Badge, Modal } from "@devdigest/ui";
import type { CiFile, CiExportInputBody } from "@devdigest/shared";
import { useExportCi } from "@/lib/hooks/ci";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_COUNT = 4;

const CI_TARGETS = [
  { key: "gha", enabled: true },
  { key: "circle", enabled: false },
  { key: "jenkins", enabled: false },
  { key: "cli", enabled: false },
] as const;

type CiTargetKey = (typeof CI_TARGETS)[number]["key"];

const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

// ---------------------------------------------------------------------------
// Inner: Preview query (fires only when step === 1)
// ---------------------------------------------------------------------------

function useCiPreview(
  agentId: string,
  input: CiExportInputBody,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["ci-preview", agentId, input.repo, input.target],
    queryFn: () =>
      api.post<{ files: CiFile[] }>(`/agents/${agentId}/export-ci`, {
        ...input,
        action: "files",
      }),
    enabled,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// ExportWizard
// ---------------------------------------------------------------------------

export function ExportWizard({
  agentId,
  agentName,
  onClose,
}: {
  agentId: string;
  agentName: string;
  onClose: () => void;
}) {
  const t = useTranslations("ci");
  const exportCi = useExportCi();

  // wizard step: 0=Target, 1=Preview, 2=Configure, 3=Install
  const [step, setStep] = React.useState(0);

  // Step 0 state
  const [selectedTarget, setSelectedTarget] =
    React.useState<CiTargetKey>("gha");
  const [repo, setRepo] = React.useState("");

  // Step 2 state — configure
  const [triggerReopened, setTriggerReopened] = React.useState(false);
  const [postAs, setPostAs] = React.useState<
    "github_review" | "pr_comment" | "none"
  >("github_review");

  // Step 1 state — preview edits (user may edit the workflow file)
  const [editedFiles, setEditedFiles] = React.useState<CiFile[]>([]);

  // Step 3 state — result
  const [prUrl, setPrUrl] = React.useState<string | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const repoValid = REPO_PATTERN.test(repo);
  const canContinueFromTarget = selectedTarget === "gha" && repoValid;

  const triggers = [
    "opened",
    "synchronize",
    ...(triggerReopened ? ["reopened"] : []),
  ];

  const previewInput: CiExportInputBody = {
    repo,
    target: "gha",
    action: "files",
    post_as: postAs,
    triggers,
  };

  // ── Preview query ─────────────────────────────────────────────────────────
  const previewQuery = useCiPreview(agentId, previewInput, step === 1);

  // When preview data arrives, initialize editedFiles
  React.useEffect(() => {
    if (previewQuery.data?.files) {
      setEditedFiles(previewQuery.data.files);
    }
  }, [previewQuery.data?.files]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function handleBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  function handleContinue() {
    setStep((s) => Math.min(STEP_COUNT - 1, s + 1));
  }

  function updateFileContents(path: string, contents: string) {
    setEditedFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, contents } : f)),
    );
  }

  function handleOpenPr() {
    exportCi.mutate(
      {
        agentId,
        input: {
          repo,
          target: "gha",
          action: "open_pr",
          post_as: postAs,
          triggers,
        },
      },
      {
        onSuccess: (data) => {
          setPrUrl(data.pr_url);
        },
      },
    );
  }

  function handleDownloadZip() {
    // Trigger download: request files and construct a simple multi-file text bundle.
    // The server returns CiFile[]; we create a blob download in the browser.
    api
      .post<{ files: CiFile[] }>(`/agents/${agentId}/export-ci`, {
        ...previewInput,
        action: "files",
      })
      .then((result) => {
        const text = (result.files ?? editedFiles)
          .map((f) => `# ${f.path}\n${f.contents}`)
          .join("\n\n---\n\n");
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `devdigest-ci-${repo.replace("/", "-")}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  // ── Step labels ───────────────────────────────────────────────────────────
  const stepLabels = [
    t("exportWizard.steps.target"),
    t("exportWizard.steps.preview"),
    t("exportWizard.steps.configure"),
    t("exportWizard.steps.install"),
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
      {step > 0 && (
        <Button kind="ghost" onClick={handleBack}>
          {t("exportWizard.back")}
        </Button>
      )}
      {step < STEP_COUNT - 1 ? (
        <Button
          kind="primary"
          onClick={handleContinue}
          disabled={step === 0 && !canContinueFromTarget}
        >
          {t("exportWizard.continue")}
        </Button>
      ) : null}
    </div>
  );

  return (
    <Modal
      width={760}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName })}
      onClose={onClose}
      footer={footer}
    >
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Step indicator */}
        <ExportWizardSteps step={step} labels={stepLabels} />

        {/* Step panels */}
        {step === 0 && (
          <StepTarget
            selectedTarget={selectedTarget}
            onSelectTarget={setSelectedTarget}
            repo={repo}
            onRepoChange={setRepo}
            repoValid={repoValid}
            t={t}
          />
        )}

        {step === 1 && (
          <StepPreview
            isLoading={previewQuery.isLoading}
            files={editedFiles}
            onEditFile={updateFileContents}
            t={t}
          />
        )}

        {step === 2 && (
          <StepConfigure
            triggerReopened={triggerReopened}
            onToggleReopened={setTriggerReopened}
            postAs={postAs}
            onPostAsChange={setPostAs}
            t={t}
          />
        )}

        {step === 3 && (
          <StepInstall
            repo={repo}
            filesCount={editedFiles.length}
            isLoading={exportCi.isPending}
            prUrl={prUrl}
            onOpenPr={handleOpenPr}
            onDownloadZip={handleDownloadZip}
            t={t}
          />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Step 0 — Target
// ---------------------------------------------------------------------------

function StepTarget({
  selectedTarget,
  onSelectTarget,
  repo,
  onRepoChange,
  repoValid,
  t,
}: {
  selectedTarget: CiTargetKey;
  onSelectTarget: (k: CiTargetKey) => void;
  repo: string;
  onRepoChange: (v: string) => void;
  repoValid: boolean;
  t: ReturnType<typeof useTranslations<"ci">>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {CI_TARGETS.map(({ key, enabled }) => {
        const isSelected = selectedTarget === key;
        const labelKey =
          `exportWizard.targets.${key}` as Parameters<typeof t>[0];
        const descKey =
          `exportWizard.targets.${key}Desc` as Parameters<typeof t>[0];

        return (
          <div
            key={key}
            onClick={() => enabled && onSelectTarget(key)}
            data-testid={`target-option-${key}`}
            role="radio"
            aria-checked={isSelected}
            aria-disabled={!enabled}
            tabIndex={enabled ? 0 : -1}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && enabled) {
                onSelectTarget(key);
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 16px",
              borderRadius: 9,
              border: `1px solid ${isSelected ? "var(--accent)" : "var(--border-strong)"}`,
              background: isSelected ? "var(--accent-bg, var(--bg-elevated))" : "var(--bg-elevated)",
              cursor: enabled ? "pointer" : "not-allowed",
              opacity: enabled ? 1 : 0.55,
              transition: "border-color .12s",
            }}
          >
            {/* Radio circle */}
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 99,
                border: `2px solid ${isSelected ? "var(--accent)" : "var(--border-strong)"}`,
                background: isSelected ? "var(--accent)" : "transparent",
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
              }}
            >
              {isSelected && (
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: "#fff",
                  }}
                />
              )}
            </div>

            {/* Text */}
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {t(labelKey)}
                {key === "gha" && (
                  <Badge color="var(--ok)" bg="var(--ok-bg, #e6f4ea)">
                    {t("exportWizard.recommended")}
                  </Badge>
                )}
                {!enabled && (
                  <span data-testid={`coming-soon-${key}`}>
                    <Badge
                      color="var(--text-muted)"
                      bg="var(--bg-hover)"
                    >
                      coming soon
                    </Badge>
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  marginTop: 2,
                }}
              >
                {t(descKey)}
              </div>
            </div>
          </div>
        );
      })}

      {/* Repo input — shown when GHA selected */}
      {selectedTarget === "gha" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {t("exportWizard.repoLabel")}
          </label>
          <input
            type="text"
            value={repo}
            onChange={(e) => onRepoChange(e.target.value)}
            placeholder={t("exportWizard.repoPlaceholder")}
            data-testid="repo-input"
            aria-label={t("exportWizard.repoLabel")}
            style={{
              padding: "9px 12px",
              borderRadius: 7,
              border: `1px solid ${repo && !repoValid ? "var(--crit)" : "var(--border-strong)"}`,
              background: "var(--bg-surface)",
              fontSize: 14,
              color: "var(--text-primary)",
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              fontSize: 12,
              color:
                repo && !repoValid ? "var(--crit)" : "var(--text-secondary)",
            }}
          >
            {t("exportWizard.repoHint")}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Preview
// ---------------------------------------------------------------------------

function StepPreview({
  isLoading,
  files,
  onEditFile,
  t,
}: {
  isLoading: boolean;
  files: CiFile[];
  onEditFile: (path: string, contents: string) => void;
  t: ReturnType<typeof useTranslations<"ci">>;
}) {
  if (isLoading) {
    return (
      <div
        style={{
          padding: "40px 0",
          textAlign: "center",
          color: "var(--text-secondary)",
          fontSize: 14,
        }}
      >
        {t("exportWizard.generating")}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div
        style={{
          padding: "40px 0",
          textAlign: "center",
          color: "var(--text-secondary)",
          fontSize: 14,
        }}
      >
        No files generated.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
        }}
      >
        {t("exportWizard.filesToCreate")}
      </div>
      {files.map((file) => (
        <div key={file.path} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            <span className="mono" style={{ fontSize: 12 }}>
              {file.path}
            </span>
            {file.editable && (
              <Badge color="var(--accent)" bg="var(--accent-bg, #eef2ff)">
                {t("exportWizard.editable")}
              </Badge>
            )}
          </div>
          {file.editable ? (
            <textarea
              aria-label={`Edit ${file.path}`}
              data-testid={`file-editor-${file.path.replace(/\//g, "-")}`}
              value={file.contents}
              onChange={(e) => onEditFile(file.path, e.target.value)}
              rows={Math.min(20, (file.contents.match(/\n/g)?.length ?? 0) + 3)}
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                padding: "10px 12px",
                borderRadius: 7,
                border: "1px solid var(--border-strong)",
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
                width: "100%",
                boxSizing: "border-box",
                resize: "vertical",
                lineHeight: 1.5,
              }}
            />
          ) : (
            <pre
              data-testid={`file-preview-${file.path.replace(/\//g, "-")}`}
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                padding: "10px 12px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-surface)",
                color: "var(--text-secondary)",
                overflowX: "auto",
                margin: 0,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {file.contents}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Configure
// ---------------------------------------------------------------------------

function StepConfigure({
  triggerReopened,
  onToggleReopened,
  postAs,
  onPostAsChange,
  t,
}: {
  triggerReopened: boolean;
  onToggleReopened: (v: boolean) => void;
  postAs: "github_review" | "pr_comment" | "none";
  onPostAsChange: (v: "github_review" | "pr_comment" | "none") => void;
  t: ReturnType<typeof useTranslations<"ci">>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Trigger section */}
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: 10,
          }}
        >
          {t("exportWizard.triggerLabel")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <CheckboxRow
            id="trigger-opened"
            label="opened"
            checked={true}
            disabled={true}
          />
          <CheckboxRow
            id="trigger-synchronize"
            label="synchronize"
            checked={true}
            disabled={true}
          />
          <CheckboxRow
            id="trigger-reopened"
            label="reopened"
            checked={triggerReopened}
            disabled={false}
            onChange={(v) => onToggleReopened(v)}
          />
        </div>
      </div>

      {/* Post-as section */}
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: 10,
          }}
        >
          {t("exportWizard.postResultsLabel")}
        </div>
        <select
          value={postAs}
          onChange={(e) =>
            onPostAsChange(
              e.target.value as "github_review" | "pr_comment" | "none",
            )
          }
          aria-label={t("exportWizard.postResultsLabel")}
          data-testid="post-as-select"
          style={{
            padding: "9px 12px",
            borderRadius: 7,
            border: "1px solid var(--border-strong)",
            background: "var(--bg-elevated)",
            fontSize: 14,
            color: "var(--text-primary)",
            cursor: "pointer",
            minWidth: 220,
          }}
        >
          <option value="github_review">{t("exportWizard.postAs.githubReview")}</option>
          <option value="pr_comment">{t("exportWizard.postAs.prComment")}</option>
          <option value="none">{t("exportWizard.postAs.none")}</option>
        </select>
      </div>
    </div>
  );
}

function CheckboxRow({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
        color: disabled ? "var(--text-muted)" : "var(--text-primary)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        data-testid={`checkbox-${label}`}
        onChange={(e) => onChange?.(e.target.checked)}
        style={{ width: 15, height: 15, cursor: disabled ? "not-allowed" : "pointer" }}
      />
      <span className="mono" style={{ fontSize: 12 }}>
        {label}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Install
// ---------------------------------------------------------------------------

function StepInstall({
  repo,
  filesCount,
  isLoading,
  prUrl,
  onOpenPr,
  onDownloadZip,
  t,
}: {
  repo: string;
  filesCount: number;
  isLoading: boolean;
  prUrl: string | null;
  onOpenPr: () => void;
  onDownloadZip: () => void;
  t: ReturnType<typeof useTranslations<"ci">>;
}) {
  const OPENROUTER_KEY = "OPENROUTER_API_KEY";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Open PR card */}
      <div
        style={{
          padding: "18px 20px",
          borderRadius: 10,
          border: "1px solid var(--border-strong)",
          background: "var(--bg-elevated)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
          {t("exportWizard.installCardTitle")}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {t("exportWizard.installCardBody", {
            repo,
            count: filesCount,
          })}
        </div>

        {prUrl ? (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="pr-url-link"
            style={{
              fontSize: 13,
              color: "var(--accent)",
              textDecoration: "underline",
            }}
          >
            {prUrl}
          </a>
        ) : (
          <Button
            kind="primary"
            icon="GitPullRequest"
            loading={isLoading}
            onClick={onOpenPr}
            data-testid="open-pr-button"
          >
            {t("exportWizard.install")}
          </Button>
        )}
      </div>

      {/* Download zip card */}
      <div
        style={{
          padding: "14px 20px",
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Copy files as a zip
        </span>
        <Button kind="secondary" icon="Upload" onClick={onDownloadZip} data-testid="download-zip-button">
          Download
        </Button>
      </div>

      {/* Secret note */}
      <div
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          padding: "10px 14px",
          borderRadius: 7,
          background: "var(--bg-hover)",
          border: "1px solid var(--border)",
        }}
      >
        {t("exportWizard.secretNote", { key: OPENROUTER_KEY })}
      </div>
    </div>
  );
}
