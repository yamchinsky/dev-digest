import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. Part-0 ships Config only; A1 adds Skills (linked skill set
 *  + drag-to-reorder + per-skill enable). T9 adds Context (project-context
 *  docs attached to this agent). T8 adds Evals (eval pipeline UI). Stats is
 *  the per-agent reconciliation surface for the Agent Performance dashboard
 *  — same server aggregation (GET /agents/:id/stats), rendered faithfully. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "BarChart" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "Activity" },
  { key: "ci", labelKey: "editor.tabs.ci", icon: "Cpu" },
];
