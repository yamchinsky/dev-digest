"use client";

import React from "react";
import { Button } from "@devdigest/ui";
import {
  useApproveConvention,
  useRejectConvention,
  useEditConvention,
  type Convention,
} from "@/lib/hooks/conventions";
import { useActiveRepo } from "@/providers/repo-context";
import { githubBlobUrl } from "@/utils/github-urls";
import { s } from "./styles";

export function ConventionCandidateCard({
  candidate,
  repoId,
}: {
  candidate: Convention;
  repoId: string;
}) {
  const { activeRepo } = useActiveRepo();
  const approve = useApproveConvention(repoId);
  const reject = useRejectConvention(repoId);
  const edit = useEditConvention(repoId);

  const currentRule = candidate.editedRule ?? candidate.rule;
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(currentRule);

  React.useEffect(() => {
    if (!isEditing) setDraft(currentRule);
  }, [currentRule, isEditing]);

  const evidenceLabel =
    candidate.evidenceLine != null
      ? `${candidate.evidenceFile}:${candidate.evidenceLine}`
      : candidate.evidenceFile;
  const evidenceHref = activeRepo
    ? githubBlobUrl(
        activeRepo.full_name,
        activeRepo.default_branch ?? "main",
        candidate.evidenceFile,
        candidate.evidenceLine ?? undefined,
      )
    : undefined;

  const onSave = () => {
    const trimmed = draft.trim();
    if (trimmed.length < 5 || trimmed.length > 200) return;
    edit.mutate(
      { id: candidate.id, rule: trimmed },
      { onSuccess: () => setIsEditing(false) },
    );
  };

  const onCancel = () => {
    setDraft(currentRule);
    setIsEditing(false);
  };

  return (
    <div style={s.card(candidate.status)}>
      <div style={s.headerRow}>
        <span style={s.categoryBadge}>{candidate.category}</span>
        <span style={s.confidence}>{candidate.confidence.toFixed(2)}</span>
      </div>

      {isEditing ? (
        <div>
          <textarea
            style={s.textarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            aria-label="Edit rule"
          />
          <div style={s.editActions}>
            <Button
              kind="primary"
              size="sm"
              icon="Check"
              onClick={onSave}
              disabled={edit.isPending}
            >
              Save
            </Button>
            <Button kind="ghost" size="sm" onClick={onCancel} disabled={edit.isPending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div style={s.ruleRow}>
          <div style={s.ruleText}>{currentRule}</div>
          <button
            type="button"
            style={s.editButton}
            onClick={() => setIsEditing(true)}
            aria-label="Edit rule"
          >
            ✎ Edit
          </button>
        </div>
      )}

      <div style={s.evidenceRow}>
        {evidenceHref ? (
          <a
            href={evidenceHref}
            target="_blank"
            rel="noopener noreferrer"
            style={s.evidenceLink}
          >
            {evidenceLabel}
          </a>
        ) : (
          <span style={s.evidencePlain}>{evidenceLabel}</span>
        )}
      </div>

      {candidate.evidenceSnippet && (
        <pre style={s.snippet}>{candidate.evidenceSnippet}</pre>
      )}

      <div style={s.footer}>
        <Button
          kind="secondary"
          size="sm"
          icon="Check"
          active={candidate.status === "approved"}
          disabled={approve.isPending}
          onClick={() => approve.mutate(candidate.id)}
        >
          Approve
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          active={candidate.status === "rejected"}
          disabled={reject.isPending}
          onClick={() => reject.mutate(candidate.id)}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
