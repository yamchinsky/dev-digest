/* SmartDiffViewer — grouped diff viewer with Smart / Original order toggle.
   Smart mode groups files by role (core → wiring → boilerplate) ordered by risk.
   Original mode shows a flat path-sorted list.
   Both modes render FileCards from @/components/diff-viewer with finding indicators. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { SmartDiff, SmartDiffRole, SmartDiffFinding, PrFile } from "@devdigest/shared";
import { FileCard } from "@/components/diff-viewer/FileCard";
import type { LineFinding } from "@/components/diff-viewer/CodeLine";
import type { DiffCommentApi } from "@/components/diff-viewer/comments";
import { SEVERITY_RANK } from "./constants";
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

/** new-side line number → findings on that line, for in-line clickable badges. */
function lineMapFor(findings: SmartDiffFinding[]): Map<number, LineFinding[]> {
  const m = new Map<number, LineFinding[]>();
  for (const f of findings) {
    const entry: LineFinding = { id: f.id, severity: f.severity };
    const list = m.get(f.start_line);
    if (list) list.push(entry);
    else m.set(f.start_line, [entry]);
  }
  return m;
}

/** The file's most-severe finding (tie-break: lowest start_line), or null. */
function mostSevereFinding(findings: SmartDiffFinding[]): SmartDiffFinding | null {
  let best: SmartDiffFinding | null = null;
  for (const f of findings) {
    if (
      best == null ||
      SEVERITY_RANK[f.severity] > SEVERITY_RANK[best.severity] ||
      (SEVERITY_RANK[f.severity] === SEVERITY_RANK[best.severity] && f.start_line < best.start_line)
    ) {
      best = f;
    }
  }
  return best;
}

function SmartDiffFileRow({
  smartFile,
  prFile,
  commenting,
  onOpenFinding,
  t,
}: {
  smartFile: { path: string; finding_lines: number[]; findings: SmartDiffFinding[] };
  prFile: PrFile;
  commenting?: DiffCommentApi;
  /** Navigate to the Findings tab and open the clicked finding's card. */
  onOpenFinding?: (findingId: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const hasFindings = smartFile.findings.length > 0;

  // Files with findings start open; others start collapsed.
  const [open, setOpen] = React.useState(hasFindings);

  // new-side line number → findings on that line, for in-line clickable badges.
  const findingsByLine = React.useMemo(() => lineMapFor(smartFile.findings), [smartFile.findings]);

  // Aggregated header badge: deep-links to the file's most-severe finding.
  const headerTarget = React.useMemo(() => mostSevereFinding(smartFile.findings), [smartFile.findings]);

  const badge =
    hasFindings && headerTarget ? (
      <FindingIndicator
        count={smartFile.findings.length}
        ariaLabel={t("findingsBadge", { count: smartFile.findings.length })}
        onClick={() => onOpenFinding?.(headerTarget.id)}
      />
    ) : undefined;

  return (
    <FileCard
      file={prFile}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      commenting={commenting}
      badge={badge}
      findingsByLine={findingsByLine}
      onFindingClick={onOpenFinding}
    />
  );
}

// ---- Main component ---------------------------------------------------

export interface SmartDiffViewerProps {
  smartDiff: SmartDiff;
  /** PrFile list that carries the actual patches (not available on smartDiff). */
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Clicking a severity badge navigates to the Findings tab and opens this id. */
  onOpenFinding?: (findingId: string) => void;
}

export function SmartDiffViewer({ smartDiff, files, commenting, onOpenFinding }: SmartDiffViewerProps) {
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
                        onOpenFinding={onOpenFinding}
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
            <FileCard
              key={sf.path}
              file={prFile}
              commenting={commenting}
              findingsByLine={lineMapFor(sf.findings)}
              onFindingClick={onOpenFinding}
            />
          ))}
        </div>
      )}
    </div>
  );
}
