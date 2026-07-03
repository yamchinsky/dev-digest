/* PrBriefCard — renders the LLM-generated PR Why + Risk Brief (SPEC-03).
   Three states: empty (no brief yet), populated, and intent-required (422 hint).
   File links in risks / review_focus navigate to ?tab=diff&file=<path>;
   the DiffTab reads that param and scrolls the matching FileCard into view. */
"use client";

import React from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, EmptyState, Skeleton } from "@devdigest/ui";
import { useBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { ApiError } from "@/services/api";
import { s } from "./styles";

/** SPA-nav guard: let modifier/aux clicks (new tab, window) reach the browser. */
function isPlainLeftClick(e: React.MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export function PrBriefCard({ prId }: { prId: string }) {
  const params = useParams<{ repoId: string; number: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations("brief");

  const { data, isLoading } = useBrief(prId);
  const generate = useGenerateBrief(prId);

  // Build the diff-tab URL for a given file path (D6).
  // Real <a href> enables middle-click / copy; onClick overrides for SPA nav.
  const diffUrl = (file: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", "diff");
    sp.set("file", file);
    return `/repos/${params.repoId}/pulls/${params.number}?${sp.toString()}`;
  };

  if (isLoading) return <Skeleton height={120} />;

  // 422 intent-required hint (AC-14).
  // IMPORTANT: MutationCache.onError in providers/index.tsx fires notify.error
  // unconditionally for ALL mutation errors (line 42: `onError: (err) =>
  // notify.error(errorMessage(err))`). There is no per-mutation suppression.
  // The 422 WILL both toast globally AND render the inline hint. This is the
  // accepted double-signal pattern — do NOT modify providers.tsx to suppress it.
  const isIntentRequired =
    generate.error instanceof ApiError &&
    generate.error.status === 422 &&
    (generate.error.details as { code?: string } | undefined)?.code === "intent_required";

  if (isIntentRequired) {
    return (
      <div style={s.card}>
        <SectionLabel icon="FileText">{t("title")}</SectionLabel>
        <EmptyState icon="FileText" title={t("empty.title")} body={t("intentRequired")} />
      </div>
    );
  }

  // Empty state — no brief yet (AC-12)
  if (!data?.brief) {
    return (
      <div style={s.card}>
        <SectionLabel icon="FileText">{t("title")}</SectionLabel>
        <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
        <Button kind="primary" loading={generate.isPending} onClick={() => generate.mutate()}>
          {t("actions.generate")}
        </Button>
      </div>
    );
  }

  // Populated brief (AC-13)
  const brief = data.brief;
  return (
    <div style={s.card}>
      <SectionLabel
        icon="FileText"
        right={
          <Button
            kind="ghost"
            size="sm"
            icon="RefreshCw"
            loading={generate.isPending}
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {t("actions.regenerate")}
          </Button>
        }
      >
        {t("title")}
      </SectionLabel>

      {/* risk_level badge */}
      <span
        style={s.riskBadge[brief.risk_level]}
        aria-label={t("a11y.riskBadge", { level: t(`riskLevel.${brief.risk_level}`) })}
      >
        {t(`riskLevel.${brief.risk_level}`)}
      </span>

      {/* What */}
      <section>
        <h3 style={s.sectionTitle}>{t("sections.what")}</h3>
        <p style={s.sectionBody}>{brief.what}</p>
      </section>

      {/* Why */}
      <section>
        <h3 style={s.sectionTitle}>{t("sections.why")}</h3>
        <p style={s.sectionBody}>{brief.why}</p>
      </section>

      {/* Risks list */}
      <section>
        <h3 style={s.sectionTitle}>{t("sections.risks")}</h3>
        <ul style={s.riskList}>
          {brief.risks.map((risk, i) => (
            <li key={i} style={s.riskItem}>
              <strong>{risk.title}</strong> — {risk.explanation}
              {risk.file_refs.length > 0 && (
                <ul style={s.fileRefList}>
                  {risk.file_refs.map((file) => (
                    <li key={file}>
                      {/* Real <a> for middle-click / copy; SPA nav via onClick */}
                      <a
                        href={diffUrl(file)}
                        style={s.fileLink}
                        aria-label={t("a11y.fileLink", { file })}
                        onClick={(e) => {
                          if (!isPlainLeftClick(e)) return; // native new-tab behavior
                          e.preventDefault();
                          router.push(diffUrl(file));
                        }}
                      >
                        {file}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Review focus list */}
      <section>
        <h3 style={s.sectionTitle}>{t("sections.reviewFocus")}</h3>
        <ol style={s.focusList}>
          {brief.review_focus.map((item, i) => (
            <li key={i} style={s.focusItem}>
              {/* Real <a> for middle-click / copy; SPA nav via onClick */}
              <a
                href={diffUrl(item.file)}
                style={s.fileLink}
                aria-label={t("a11y.fileLink", { file: item.file })}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return; // native new-tab behavior
                  e.preventDefault();
                  router.push(diffUrl(item.file));
                }}
              >
                {item.file}
                {item.line != null ? `:${item.line}` : ""}
              </a>
              {" — "}
              {item.reason}
            </li>
          ))}
        </ol>
      </section>

      {/* Usage line (AC-13) */}
      <p style={s.usage}>
        {t("usage", {
          tokensIn: brief.tokens_in,
          tokensOut: brief.tokens_out,
          costUsd: brief.cost_usd != null ? `$${brief.cost_usd.toFixed(4)}` : "—",
        })}
      </p>
    </div>
  );
}
