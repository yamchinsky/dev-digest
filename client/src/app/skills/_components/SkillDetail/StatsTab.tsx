/* StatsTab — Skills Lab stats per skill.
 *
 *  Layout matches the design (USED BY / PULL FREQUENCY / ACCEPT RATE /
 *  FINDINGS 30D cards across the top, "Agents using this skill" list below).
 *  USED BY + the agents list are real values from /skills/:id/stats. The
 *  other three cards render as honest stubs — a real number there needs
 *  per-finding skill attribution that the data model doesn't yet carry, so
 *  faking it would lie to the user about what their PR was reviewed against. */
"use client";

import { useRouter } from "next/navigation";
import { Skeleton, ErrorState, Button, Icon, Badge } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "@/lib/hooks/skills";
import { s } from "./styles";

export function StatsTab({ skill }: { skill: Skill }) {
  const router = useRouter();
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
          <div style={s.statLabel}>Used by</div>
          <div style={s.statValue}>{data.linked_agents_count}</div>
          <div style={s.statSub}>
            {data.linked_agents_count === 1 ? "agent" : "agents"}
          </div>
        </div>
        <StubStatCard label="Pull frequency" hint="How often this skill is pulled into a run." />
        <StubStatCard label="Accept rate" hint="Share of findings users accepted." />
        <StubStatCard label="Findings (30d)" hint="Count of findings traced to this skill." />
      </div>

      <div style={{ height: 28 }} />
      <div style={s.sectionTitle}>Agents using this skill</div>
      {data.linked_agents.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
          No agents link this skill yet. Open an agent and add it from its Skills tab.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.linked_agents.map((a) => (
            <div key={a.id} style={s.agentRow}>
              <Icon.Cpu size={15} style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</span>
              {!a.enabled && <Badge color="var(--text-muted)">disabled</Badge>}
              <div style={{ flex: 1 }} />
              <Button
                kind="secondary"
                size="sm"
                icon="ArrowRight"
                onClick={() => router.push(`/agents/${a.id}?tab=skills`)}
              >
                Open
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Card with the layout slot the design uses but a "—" value; clearer than
 *  hiding it (the user sees that the metric is planned, not just missing). */
function StubStatCard({ label, hint }: { label: string; hint: string }) {
  return (
    <div style={{ ...s.statCard, opacity: 0.55 }}>
      <div style={s.statLabel}>
        <Icon.Clock size={11} style={{ marginRight: 4 }} />
        {label}
      </div>
      <div style={s.statValue}>—</div>
      <div style={s.statSub}>{hint}</div>
    </div>
  );
}
