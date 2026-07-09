"use client";

/* Route: /multi-agent-review — Configure run page. Thin route entry; all UI
   and state live in ConfigureRunPage. Must be a Client Component because it
   requires interactive state (PR selection, agent checkboxes). */
import { ConfigureRunPage } from "./_components/ConfigureRunPage/ConfigureRunPage";

export default function MultiAgentReviewPage() {
  return <ConfigureRunPage />;
}
