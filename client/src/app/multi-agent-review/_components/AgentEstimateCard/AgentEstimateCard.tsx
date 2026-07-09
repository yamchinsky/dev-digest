/* AgentEstimateCard — per-agent card with checkbox, name, description,
   and pre-run estimates (duration / cost) for the Configure run page. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Checkbox } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";

export interface AgentEstimateCardProps {
  agent: Agent;
  checked: boolean;
  onToggle: (id: string) => void;
}

export function AgentEstimateCard({ agent, checked, onToggle }: AgentEstimateCardProps) {
  const t = useTranslations("multiAgentReview");

  const durationLabel =
    agent.estimate?.duration_avg_ms != null
      ? t("estimate.duration", { s: Math.round(agent.estimate.duration_avg_ms / 1000) })
      : t("estimate.durationUnknown");

  const costLabel =
    agent.estimate?.cost_avg_usd != null
      ? t("estimate.cost", { cost: agent.estimate.cost_avg_usd.toFixed(2) })
      : t("estimate.costUnknown");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 8,
        border: "1px solid " + (checked ? "var(--accent)" : "var(--border)"),
        background: checked ? "var(--bg-elevated)" : "transparent",
        cursor: "pointer",
        transition: "border-color 0.1s",
      }}
      onClick={() => onToggle(agent.id)}
    >
      <div
        style={{ paddingTop: 2 }}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={checked}
          onChange={() => onToggle(agent.id)}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon.Cpu size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <span
            style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}
          >
            {agent.name}
          </span>
        </div>

        {agent.description && (
          <p
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {agent.description}
          </p>
        )}

        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <Badge color="var(--text-secondary)" icon="Clock">
            {durationLabel}
          </Badge>
          <Badge color="var(--text-secondary)" icon="DollarSign">
            {costLabel}
          </Badge>
        </div>
      </div>
    </div>
  );
}
