/* EvalDashboard.test.tsx — integration tests for the standalone eval dashboard.
 *
 * Coverage:
 *   – Agent selector renders and switches active agent
 *   – Metric cards render with fixture batches
 *   – Trend chart renders with ≥1 done batch; absent with 0
 *   – Empty state when no runs
 *   – Alert banner present when precision dropped; absent otherwise
 *   – Compare view opens with two selected runs
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalBatch, EvalBatchDetail, EvalCase } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import agentsMessages from "../../../../../messages/en/agents.json";

// ---------------------------------------------------------------------------
// Mock AppShell — avoid wiring the full shell in unit tests
// ---------------------------------------------------------------------------

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const startBatchMutate = vi.fn();

const hooksState = vi.hoisted(() => ({
  useAgents: {
    data: undefined as Agent[] | undefined,
    isLoading: false,
  },
  useEvalBatches: {
    data: undefined as EvalBatch[] | undefined,
    isLoading: false,
  },
  useEvalCases: {
    data: undefined as EvalCase[] | undefined,
    isLoading: false,
  },
  batchDetails: new Map<string, EvalBatchDetail>(),
  startBatchIsPending: false,
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ ...hooksState.useAgents }),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalBatches: (_id: string) => ({ ...hooksState.useEvalBatches }),
  useEvalCases: (_id: string) => ({ ...hooksState.useEvalCases }),
  useFirstAgentWithCases: (ids: string[]) => ids[0],
  useEvalBatch: (id: string | undefined) => ({
    data: id ? hooksState.batchDetails.get(id) : undefined,
    isLoading: false,
    isError: false,
  }),
  useStartEvalBatch: (_id: string) => ({
    mutate: startBatchMutate,
    isPending: hooksState.startBatchIsPending,
  }),
}));

// Import AFTER mocks are set up.
import { EvalDashboard } from "./EvalDashboard";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_A: Agent = {
  id: "agent-a",
  name: "Security Reviewer",
  description: "Checks for security issues",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Review for security.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

const AGENT_B: Agent = {
  ...AGENT_A,
  id: "agent-b",
  name: "Performance Reviewer",
  model: "gpt-4o",
};

const BATCH_DONE_1: EvalBatch = {
  id: "batch1",
  agent_id: "agent-a",
  workspace_id: "ws1",
  status: "done",
  agent_version: 3,
  system_prompt: "Review for security.",
  provider: "openai",
  model: "gpt-4.1",
  strategy: "single-pass",
  skill_bodies: null,
  cases_total: 2,
  cases_passed: 2,
  recall: 0.9,
  precision: 0.85,
  citation_accuracy: 0.95,
  cost_usd: 0.042,
  duration_ms: 1200,
  error: null,
  created_at: "2024-02-02T10:00:00Z",
  finished_at: "2024-02-02T10:01:00Z",
};

// Precision dropped from 0.85 to 0.75 → triggers alert
const BATCH_DONE_2: EvalBatch = {
  ...BATCH_DONE_1,
  id: "batch2",
  agent_version: 2,
  precision: 0.75,
  created_at: "2024-02-01T10:00:00Z",
  finished_at: "2024-02-01T10:01:00Z",
};

// Precision INCREASED → no alert
const BATCH_DONE_IMPROVED: EvalBatch = {
  ...BATCH_DONE_1,
  id: "batch3",
  agent_version: 3,
  precision: 0.95,
  created_at: "2024-02-02T10:00:00Z",
};

const DETAIL_1: EvalBatchDetail = {
  batch: BATCH_DONE_1,
  runs: [],
};

const DETAIL_2: EvalBatchDetail = {
  batch: BATCH_DONE_2,
  runs: [],
};

const CASE_1: EvalCase = {
  id: "case1",
  owner_kind: "agent",
  owner_id: "agent-a",
  name: "stripe-key-leak",
  input_diff: "--- a/config.ts\n+++ b/config.ts",
  input_files: null,
  input_meta: null,
  expected_output: { type: "must_find", file: "src/config.ts", start_line: 10, end_line: 10 },
  notes: null,
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderDashboard() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ eval: evalMessages, agents: agentsMessages }}
    >
      <EvalDashboard />
    </NextIntlClientProvider>,
  );
}

function setHappyPath() {
  hooksState.useAgents = { data: [AGENT_A, AGENT_B], isLoading: false };
  hooksState.useEvalBatches = { data: [BATCH_DONE_1], isLoading: false };
  hooksState.useEvalCases = { data: [CASE_1], isLoading: false };
  hooksState.batchDetails.clear();
  hooksState.batchDetails.set("batch1", DETAIL_1);
  hooksState.startBatchIsPending = false;
}

beforeEach(() => {
  setHappyPath();
});

afterEach(() => {
  cleanup();
  startBatchMutate.mockClear();
});

// ---------------------------------------------------------------------------
// Agent selector
// ---------------------------------------------------------------------------

describe("EvalDashboard — agent selector", () => {
  it("renders the first agent name in the header", () => {
    renderDashboard();
    expect(screen.getByRole("heading", { name: /Security Reviewer/i })).toBeInTheDocument();
  });

  it("shows a selector when multiple agents exist", () => {
    renderDashboard();
    // SelectInput renders a <select> element
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
  });

  it("updates the header when user picks a different agent", async () => {
    const user = userEvent.setup();
    renderDashboard();

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "agent-b");

    expect(screen.getByRole("heading", { name: /Performance Reviewer/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Metric cards
// ---------------------------------------------------------------------------

describe("EvalDashboard — metric cards", () => {
  it("renders RECALL, PRECISION, CITATION ACCURACY labels", () => {
    renderDashboard();
    expect(screen.getByText(evalMessages.dashboard.metrics.recall)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.metrics.precision)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.metrics.citationAccuracy)).toBeInTheDocument();
  });

  it("shows formatted metric values from the latest done batch", () => {
    renderDashboard();
    // recall=0.9 → 90.0%, precision=0.85 → 85.0%, citation=0.95 → 95.0%
    // Values may appear in both the metric cards and the RunHistory table.
    expect(screen.getAllByText("90.0%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("85.0%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("95.0%").length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Trend chart
// ---------------------------------------------------------------------------

describe("EvalDashboard — trend chart", () => {
  it("renders the trend chart when there is at least one done batch", () => {
    renderDashboard();
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
  });

  it("does NOT render the trend chart when there are no done batches", () => {
    hooksState.useEvalBatches = { data: [], isLoading: false };
    renderDashboard();
    expect(screen.queryByTestId("trend-chart")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("EvalDashboard — empty state", () => {
  it("shows the empty-state message when there are no runs at all", () => {
    hooksState.useEvalBatches = { data: [], isLoading: false };
    renderDashboard();
    expect(screen.getByTestId("no-runs")).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.noRuns)).toBeInTheDocument();
  });

  it("does NOT show empty state when there are runs", () => {
    renderDashboard();
    expect(screen.queryByTestId("no-runs")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Alert banner
// ---------------------------------------------------------------------------

describe("EvalDashboard — precision dip alert", () => {
  it("shows the alert banner when precision dropped between the two latest runs", () => {
    // BATCH_DONE_1 (latest): precision=0.85, BATCH_DONE_2 (prev): precision=0.75
    // Wait — the API returns newest-first: so BATCH_DONE_1 is latest (0.85),
    // and if BATCH_DONE_2 is older (0.75), precision actually INCREASED.
    // To trigger an alert we need: latest.precision < prev.precision.
    // Let latest = 0.75, prev = 0.85
    const latest = { ...BATCH_DONE_2, precision: 0.75, created_at: "2024-02-02T10:00:00Z" };
    const prev = { ...BATCH_DONE_1, precision: 0.85, created_at: "2024-02-01T10:00:00Z" };
    hooksState.useEvalBatches = { data: [latest, prev], isLoading: false };

    renderDashboard();
    expect(screen.getByTestId("precision-dip-alert")).toBeInTheDocument();
  });

  it("does NOT show the alert when precision improved", () => {
    // latest=0.95 > prev=0.85 → no alert
    hooksState.useEvalBatches = {
      data: [BATCH_DONE_IMPROVED, BATCH_DONE_1],
      isLoading: false,
    };
    renderDashboard();
    expect(screen.queryByTestId("precision-dip-alert")).not.toBeInTheDocument();
  });

  it("does NOT show the alert when there is only one run", () => {
    renderDashboard(); // happy path: single done batch
    expect(screen.queryByTestId("precision-dip-alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Compare view
// ---------------------------------------------------------------------------

describe("EvalDashboard — compare view", () => {
  beforeEach(() => {
    hooksState.useEvalBatches = {
      data: [BATCH_DONE_1, BATCH_DONE_2],
      isLoading: false,
    };
    hooksState.batchDetails.set("batch1", DETAIL_1);
    hooksState.batchDetails.set("batch2", DETAIL_2);
  });

  it("shows CompareView after selecting two done batch checkboxes", async () => {
    const user = userEvent.setup();
    renderDashboard();

    expect(screen.queryByTestId("compare-view")).not.toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);

    expect(screen.getByTestId("compare-view")).toBeInTheDocument();
  });

  it("dismisses CompareView when Close is clicked", async () => {
    const user = userEvent.setup();
    renderDashboard();

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);

    expect(screen.getByTestId("compare-view")).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", {
      name: evalMessages.compare.close,
    });
    await user.click(closeBtn);

    expect(screen.queryByTestId("compare-view")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Run eval button
// ---------------------------------------------------------------------------

describe("EvalDashboard — run eval button", () => {
  it("calls startBatch.mutate when Run eval is clicked", async () => {
    const user = userEvent.setup();
    renderDashboard();

    const btn = screen.getByTestId("run-eval-btn");
    await user.click(btn);

    expect(startBatchMutate).toHaveBeenCalledOnce();
  });
});
