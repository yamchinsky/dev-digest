"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Modal, Button, TextInput, Textarea, FormField } from "@devdigest/ui";
import { ApiError } from "@/services/api";
import { useToast } from "@/providers/toast";
import {
  usePreviewBuildSkill,
  useBuildSkillFromConventions,
  type SkillPreview,
} from "@/lib/hooks/conventions";
import { s } from "./styles";

type Stage = "metadata" | "preview";

const DEFAULT_NAME = "repo-conventions";
const DEFAULT_DESCRIPTION = "Project conventions extracted from this repo.";

export function BuildSkillDialog({
  open,
  onClose,
  repoId,
  approvedCount,
  runId,
}: {
  open: boolean;
  onClose: () => void;
  repoId: string;
  approvedCount: number;
  runId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const preview = usePreviewBuildSkill(repoId);
  const build = useBuildSkillFromConventions(repoId);

  const [stage, setStage] = React.useState<Stage>("metadata");
  const [name, setName] = React.useState(DEFAULT_NAME);
  const [description, setDescription] = React.useState(DEFAULT_DESCRIPTION);
  const [previewData, setPreviewData] = React.useState<SkillPreview | null>(null);

  React.useEffect(() => {
    if (!open) {
      setStage("metadata");
      setName(DEFAULT_NAME);
      setDescription(DEFAULT_DESCRIPTION);
      setPreviewData(null);
      preview.reset();
      build.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const submitting = preview.isPending || build.isPending;

  const goPreview = () => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName || !trimmedDescription) {
      toast.error("Name and description are required");
      return;
    }
    preview.mutate(
      { name: trimmedName, description: trimmedDescription, ...(runId ? { runId } : {}) },
      {
        onSuccess: (data) => {
          setPreviewData(data);
          setStage("preview");
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Preview failed"),
      },
    );
  };

  const save = () => {
    build.mutate(
      { name: name.trim(), description: description.trim(), ...(runId ? { runId } : {}) },
      {
        onSuccess: ({ skillId }) => {
          toast.success("Skill created");
          onClose();
          router.push(`/skills/${skillId}`);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Could not create skill"),
      },
    );
  };

  const title = stage === "metadata" ? "Create skill from conventions" : "Preview skill";
  const subtitle =
    stage === "metadata"
      ? `${approvedCount} approved candidate${approvedCount === 1 ? "" : "s"} will be bundled into a new skill.`
      : previewData
        ? `${previewData.ruleCount} rules · ${previewData.fileCount} files`
        : undefined;

  return (
    <Modal
      width={720}
      title={title}
      subtitle={subtitle}
      onClose={submitting ? undefined : onClose}
      footer={
        stage === "metadata" ? (
          <div style={s.footer}>
            <Button kind="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              kind="primary"
              icon="ChevronRight"
              onClick={goPreview}
              loading={preview.isPending}
              disabled={submitting || approvedCount === 0}
            >
              Next
            </Button>
          </div>
        ) : (
          <div style={s.footer}>
            <Button kind="ghost" onClick={() => setStage("metadata")} disabled={submitting}>
              Back
            </Button>
            <Button
              kind="primary"
              icon="Check"
              onClick={save}
              loading={build.isPending}
              disabled={submitting}
            >
              Save
            </Button>
          </div>
        )
      }
    >
      <div style={s.body}>
        {stage === "metadata" ? (
          <>
            <FormField label="Name" required>
              <TextInput
                value={name}
                onChange={setName}
                placeholder="repo-conventions"
              />
            </FormField>
            <FormField label="Description" required>
              <Textarea
                value={description}
                onChange={setDescription}
                placeholder="Short summary shown in the Skills list."
              />
            </FormField>
          </>
        ) : (
          <pre style={s.preview}>{previewData?.body ?? ""}</pre>
        )}
      </div>
    </Modal>
  );
}
