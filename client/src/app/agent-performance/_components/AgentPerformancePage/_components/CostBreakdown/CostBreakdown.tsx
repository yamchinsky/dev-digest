/* CostBreakdown — two cost-split donuts side by side ("By agent" / "By model").
 * PerfCostSegment carries no color, so each segment gets one from the shared
 * colorForKey palette — for cost_by_agent we resolve the agent id by name so
 * the donut slice matches that agent's table-row icon color; cost_by_model
 * has no id concept, so its segments are keyed by model label directly. */
"use client";

import { useTranslations } from "next-intl";
import { Donut } from "@devdigest/ui";
import type { AgentPerfRow, PerfCostSegment } from "@devdigest/shared";
import { colorForKey } from "../../colors";

function toDonutSegments(
  segments: PerfCostSegment[],
  keyFor: (label: string) => string,
): { label: string; value: number; color: string }[] {
  return segments.map((s) => ({ label: s.label, value: s.value, color: colorForKey(keyFor(s.label)) }));
}

export function CostBreakdown({
  costByAgent,
  costByModel,
  agents,
}: {
  costByAgent: PerfCostSegment[];
  costByModel: PerfCostSegment[];
  agents: AgentPerfRow[];
}) {
  const t = useTranslations("agentPerformance");

  const idByAgentName = new Map(agents.map((a) => [a.agent_name, a.agent_id]));
  const agentSegments = toDonutSegments(costByAgent, (label) => idByAgentName.get(label) ?? label);
  const modelSegments = toDonutSegments(costByModel, (label) => label);

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t("costBreakdownTitle")}</div>
      <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            {t("costByAgent")}
          </div>
          {agentSegments.length > 0 ? (
            <Donut segments={agentSegments} />
          ) : (
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("noCost")}</span>
          )}
        </div>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            {t("costByModel")}
          </div>
          {modelSegments.length > 0 ? (
            <Donut segments={modelSegments} />
          ) : (
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("noCost")}</span>
          )}
        </div>
      </div>
    </div>
  );
}
