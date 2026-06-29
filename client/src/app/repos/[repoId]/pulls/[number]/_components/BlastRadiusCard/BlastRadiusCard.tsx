/* BlastRadiusCard — Overview-tab card that maps changed symbols → callers →
   endpoints/crons using the pre-built repo-intel index (zero LLM, zero tokens).

   Architecture note: the card is self-contained (fetches its own data via
   useBlast + useActiveRepo + usePullDetail) so OverviewTab needs no extra
   props and page.tsx stays unchanged.

   BR-T5 will add a GraphView + tree/graph toggle alongside SymbolRow without
   reworking this file — the tree layout is already isolated in SymbolRow. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, Badge, SectionLabel, EmptyState } from "@devdigest/ui";
import { useBlast } from "@/lib/hooks/blast";
import { usePullDetail } from "@/lib/hooks/core";
import { useActiveRepo } from "@/providers/repo-context";
import { SymbolRow } from "./SymbolRow";
import { GraphView } from "./GraphView";
import { PriorPrsSection } from "./PriorPrsSection";
import { s } from "./styles";

interface BlastRadiusCardProps {
  /** PR uuid — same id used by all other PR-scoped hooks. */
  prId: string;
}

/** Compute aggregate stats from the BlastRadius contract. */
function computeStats(data: { changed_symbols: unknown[]; downstream: Array<{ callers: unknown[]; endpoints_affected: string[]; crons_affected: string[] }> }) {
  const symbols = data.changed_symbols.length;
  const callers = data.downstream.reduce((sum, d) => sum + d.callers.length, 0);
  const endpoints = new Set(data.downstream.flatMap((d) => d.endpoints_affected)).size;
  const crons = new Set(data.downstream.flatMap((d) => d.crons_affected)).size;
  return { symbols, callers, endpoints, crons };
}

/** Badge color/label for each index status (non-'full'). */
function statusBadgeProps(status: string): { color: string; bg: string } {
  if (status === "partial") return { color: "#f5a623", bg: "#2a1e08" };
  if (status === "degraded") return { color: "#e05252", bg: "#2a0c0c" };
  return { color: "var(--text-muted)", bg: "var(--bg-hover)" };
}

export function BlastRadiusCard({ prId }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const [view, setView] = React.useState<"tree" | "graph">("tree");
  const { activeRepo } = useActiveRepo();
  const { data: pr } = usePullDetail(prId);

  const repoFullName = activeRepo?.full_name ?? null;
  const headSha = pr?.head_sha ?? null;

  const { data, isLoading } = useBlast(prId);

  if (isLoading) {
    return (
      <Card style={s.card}>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <div
          style={{
            height: 14,
            borderRadius: 4,
            background: "var(--bg-hover)",
            width: "70%",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      </Card>
    );
  }

  // Empty state: no data from the server (index not built, feature disabled, etc.)
  if (!data || data.changed_symbols.length === 0) {
    const isNotBuilt = !data;
    const isDegraded = data && (data.status === "degraded" || data.status === "failed");
    return (
      <Card style={s.card}>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>

        {/* Show a degraded/failed badge even in the "empty" case — never a blank screen. */}
        {data && data.status !== "full" && (
          <div style={s.statusBadgeRow}>
            <Badge {...statusBadgeProps(data.status)}>
              {t(`statusBadge.${data.status === "failed" ? "failed" : data.status}`)}
            </Badge>
            {data.degraded_reason && (
              <span style={s.degradedReason}>{data.degraded_reason}</span>
            )}
          </div>
        )}

        <EmptyState
          icon="Workflow"
          title={t("emptyTitle")}
          body={
            isDegraded && data.degraded_reason
              ? data.degraded_reason
              : isNotBuilt
                ? t("emptyBody")
                : t("noDownstream", { count: 0 })
          }
        />
      </Card>
    );
  }

  const stats = computeStats(data);

  // Build a quick lookup: symbol name → DownstreamImpact (server groups by symbol name).
  const downstreamBySymbol = new Map(data.downstream.map((d) => [d.symbol, d]));

  return (
    <Card style={s.card}>
      <SectionLabel icon="Workflow">{t("title")}</SectionLabel>

      {/* Partial / degraded / failed status badge */}
      {data.status !== "full" && (
        <div style={s.statusBadgeRow}>
          <Badge {...statusBadgeProps(data.status)}>
            {t(`statusBadge.${data.status === "failed" ? "failed" : data.status}`)}
          </Badge>
          {data.degraded_reason && (
            <span style={s.degradedReason}>{data.degraded_reason}</span>
          )}
        </div>
      )}

      {/* Header counts */}
      <div style={s.statRow} role="list" aria-label="Blast radius statistics">
        <StatItem value={stats.symbols} label={t("stat.symbols")} />
        <StatItem value={stats.callers} label={t("stat.callers")} />
        <StatItem value={stats.endpoints} label={t("stat.endpoints")} />
        <StatItem value={stats.crons} label={t("stat.crons")} />
      </div>

      {/* Tree / Graph segmented toggle */}
      <div style={s.viewToggle} role="group" aria-label="View mode">
        {(["tree", "graph"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            aria-pressed={view === v}
            style={{
              ...s.viewToggleBtn,
              ...(view === v ? s.viewToggleBtnActive : {}),
            }}
          >
            {t(`view.${v}`)}
          </button>
        ))}
      </div>

      {/* No downstream callers message (tree only — graph shows its own empty note) */}
      {view === "tree" && data.downstream.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px" }}>
          {t("noDownstream", { count: data.changed_symbols.length })}
        </p>
      )}

      {/* Tree view: one SymbolRow per changed symbol */}
      {view === "tree" && (
        <div style={s.symbolList} role="tree" aria-label="Changed symbols tree">
          {data.changed_symbols.map((sym, i) => (
            <SymbolRow
              key={`${sym.name}-${i}`}
              symbol={sym}
              downstream={downstreamBySymbol.get(sym.name)}
              repoFullName={repoFullName}
              headSha={headSha}
            />
          ))}
        </div>
      )}

      {/* Graph view: SVG node-link diagram */}
      {view === "graph" && (
        <GraphView data={data} repoFullName={repoFullName} headSha={headSha} />
      )}

      {/* Prior PRs collapsible */}
      <PriorPrsSection priorPrs={data.prior_prs} />
    </Card>
  );
}

/** A single stat tile (number + label). */
function StatItem({ value, label }: { value: number; label: string }) {
  return (
    <div style={s.statItem} role="listitem">
      <span style={s.statValue}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  );
}
