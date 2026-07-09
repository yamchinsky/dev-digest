"use client";

/**
 * Multi-Agent Review — Results page.
 * URL: /multi-agent-review/results?pr=<prId>&runs=<r1,r2,...>
 *
 * This is a Client Component because it reads URL search params interactively
 * and manages all in-memory state for the results view.
 */

import React from "react";
import { useSearchParams } from "next/navigation";
import { ResultsPage } from "./_components/ResultsPage/ResultsPage";

export default function MultiAgentReviewResultsPage() {
  const searchParams = useSearchParams();

  const prId = searchParams.get("pr") ?? "";
  const runIds = searchParams.get("runs")?.split(",").filter(Boolean) ?? [];

  if (!prId || runIds.length === 0) {
    return (
      <div
        style={{
          padding: "40px 20px",
          color: "var(--text-muted)",
          fontSize: 14,
          textAlign: "center",
        }}
      >
        Missing pr or runs parameters. Navigate here from the agent picker.
      </div>
    );
  }

  return <ResultsPage prId={prId} runIds={runIds} />;
}
