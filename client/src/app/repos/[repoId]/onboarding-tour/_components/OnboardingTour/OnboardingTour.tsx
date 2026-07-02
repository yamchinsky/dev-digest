/* OnboardingTour.tsx — feature component for /repos/:repoId/onboarding-tour.
   Renders three page states (A: tour exists, B: no tour, C: no clone path)
   plus loading/error intermediaries. All user-facing strings go through i18n. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Markdown,
  Skeleton,
  type LucideIcon,
} from "@devdigest/ui";
import { useOnboardingTour, useGenerateTour } from "@/lib/hooks";
import { useActiveRepo } from "@/providers/repo-context";
import { useToast } from "@/providers/toast";

// Section anchor IDs (module-level constants — not recreated on render)
const SECTION_ARCHITECTURE = "section-architecture";
const SECTION_CRITICAL_PATHS = "section-critical-paths";
const SECTION_HOW_TO_RUN = "section-how-to-run";
const SECTION_READING_PATH = "section-reading-path";
const SECTION_FIRST_TASKS = "section-first-tasks";

/** index_status values that indicate an incomplete/degraded index (AC-10, AC-11). */
const INCOMPLETE_STATUSES = new Set(["degraded", "partial", "failed"]);

/**
 * Manual relative-time formatter with i18n translations.
 * Pure computation is module-level; `t` is passed in so no English is hardcoded.
 * Uses ICU plural keys from the "time" sub-namespace of onboardingTour.json.
 */
// We accept a loose callable type to avoid coupling to next-intl's complex generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function relativeTime(isoString: string, t: (key: string, values?: any) => string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t("time.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("time.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("time.daysAgo", { count: days });
}

// ── Sub-components (PascalCase, module-level) ────────────────────────────────

interface SectionCardProps {
  id: string;
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}

/** Collapsible card with Icon + title header. Default-open (AC per design). */
function SectionCard({ id, icon: IconComp, title, children }: SectionCardProps) {
  const [open, setOpen] = React.useState(true);
  return (
    <div id={id} style={s.sectionWrap}>
      <Card pad={false} style={s.cardClip}>
        <button
          type="button"
          style={open ? s.cardHeaderOpen : s.cardHeaderClosed}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <IconComp size={16} style={s.cardIcon} />
          <span style={s.cardTitle}>{title}</span>
          {open
            ? <Icon.ChevronDown size={14} style={s.chevron} />
            : <Icon.ChevronRight size={14} style={s.chevron} />}
        </button>
        {open && <div style={s.cardBody}>{children}</div>}
      </Card>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  repoId: string;
}

export function OnboardingTour({ repoId }: Props) {
  const t = useTranslations("onboardingTour");
  const { activeRepo, reposLoaded } = useActiveRepo();
  const { data: tourData, isLoading, isError, refetch } = useOnboardingTour(repoId);
  const generate = useGenerateTour(repoId);
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);
  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);

  // F4: mutation completion is an EVENT — the in-progress dedup response is
  // handled in onSuccess of the mutate call, not in an effect watching data.
  const startGenerate = () =>
    generate.mutate(undefined, {
      onSuccess: (data) => {
        if ("status" in data && data.status === "in_progress") {
          toast.info(t("inProgress"));
        }
      },
    });

  // F3: repos still loading → skeleton (never interpret null activeRepo as "no clone path")
  if (!reposLoaded) {
    return <Skeleton height={400} />;
  }

  // State C: clone_path absent — direct user to clone, no Generate button (AC-8)
  if (!activeRepo?.clone_path) {
    return (
      <ErrorState
        title={t("noClonePath.title")}
        body={t("noClonePath.body")}
      />
    );
  }

  // F9: 5xx error from tour query → ErrorState with retry
  if (isError) {
    return (
      <ErrorState
        title={t("error.title")}
        body={t("error.body")}
        onRetry={() => refetch()}
      />
    );
  }

  if (isLoading) {
    return <Skeleton height={400} />;
  }

  // State B: no tour persisted yet, clone present (AC-7)
  if (!tourData) {
    return (
      <div style={s.emptyWrap}>
        <EmptyState
          icon="Lightbulb"
          title={t("empty.title")}
          body={t("empty.body")}
        />
        <Button
          kind="primary"
          onClick={startGenerate}
          loading={generate.isPending}
          disabled={generate.isPending}
        >
          {t("actions.generate")}
        </Button>
      </div>
    );
  }

  // State A: tour exists (AC-6, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14)

  const showBadge = INCOMPLETE_STATUSES.has(tourData.index_status_at_generation);

  const onShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can reject (permission denied / non-secure context)
      toast.error(t("copyFailed"));
    }
  };

  const copyCommand = async (cmd: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedIdx(idx);
      // Clear only this index after 2 s (ignore if another copy fired meanwhile)
      setTimeout(() => setCopiedIdx((i) => (i === idx ? null : i)), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  // By State C guard above, activeRepo is non-null and has full_name + default_branch
  const githubBase = `https://github.com/${activeRepo.full_name}/blob/${activeRepo.default_branch}`;

  return (
    <div>
      {/* Page header: title + subtitle + actions */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <h1 style={s.title}>{t("title")}</h1>
          <p style={s.subtitle}>
            {t("subtitle", {
              filesIndexed: tourData.files_indexed,
              timeAgo: relativeTime(tourData.generated_at, t),
            })}
          </p>
          {/* AC-10, AC-11: incomplete-index badge */}
          {showBadge && (
            <div role="alert" aria-live="polite" style={s.incompleteBadge}>
              {t("incompleteBadge")}
            </div>
          )}
        </div>
        <div style={s.headerActions}>
          {/* AC-13: share link with accessible "Copied!" feedback */}
          <button
            type="button"
            aria-label={t("actions.shareLink")}
            aria-live="polite"
            style={s.shareBtn}
            onClick={onShare}
          >
            {copied ? t("actions.copied") : t("actions.shareLink")}
          </button>
          {/* AC-14: regenerate button */}
          <Button
            kind="secondary"
            onClick={startGenerate}
            loading={generate.isPending}
            disabled={generate.isPending}
          >
            {t("actions.regenerate")}
          </Button>
        </div>
      </div>

      {/* Mini-TOC — 5 anchor links */}
      <nav aria-label={t("toc.aria")} style={s.toc}>
        <span style={s.tocLabel}>{t("toc.label")}</span>
        {[
          { id: SECTION_ARCHITECTURE, label: t("sections.architectureOverview") },
          { id: SECTION_CRITICAL_PATHS, label: t("sections.criticalPaths") },
          { id: SECTION_HOW_TO_RUN, label: t("sections.howToRunLocally") },
          { id: SECTION_READING_PATH, label: t("sections.readingPath") },
          { id: SECTION_FIRST_TASKS, label: t("sections.firstTasks") },
        ].map(({ id, label }) => (
          <a key={id} href={`#${id}`} style={s.tocLink}>
            {label}
          </a>
        ))}
      </nav>

      {/* Section 1: Architecture Overview */}
      <SectionCard
        id={SECTION_ARCHITECTURE}
        icon={Icon.Layers}
        title={t("sections.architectureOverview")}
      >
        <Markdown>{tourData.sections.architecture_overview}</Markdown>
      </SectionCard>

      {/* Section 2: Critical Paths — one row per {file, why} with Open link */}
      <SectionCard
        id={SECTION_CRITICAL_PATHS}
        icon={Icon.Activity}
        title={t("sections.criticalPaths")}
      >
        <div style={s.criticalList}>
          {tourData.sections.critical_paths.map((item) => (
            <div key={item.file} style={s.criticalRow}>
              <code style={s.monoPath}>{item.file}</code>
              <span style={s.criticalWhy}>{item.why}</span>
              <a
                href={`${githubBase}/${item.file}`}
                target="_blank"
                rel="noopener noreferrer"
                style={s.openLink}
              >
                {t("criticalPaths.openFile")}
              </a>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Section 3: How to Run Locally — numbered rows + per-row copy (AC-12: disclaimer first) */}
      <SectionCard
        id={SECTION_HOW_TO_RUN}
        icon={Icon.Command}
        title={t("sections.howToRunLocally")}
      >
        <div role="note" style={s.disclaimer}>
          {t("howToRun.disclaimer")}
        </div>
        <ol style={s.commandList}>
          {tourData.sections.how_to_run_locally.map((cmd, idx) => (
            <li key={idx} style={s.commandRow}>
              <span style={s.commandNum}>{idx + 1}.</span>
              <code style={s.monoCmd}>{cmd}</code>
              <button
                type="button"
                aria-label={t("howToRun.copy")}
                style={s.copyBtn}
                onClick={() => copyCommand(cmd, idx)}
              >
                {copiedIdx === idx ? t("howToRun.copied") : t("howToRun.copy")}
              </button>
            </li>
          ))}
        </ol>
      </SectionCard>

      {/* Section 4: Guided Reading Path — numbered rows in server-provided order (AC-9) */}
      <SectionCard
        id={SECTION_READING_PATH}
        icon={Icon.ListChecks}
        title={t("sections.readingPath")}
      >
        <ol style={s.readingList}>
          {tourData.reading_path.map((item, idx) => (
            <li key={item.file} style={s.readingItem}>
              <span style={s.readingNum}>{idx + 1}.</span>
              <code style={s.monoPath}>{item.file}</code>
              {item.rank > 0 && (
                <span style={s.rankBadge}>
                  {t("readingPath.rank", { rank: Math.round(item.rank) })}
                </span>
              )}
              <span style={s.readingDesc}>{item.description}</span>
            </li>
          ))}
        </ol>
      </SectionCard>

      {/* Section 5: First Tasks */}
      <SectionCard
        id={SECTION_FIRST_TASKS}
        icon={Icon.Sparkles}
        title={t("sections.firstTasks")}
      >
        <Markdown>{tourData.sections.first_tasks}</Markdown>
      </SectionCard>
    </div>
  );
}

// ── Inline styles (module-level constants — not recreated per render) ──────────

const cardHeaderBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "12px 16px",
  background: "none",
  // No `border` shorthand here: the open/closed variants swap borderBottom,
  // and mixing a shorthand with a longhand of the same property makes React
  // warn when the longhand disappears across a rerender. Longhands only.
  borderTop: "none",
  borderRight: "none",
  borderLeft: "none",
  cursor: "pointer",
  textAlign: "left",
};

const s = {
  emptyWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
  } as React.CSSProperties,

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
    gap: 16,
  } as React.CSSProperties,
  headerLeft: {
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: "0 0 4px",
  } as React.CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "0 0 4px",
  } as React.CSSProperties,
  incompleteBadge: {
    display: "inline-flex",
    marginTop: 6,
    fontSize: 12,
    fontWeight: 500,
    color: "var(--warn, #d97706)",
    background: "var(--warn-bg, rgba(217,119,6,0.08))",
    border: "1px solid var(--warn-border, rgba(217,119,6,0.25))",
    borderRadius: 5,
    padding: "3px 10px",
  } as React.CSSProperties,
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  } as React.CSSProperties,
  shareBtn: {
    fontSize: 13,
    fontWeight: 500,
    padding: "7px 13px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    cursor: "pointer",
    transition: "background .12s",
  } as React.CSSProperties,

  toc: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginBottom: 28,
    padding: "12px 16px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
  } as React.CSSProperties,
  tocLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    marginBottom: 2,
  } as React.CSSProperties,
  tocLink: {
    fontSize: 13,
    color: "var(--accent-text)",
    textDecoration: "none",
    lineHeight: "1.7",
  } as React.CSSProperties,

  // SectionCard styles
  sectionWrap: {
    marginBottom: 16,
    scrollMarginTop: 16,
  } as React.CSSProperties,
  cardClip: {
    overflow: "hidden",
  } as React.CSSProperties,
  // Header with separator (card open) — module-level constant, no per-render alloc
  cardHeaderOpen: {
    ...cardHeaderBase,
    borderBottom: "1px solid var(--border)",
  } as React.CSSProperties,
  // Same property present in both variants (transparent when closed) so the
  // rerender never REMOVES borderBottom — that's what triggered the warning.
  cardHeaderClosed: {
    ...cardHeaderBase,
    borderBottom: "1px solid transparent",
  } as React.CSSProperties,
  cardIcon: {
    color: "var(--accent-text)",
    flexShrink: 0,
  } as React.CSSProperties,
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: 650,
    color: "var(--text-primary)",
  } as React.CSSProperties,
  chevron: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } as React.CSSProperties,
  cardBody: {
    padding: "16px",
  } as React.CSSProperties,

  disclaimer: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-muted)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 12px",
    marginBottom: 12,
  } as React.CSSProperties,

  // Critical paths
  criticalList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } as React.CSSProperties,
  criticalRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } as React.CSSProperties,
  criticalWhy: {
    flex: 1,
    fontSize: 13,
    color: "var(--text-muted)",
    minWidth: 0,
  } as React.CSSProperties,
  openLink: {
    fontSize: 12,
    fontWeight: 500,
    color: "var(--accent-text)",
    textDecoration: "none",
    padding: "2px 8px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    flexShrink: 0,
  } as React.CSSProperties,

  // How to run
  commandList: {
    paddingLeft: 0,
    margin: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } as React.CSSProperties,
  commandRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } as React.CSSProperties,
  commandNum: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-muted)",
    flexShrink: 0,
    width: 20,
  } as React.CSSProperties,
  monoCmd: {
    flex: 1,
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontSize: "0.88em",
    padding: "4px 8px",
    borderRadius: 4,
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
  } as React.CSSProperties,
  copyBtn: {
    fontSize: 12,
    fontWeight: 500,
    padding: "3px 8px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-muted)",
    cursor: "pointer",
    flexShrink: 0,
    minWidth: 52,
    textAlign: "center",
  } as React.CSSProperties,

  // Reading path
  readingList: {
    paddingLeft: 0,
    margin: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } as React.CSSProperties,
  readingItem: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    flexWrap: "wrap",
    fontSize: 14,
    lineHeight: 1.5,
    color: "var(--text-primary)",
  } as React.CSSProperties,
  readingNum: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-muted)",
    flexShrink: 0,
    width: 20,
  } as React.CSSProperties,
  monoPath: {
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontSize: "0.88em",
    padding: "1px 6px",
    borderRadius: 4,
    background: "var(--bg-hover)",
    color: "var(--accent-text)",
  } as React.CSSProperties,
  readingDesc: {
    color: "var(--text-secondary)",
    flex: 1,
  } as React.CSSProperties,
  rankBadge: {
    display: "inline-block",
    fontSize: 11,
    color: "var(--text-muted)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "1px 5px",
    verticalAlign: "middle",
    flexShrink: 0,
  } as React.CSSProperties,
};
