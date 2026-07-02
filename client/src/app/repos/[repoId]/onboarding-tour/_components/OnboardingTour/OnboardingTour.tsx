/* OnboardingTour.tsx — feature component for /repos/:repoId/onboarding-tour.
   Renders three page states (A: tour exists, B: no tour, C: no clone path)
   plus loading/error intermediaries. All user-facing strings go through i18n. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { useOnboardingTour, useGenerateTour } from "@/lib/hooks";
import { useActiveRepo } from "@/providers/repo-context";
import { useToast } from "@/providers/toast";

// Stable section anchor IDs (module-level constants, not recreated on render)
const SECTION_ARCHITECTURE = "section-architecture";
const SECTION_CRITICAL_PATHS = "section-critical-paths";
const SECTION_HOW_TO_RUN = "section-how-to-run";
const SECTION_READING_PATH = "section-reading-path";
const SECTION_FIRST_TASKS = "section-first-tasks";

/** index_status values that indicate an incomplete/degraded index (AC-10, AC-11). */
const INCOMPLETE_STATUSES = new Set(["degraded", "partial", "failed"]);

/** Manual relative-time formatter (date-fns is not in the client bundle). */
function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

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

  // F4: detect in-progress dedup response → info toast (not an error)
  React.useEffect(() => {
    if (
      generate.data &&
      "status" in generate.data &&
      generate.data.status === "in_progress"
    ) {
      toast.info(t("inProgress"));
    }
  }, [generate.data, toast, t]);

  // F3: repos still loading → skeleton (never interpret null activeRepo as "no clone path")
  if (!reposLoaded) {
    return <Skeleton height={400} />;
  }

  // State C: clone_path absent — direct user to clone, no Generate/Regenerate button (AC-8)
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

  // Loading tour data
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
          onClick={() => generate.mutate()}
          loading={generate.isPending}
          disabled={generate.isPending}
        >
          {t("actions.generate")}
        </Button>
      </div>
    );
  }

  // State A: tour exists (AC-6, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14)
  // badge when index was incomplete at generation time (AC-10, AC-11)
  const showBadge = INCOMPLETE_STATUSES.has(tourData.index_status_at_generation);

  const onShare = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      {/* Page header: title + subtitle + actions */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <h1 style={s.title}>{t("title")}</h1>
          <p style={s.subtitle}>
            {t("subtitle", {
              filesIndexed: tourData.files_indexed,
              timeAgo: relativeTime(tourData.generated_at),
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
          {/* AC-14: regenerate button with loading spinner */}
          <Button
            kind="secondary"
            onClick={() => generate.mutate()}
            loading={generate.isPending}
            disabled={generate.isPending}
          >
            {t("actions.regenerate")}
          </Button>
        </div>
      </div>

      {/* Mini-TOC "ON THIS PAGE" — 5 anchor links */}
      <nav aria-label="On this page" style={s.toc}>
        <span style={s.tocLabel}>ON THIS PAGE</span>
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
      <section id={SECTION_ARCHITECTURE} style={s.section}>
        <h2 style={s.sectionHeading}>{t("sections.architectureOverview")}</h2>
        <Markdown>{tourData.sections.architecture_overview}</Markdown>
      </section>

      {/* Section 2: Critical Paths */}
      <section id={SECTION_CRITICAL_PATHS} style={s.section}>
        <h2 style={s.sectionHeading}>{t("sections.criticalPaths")}</h2>
        <Markdown>{tourData.sections.critical_paths}</Markdown>
      </section>

      {/* Section 3: How to Run Locally + mandatory unverified-commands disclaimer (AC-12) */}
      <section id={SECTION_HOW_TO_RUN} style={s.section}>
        <h2 style={s.sectionHeading}>{t("sections.howToRunLocally")}</h2>
        <div role="note" style={s.disclaimer}>
          {t("howToRun.disclaimer")}
        </div>
        <Markdown>{tourData.sections.how_to_run_locally}</Markdown>
      </section>

      {/* Section 4: Guided Reading Path — rendered in server-provided order (AC-9) */}
      <section id={SECTION_READING_PATH} style={s.section}>
        <h2 style={s.sectionHeading}>{t("sections.readingPath")}</h2>
        <ol style={s.readingList}>
          {tourData.reading_path.map((item) => (
            <li key={item.file} style={s.readingItem}>
              <code style={s.monoPath}>{item.file}</code>
              <span style={s.readingDesc}> — {item.description}</span>
              {item.rank > 0 && (
                <span style={s.rankBadge}>{Math.round(item.rank)}th percentile</span>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* Section 5: First Tasks */}
      <section id={SECTION_FIRST_TASKS} style={s.section}>
        <h2 style={s.sectionHeading}>{t("sections.firstTasks")}</h2>
        <Markdown>{tourData.sections.first_tasks}</Markdown>
      </section>
    </div>
  );
}

// ── Inline styles (module-level constants — not recreated per render) ──────────
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

  section: {
    marginBottom: 36,
    scrollMarginTop: 16,
  } as React.CSSProperties,
  sectionHeading: {
    fontSize: 16,
    fontWeight: 650,
    color: "var(--text-primary)",
    margin: "0 0 12px",
    paddingBottom: 8,
    borderBottom: "1px solid var(--border)",
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

  readingList: {
    paddingLeft: 24,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } as React.CSSProperties,
  readingItem: {
    fontSize: 14,
    lineHeight: 1.5,
    color: "var(--text-primary)",
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
  } as React.CSSProperties,
  rankBadge: {
    display: "inline-block",
    marginLeft: 8,
    fontSize: 11,
    color: "var(--text-muted)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "1px 5px",
    verticalAlign: "middle",
  } as React.CSSProperties,
};
