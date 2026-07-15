/* Route: /agent-performance — cross-agent leaderboard (global, not per-repo). */
import type { Metadata } from "next";
import { AgentPerformancePage } from "./_components/AgentPerformancePage";

export const metadata: Metadata = {
  title: "Agent Performance · DevDigest",
};

export default function AgentPerformanceRoute() {
  return <AgentPerformancePage />;
}
