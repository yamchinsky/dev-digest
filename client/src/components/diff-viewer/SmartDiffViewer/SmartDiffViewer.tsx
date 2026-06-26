/* SmartDiffViewer — grouped diff viewer with Smart / Original order toggle.
   Smart mode groups files by role (core → wiring → boilerplate) ordered by risk.
   Original mode shows a flat path-sorted list.
   Both modes render FileCards from @/components/diff-viewer with finding indicators. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { SmartDiff, SmartDiffRole, PrFile } from "@devdigest/shared";
import { FileCard } from "@/components/diff-viewer/FileCard";
import type { DiffCommentApi } from "@/components/diff-viewer/comments";
import { sv } from "./styles";

// ---- role config --------------------------------------------------------

interface RoleConfig {
  label: string;
  description: string;
  color: string;
}

const ROLE_COLORS: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  wiring: "var(--warn, #f59e0b)",
  boilerplate: "var(--text-muted)",
};

// ---- SplitBanner -------------------------------------------------------

function SplitBanner({
  totalLines,
  splits,
  t,
}: {
  totalLines: number;
  splits: { name: string; files: string[] }[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div style={sv.splitBanner} role="note">
      <span style={sv.splitBannerTitle}>
        {t("splitBannerTitle", { totalLines })}
      </span>
      {splits.map((s) => (
        <span key={s.name} style={sv.splitBannerItem}>
          <strong>{s.name}</strong>: {s.files.join(", ")}
        </span>
      ))}
    </div>
  );
}

// ---- Finding indicator badge ------------------------------------------

function FindingIndicator({
  count,
  ariaLabel,
  onClick,
}: {
  count: number;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="button"
      aria-label={ariaLabel}
      style={sv.findingBadge}
      onClick={(e) => {
        e.stopPropagation(); // don't also toggle the FileCard header
        onClick();
      }}
    >
      <span style={sv.findingDot} aria-hidden="true" />
      {count}
    </button>
  );
}

// ---- SmartDiffFileRow: one file in Smart mode -------------------------

function SmartDiffFileRow({
  smartFile,
  prFile,
  commenting,
  t,
}: {
  smartFile: { path: string; finding_lines: number[] };
  prFile: PrFile;
  commenting?: DiffCommentApi;
  t: ReturnType<typeof useTranslations>;
}) {
  const hasFindings = smartFile.finding_lines.length > 0;

  // Files with findings start open; others start collapsed.
  const [open, setOpen] = React.useState(hasFindings);

  function handleFindingClick() {
    const firstLine = smartFile.finding_lines[0];
    if (firstLine == null) return;
    const id = `dl:${smartFile.path}:RIGHT:${firstLine}`;

    if (!open) {
      // Expand first, then scroll on the next animation frame so the DOM is
      // painted before we try to find the element.
      setOpen(true);
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  const badge = hasFindings ? (
    <FindingIndicator
      count={smartFile.finding_lines.length}
      ariaLabel={t("findingsBadge", { count: smartFile.finding_lines.length })}
      onClick={handleFindingClick}
    />
  ) : undefined;

  return (
    <FileCard
      file={prFile}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      commenting={commenting}
      badge={badge}
    />
  );
}

// ---- Main component ---------------------------------------------------

export interface SmartDiffViewerProps {
  smartDiff: SmartDiff;
  /** PrFile list that carries the actual patches (not available on smartDiff). */
  files: PrFile[];
  commenting?: DiffCommentApi;
}

export function SmartDiffViewer({ smartDiff, files, commenting }: SmartDiffViewerProps) {
  const t = useTranslations("smartDiff");
  const [smartOrder, setSmartOrder] = React.useState(true);

  // Build a quick-lookup map from path → PrFile.
  const fileMap = React.useMemo<Map<string, PrFile>>(() => {
    const m = new Map<string, PrFile>();
    for (const f of files) m.set(f.path, f);
    return m;
  }, [files]);

  // Aggregate stats from the PrFile list.
  const { totalAdditions, totalDeletions } = React.useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const f of files) {
      additions += f.additions ?? 0;
      deletions += f.deletions ?? 0;
    }
    return { totalAdditions: additions, totalDeletions: deletions };
  }, [files]);

  // All smart-diff files, path-sorted, for Original order view.
  const allFilesSorted = React.useMemo(() => {
    const allSmartFiles = smartDiff.groups.flatMap((g) => g.files);
    return allSmartFiles
      .map((sf) => ({ sf, prFile: fileMap.get(sf.path) }))
      .filter((item): item is { sf: typeof item.sf; prFile: PrFile } => item.prFile != null)
      .sort((a, b) => a.sf.path.localeCompare(b.sf.path));
  }, [smartDiff.groups, fileMap]);

  const roleConfig = (role: SmartDiffRole): RoleConfig => ({
    label: t(`roles.${role}.label`),
    description: t(`roles.${role}.description`),
    color: ROLE_COLORS[role],
  });

  return (
    <div style={sv.container}>
      {/* ---- Header: stats + toggle ---- */}
      <div style={sv.header}>
        <span style={sv.headerSummary}>
          {t("headerSummary", {
            count: files.length,
            additions: totalAdditions,
            deletions: totalDeletions,
          })}
        </span>
        <div style={sv.toggleRow} role="group" aria-label="Diff view order">
          <button
            type="button"
            style={sv.toggleBtn(smartOrder)}
            onClick={() => setSmartOrder(true)}
            aria-pressed={smartOrder}
          >
            {t("smartOrder")}
          </button>
          <button
            type="button"
            style={{ ...sv.toggleBtn(!smartOrder), borderRight: "none" }}
            onClick={() => setSmartOrder(false)}
            aria-pressed={!smartOrder}
          >
            {t("originalOrder")}
          </button>
        </div>
      </div>

      {/* ---- Split suggestion banner (informational only) ---- */}
      {smartDiff.split_suggestion.too_big && (
        <SplitBanner
          totalLines={smartDiff.split_suggestion.total_lines}
          splits={smartDiff.split_suggestion.proposed_splits}
          t={t}
        />
      )}

      {/* ---- Smart order: grouped by role (already ordered core→wiring→boilerplate) ---- */}
      {smartOrder && (
        <div>
          {smartDiff.groups.map((group) => {
            const cfg = roleConfig(group.role);
            return (
              <div key={group.role} style={sv.groupSection}>
                <div style={sv.groupHeader}>
                  <span style={sv.groupDot(cfg.color)} aria-hidden="true" />
                  <span style={sv.groupLabel}>{cfg.label}</span>
                  <span style={sv.groupDesc}>{cfg.description}</span>
                  <span style={sv.groupCount}>
                    {t("roleFiles", { count: group.files.length })}
                  </span>
                </div>
                <div style={sv.fileList}>
                  {group.files.map((sf) => {
                    const prFile = fileMap.get(sf.path);
                    if (!prFile) return null;
                    return (
                      <SmartDiffFileRow
                        key={sf.path}
                        smartFile={sf}
                        prFile={prFile}
                        commenting={commenting}
                        t={t}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- Original order: flat path-sorted list (uncontrolled FileCards) ---- */}
      {!smartOrder && (
        <div style={sv.fileList}>
          {allFilesSorted.map(({ sf, prFile }) => (
            <FileCard key={sf.path} file={prFile} commenting={commenting} />
          ))}
        </div>
      )}
    </div>
  );
}
