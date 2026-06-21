/* VersionsTab — history of body snapshots from skill_versions.
 *  Each row shows the snapshot's body OR its diff against the current
 *  version. The most recent snapshot is highlighted "current"; older rows
 *  get a Restore button — clicking it issues a PUT /skills/:id with that
 *  body, which the server snapshots as the next version (so restore is
 *  itself an audit trail, not a destructive rollback). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton, ErrorState } from "@devdigest/ui";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill } from "@/lib/hooks/skills";
import { diffLines, diffStats } from "./diff";
import { s } from "./styles";

type View = "body" | "diff";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const update = useUpdateSkill();
  const [restoring, setRestoring] = React.useState<number | null>(null);

  if (isLoading) {
    return (
      <div style={s.pane}>
        <Skeleton height={160} />
      </div>
    );
  }
  if (isError) {
    return (
      <div style={s.pane}>
        <ErrorState body={t("detail.loadError")} onRetry={() => refetch()} />
      </div>
    );
  }

  const versions = (data ?? []).slice().reverse(); // newest first
  // The current body lives on the skill row, not in skill_versions for the
  // top revision necessarily — but in practice they match, since update()
  // snapshots the new body into skill_versions. Use the skill row as ground
  // truth so diffs aren't off-by-one if the snapshot insert ever lags.
  const currentBody = skill.body;
  const currentVersion = skill.version;

  async function restore(v: SkillVersion) {
    if (!window.confirm(`Restore body from v${v.version}? This will save as v${currentVersion + 1}.`)) {
      return;
    }
    setRestoring(v.version);
    try {
      await update.mutateAsync({ id: skill.id, patch: { body: v.body } });
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div style={s.pane}>
      <div style={s.sectionTitle}>
        Version history ({versions.length})
      </div>
      {versions.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
          No snapshots yet — saving a body change will record one.
        </div>
      )}
      {versions.map((v) => (
        <VersionRow
          key={v.version}
          version={v}
          isCurrent={v.version === currentVersion}
          currentBody={currentBody}
          onRestore={() => restore(v)}
          restoring={restoring === v.version}
        />
      ))}
    </div>
  );
}

function VersionRow({
  version,
  isCurrent,
  currentBody,
  onRestore,
  restoring,
}: {
  version: SkillVersion;
  isCurrent: boolean;
  currentBody: string;
  onRestore: () => void;
  restoring: boolean;
}) {
  const [view, setView] = React.useState<View>(isCurrent ? "body" : "diff");
  const lines = React.useMemo(
    () => (view === "diff" ? diffLines(version.body, currentBody) : null),
    [view, version.body, currentBody],
  );
  const stats = React.useMemo(
    () => (lines ? diffStats(lines) : null),
    [lines],
  );

  return (
    <div style={s.versionRow(isCurrent)}>
      <div style={s.versionNumber}>v{version.version}</div>
      <div style={s.versionMeta}>
        <div style={s.versionTopRow}>
          <span style={s.versionDate}>{new Date(version.created_at).toLocaleString()}</span>
          {isCurrent && <span style={s.currentBadge}>current</span>}
          {!isCurrent && stats && (
            <span style={s.diffStats}>
              <span style={s.diffPlus}>+{stats.adds}</span>{" "}
              <span style={s.diffMinus}>-{stats.dels}</span> vs current
            </span>
          )}
          <div style={s.versionActions}>
            <div style={s.viewToggle}>
              <button style={s.viewToggleBtn(view === "body")} onClick={() => setView("body")}>
                Body
              </button>
              {!isCurrent && (
                <button style={s.viewToggleBtn(view === "diff")} onClick={() => setView("diff")}>
                  Diff
                </button>
              )}
            </div>
            {!isCurrent && (
              <Button
                kind="secondary"
                size="sm"
                icon="History"
                onClick={onRestore}
                disabled={restoring}
              >
                {restoring ? "Restoring…" : "Restore"}
              </Button>
            )}
          </div>
        </div>

        {view === "body" || !lines ? (
          <div style={s.versionBody}>{version.body}</div>
        ) : (
          <div style={s.diffBlock} aria-label="Diff vs current">
            {lines.map((l, i) => (
              <div key={i} style={s.diffLine(l.kind)}>
                <span style={s.diffPrefix}>
                  {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
                </span>
                <span style={s.diffText}>{l.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
