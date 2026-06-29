/* SymbolRow — one expandable row per changed symbol in the blast-radius tree.
   Shows symbol name + kind badge + caller count → expands to callers (file:line
   links) + endpoint/cron badges.

   Self-contained so BR-T5 can add a GraphView alongside this TreeView without
   touching the expansion logic. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, MonoLink, Icon } from "@devdigest/ui";
import type { DownstreamImpact, ChangedSymbol } from "@devdigest/shared";
import { githubBlobUrl } from "@/utils/github-urls";
import { s } from "./styles";

interface SymbolRowProps {
  /** The changed symbol metadata (name, kind, file). */
  symbol: ChangedSymbol;
  /** The downstream entry matching this symbol, if any. */
  downstream: DownstreamImpact | undefined;
  /** owner/repo — used to build GitHub blob links for callers. */
  repoFullName: string | null | undefined;
  /** PR head SHA — pins links to the state at PR open. */
  headSha: string | null | undefined;
}

/** Kind-label badge colors — lightweight, no tokens needed. */
const KIND_COLOR: Record<string, { color: string; bg: string }> = {
  function: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  method: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  class: { color: "#b57ed6", bg: "#2e1a3a" },
  interface: { color: "#6baed6", bg: "#0f2535" },
  type: { color: "#74c476", bg: "#0e2318" },
};

function kindStyle(kind: string) {
  return KIND_COLOR[kind.toLowerCase()] ?? { color: "var(--text-muted)", bg: "var(--bg-hover)" };
}

export function SymbolRow({ symbol, downstream, repoFullName, headSha }: SymbolRowProps) {
  const t = useTranslations("blast");
  const [expanded, setExpanded] = React.useState(false);

  const callers = downstream?.callers ?? [];
  const endpoints = downstream?.endpoints_affected ?? [];
  const crons = downstream?.crons_affected ?? [];
  const hasChildren = callers.length > 0 || endpoints.length > 0 || crons.length > 0;

  const { color, bg } = kindStyle(symbol.kind);

  return (
    <div style={s.symbolRow}>
      {/* Symbol header — clickable when there are callers/effects to expand */}
      <div
        role={hasChildren ? "button" : undefined}
        tabIndex={hasChildren ? 0 : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
        onClick={hasChildren ? () => setExpanded((v) => !v) : undefined}
        onKeyDown={
          hasChildren
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded((v) => !v);
                }
              }
            : undefined
        }
        style={{
          ...s.symbolHeader,
          cursor: hasChildren ? "pointer" : "default",
        }}
      >
        {hasChildren && (
          <Icon.ChevronRight
            size={14}
            style={{
              color: "var(--text-muted)",
              transition: "transform .15s",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              flexShrink: 0,
            }}
          />
        )}
        <span style={s.symbolName}>{symbol.name}</span>
        <Badge color={color} bg={bg} style={{ flexShrink: 0, fontSize: 11 }}>
          {symbol.kind}
        </Badge>
        {callers.length > 0 && (
          <span
            style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}
            aria-label={t("callerCount", { count: callers.length })}
          >
            {t("callerCount", { count: callers.length })}
          </span>
        )}
      </div>

      {/* Expanded: callers + endpoint/cron badges */}
      {expanded && hasChildren && (
        <div style={s.callerList}>
          {callers.map((caller, i) => {
            const href =
              repoFullName && headSha
                ? githubBlobUrl(repoFullName, headSha, caller.file, caller.line)
                : undefined;
            return (
              <div key={i} style={s.callerRow}>
                <span style={s.callerName}>{caller.name}</span>
                <MonoLink href={href}>
                  {caller.file}:{caller.line}
                </MonoLink>
              </div>
            );
          })}

          {(endpoints.length > 0 || crons.length > 0) && (
            <div style={s.badgeRow}>
              {endpoints.map((ep, i) => (
                <Badge
                  key={`ep-${i}`}
                  icon="Globe"
                  color="var(--accent-text)"
                  bg="var(--accent-bg)"
                >
                  {ep}
                </Badge>
              ))}
              {crons.map((cron, i) => (
                <Badge
                  key={`cron-${i}`}
                  icon="Clock"
                  color="var(--text-muted)"
                  bg="var(--bg-hover)"
                >
                  {cron}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
