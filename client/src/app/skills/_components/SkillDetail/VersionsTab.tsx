/* VersionsTab — read-only history of body snapshots from skill_versions.
 *  Body changes bump the skill row's `version` AND write an immutable row
 *  here, so this is the audit trail of "what rules did this skill carry on
 *  date X". Rollback is intentionally not exposed yet — design only shows
 *  a viewer; eval/CI replays read the snapshot they need by version id. */
"use client";

import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions } from "@/lib/hooks/skills";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data, isLoading, isError, refetch } = useSkillVersions(skill.id);

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
        <div key={v.version} style={s.versionRow}>
          <div style={s.versionNumber}>v{v.version}</div>
          <div style={s.versionMeta}>
            <div style={s.versionDate}>
              {new Date(v.created_at).toLocaleString()}
            </div>
            <div style={s.versionBody}>{v.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
