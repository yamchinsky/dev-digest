/* StatsTab — light aggregates for one skill. Currently only "linked agents"
 *  (cheap COUNT on agent_skills). Run-level metrics (hit rate, findings per
 *  run) live downstream in agent_runs and aren't yet exposed — adding them
 *  here is the natural next step but needs joins we don't ship in this pass. */
"use client";

import { Skeleton, ErrorState, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "@/lib/hooks/skills";
import { s } from "./styles";

export function StatsTab({ skill }: { skill: Skill }) {
  const { data, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isLoading) {
    return (
      <div style={s.pane}>
        <Skeleton height={120} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div style={s.pane}>
        <ErrorState body="Could not load stats." onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div style={s.pane}>
      <div style={s.sectionTitle}>Usage</div>
      <div style={s.statGrid}>
        <div style={s.statCard}>
          <div style={s.statLabel}>Linked agents</div>
          <div style={s.statValue}>{data.linked_agents_count}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            How many agents currently include this skill in their prompt.
          </div>
        </div>
        <div style={{ ...s.statCard, opacity: 0.6 }}>
          <div style={s.statLabel}>
            <Icon.Clock size={11} style={{ marginRight: 4 }} />
            Runs used in
          </div>
          <div style={s.statValue}>—</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            Coming once agent_runs surfaces per-skill attribution.
          </div>
        </div>
      </div>
    </div>
  );
}
