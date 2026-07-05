/* EvalsTab.test.tsx — vitest+jsdom unit tests.
 *
 * Pattern mirrors SkillsTab.test.tsx:
 *  – vi.hoisted for shared mutable state
 *  – vi.mock("@/lib/hooks/evals", ...) intercepting all hook calls
 *  – NextIntlClientProvider with eval.json + agents.json messages
 *  – ToastProvider for error-toast machinery
 *
 * ACs covered:
 *  AC-10  cases render with names + statuses
 *  AC-11  empty state on []
 *  AC-24  run button disabled while batch is running
 *  AC-25  trend chart present with ≥1 done batch; absent with 0
 *  AC-26/27 compare view with deltas + flip row
 *  AC-28  cost formatting "$0.042" and "—"
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCase, EvalBatch, EvalBatchDetail } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import { ToastProvider } from "@/providers/toast";

// ---------------------------------------------------------------------------
// Shared mock state — hoisted so vi.mock() can close over them
// ---------------------------------------------------------------------------

const startBatchMutate = vi.fn();
const deleteCaseMutate = vi.fn();
const runCaseMutate = vi.fn();

type LoadState<T> = { data: T | undefined; isLoading: boolean; isError: boolean };

const hooksState = vi.hoisted(() => ({
  useEvalCases: {
    data: undefined as EvalCase[] | undefined,
    isLoading: false,
    isError: false,
  },
  useEvalBatches: {
    data: undefined as EvalBatch[] | undefined,
    isLoading: false,
    isError: false,
  },
  // Map of batchId → EvalBatchDetail returned by useEvalBatch
  batchDetails: new Map<string, EvalBatchDetail>(),
  startBatchIsPending: false,
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: (_agentId: string) => ({
    ...hooksState.useEvalCases,
    refetch: vi.fn(),
  }),
  useEvalCase: (_id: string) => ({ data: undefined, isLoading: false }),
  useEvalBatches: (_agentId: string) => ({
    ...hooksState.useEvalBatches,
  }),
  useEvalBatch: (id: string | undefined) => ({
    data: id ? hooksState.batchDetails.get(id) : undefined,
    isLoading: false,
    isError: false,
  }),
  useStartEvalBatch: (_agentId: string) => ({
    mutate: startBatchMutate,
    isPending: hooksState.startBatchIsPending,
  }),
  useDeleteEvalCase: () => ({
    mutate: deleteCaseMutate,
    isPending: false,
  }),
  useRunEvalCase: () => ({
    mutate: runCaseMutate,
    isPending: false,
  }),
  useCreateEvalCase: () => ({ mutate: vi.fn() }),
  useUpdateEvalCase: () => ({ mutate: vi.fn() }),
  useCreateEvalCaseFromFinding: () => ({ mutate: vi.fn() }),
}));

// Import AFTER mock (vi.mock is hoisted, but the import below must come after
// the mock call in source order so the factory runs first).
import { EvalsTab } from "./EvalsTab";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT: Agent = {
  id: "agent1",
  name: "Test Agent",
  description: "A test agent",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

const CASE_1: EvalCase = {
  id: "case1",
  owner_kind: "agent",
  owner_id: "agent1",
  name: "stripe-key-leak",
  input_diff: "--- a/config.ts\n+++ b/config.ts",
  input_files: null,
  input_meta: null,
  expected_output: {
    type: "must_find",
    file: "src/config.ts",
    start_line: 10,
    end_line: 10,
  },
  notes: null,
};

const CASE_2: EvalCase = {
  id: "case2",
  owner_kind: "agent",
  owner_id: "agent1",
  name: "no-console-log",
  input_diff: "--- a/app.ts\n+++ b/app.ts",
  input_files: null,
  input_meta: null,
  expected_output: {
    type: "must_not_flag",
    file: "src/app.ts",
    start_line: 5,
    end_line: 7,
  },
  notes: null,
};

const BATCH_DONE_1: EvalBatch = {
  id: "batch1",
  agent_id: "agent1",
  workspace_id: "ws1",
  status: "done",
  agent_version: 3,
  system_prompt: "You are a reviewer.",
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
  created_at: "2024-01-02T10:00:00Z",
  finished_at: "2024-01-02T10:01:00Z",
};

const BATCH_DONE_2: EvalBatch = {
  id: "batch2",
  agent_id: "agent1",
  workspace_id: "ws1",
  status: "done",
  agent_version: 2,
  system_prompt: "You are a reviewer.",
  provider: "openai",
  model: "gpt-4.1",
  strategy: "single-pass",
  skill_bodies: null,
  cases_total: 2,
  cases_passed: 1,
  recall: 0.7,
  precision: 0.8,
  citation_accuracy: 0.6,
  cost_usd: null,
  duration_ms: 900,
  error: null,
  created_at: "2024-01-01T10:00:00Z",
  finished_at: "2024-01-01T10:01:00Z",
};

const BATCH_RUNNING: EvalBatch = {
  ...BATCH_DONE_1,
  id: "batch-running",
  status: "running",
  recall: null,
  precision: null,
  citation_accuracy: null,
  cost_usd: null,
  cases_passed: null,
  finished_at: null,
};

const BATCH_DETAIL_1: EvalBatchDetail = {
  batch: BATCH_DONE_1,
  runs: [
    {
      id: "run1",
      case_id: "case1",
      case_name: "stripe-key-leak",
      batch_id: "batch1",
      ran_at: "2024-01-02T10:00:30Z",
      pass: true,
      actual_output: null,
      recall: 0.9,
      precision: 0.85,
      citation_accuracy: 0.95,
      duration_ms: 600,
      cost_usd: 0.021,
    },
    {
      id: "run2",
      case_id: "case2",
      case_name: "no-console-log",
      batch_id: "batch1",
      ran_at: "2024-01-02T10:00:50Z",
      pass: false,
      actual_output: null,
      recall: 0.9,
      precision: 0.85,
      citation_accuracy: 0.95,
      duration_ms: 600,
      cost_usd: 0.021,
    },
  ],
};

const BATCH_DETAIL_2: EvalBatchDetail = {
  batch: BATCH_DONE_2,
  runs: [
    {
      id: "run3",
      case_id: "case1",
      case_name: "stripe-key-leak",
      batch_id: "batch2",
      ran_at: "2024-01-01T10:00:30Z",
      // FLIP: batch1 had pass=true, batch2 has pass=false
      pass: false,
      actual_output: null,
      recall: 0.7,
      precision: 0.8,
      citation_accuracy: 0.6,
      duration_ms: 500,
      cost_usd: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ eval: evalMessages, agents: agentsMessages }}
    >
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

function setHappyPath() {
  hooksState.useEvalCases = {
    data: [CASE_1, CASE_2],
    isLoading: false,
    isError: false,
  };
  hooksState.useEvalBatches = {
    data: [BATCH_DONE_1],
    isLoading: false,
    isError: false,
  };
  hooksState.batchDetails.clear();
  hooksState.batchDetails.set("batch1", BATCH_DETAIL_1);
  hooksState.startBatchIsPending = false;
}

beforeEach(() => {
  setHappyPath();
});

afterEach(() => {
  cleanup();
  startBatchMutate.mockClear();
  deleteCaseMutate.mockClear();
  runCaseMutate.mockClear();
});

// ---------------------------------------------------------------------------
// AC-10: cases render with names + statuses
// ---------------------------------------------------------------------------

describe("EvalsTab — AC-10: cases render with names and statuses", () => {
  it("renders case names from useEvalCases", () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("no-console-log")).toBeInTheDocument();
  });

  it("shows 'passed' badge for case1 (pass=true in latestDone) and 'failed' for case2 (pass=false)", () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    // stripe-key-leak → pass=true in batch1 → "passed"
    const statusCase1 = screen.getByTestId("case-status-case1");
    expect(statusCase1).toHaveTextContent(/passed/i);
    // no-console-log → pass=false in batch1 → "failed"
    const statusCase2 = screen.getByTestId("case-status-case2");
    expect(statusCase2).toHaveTextContent(/failed/i);
  });

  it("shows expectation type chips", () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText("must_find")).toBeInTheDocument();
    expect(screen.getByText("must_not_flag")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-11: empty state on []
// ---------------------------------------------------------------------------

describe("EvalsTab — AC-11: empty state when no cases", () => {
  it("shows the empty-state message when useEvalCases returns []", () => {
    hooksState.useEvalCases = { data: [], isLoading: false, isError: false };
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByTestId("cases-empty")).toBeInTheDocument();
    expect(screen.getByText(evalMessages.evalsTab.emptyCases)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-24: run button disabled while a batch is running
// ---------------------------------------------------------------------------

describe("EvalsTab — AC-24: run button disabled while running", () => {
  it("disables the run button when a batch has status='running'", () => {
    hooksState.useEvalBatches = {
      data: [BATCH_RUNNING, BATCH_DONE_1],
      isLoading: false,
      isError: false,
    };
    renderWithIntl(<EvalsTab agent={AGENT} />);
    const runBtn = screen.getByRole("button", { name: /running/i });
    expect(runBtn).toBeDisabled();
  });

  it("disables the run button while startBatch.isPending", () => {
    hooksState.startBatchIsPending = true;
    renderWithIntl(<EvalsTab agent={AGENT} />);
    const runBtn = screen.getByRole("button", { name: /running/i });
    expect(runBtn).toBeDisabled();
  });

  it("enables the run button when no batch is running", () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    // Button shows "Run eval (N)" and should be enabled
    const runBtn = screen.getByRole("button", { name: /run eval/i });
    expect(runBtn).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// AC-25: trend chart present with ≥1 done batch; absent with 0
// ---------------------------------------------------------------------------

describe("EvalsTab — AC-25: trend chart visibility", () => {
  it("renders the trend chart when there is at least one done batch", () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
  });

  it("does NOT render the trend chart when there are no done batches", () => {
    hooksState.useEvalBatches = {
      data: [],
      isLoading: false,
      isError: false,
    };
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.queryByTestId("trend-chart")).not.toBeInTheDocument();
  });

  it("does NOT render the trend chart when the only batch is running", () => {
    hooksState.useEvalBatches = {
      data: [BATCH_RUNNING],
      isLoading: false,
      isError: false,
    };
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.queryByTestId("trend-chart")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-26/27: compare view with deltas and flip row
// ---------------------------------------------------------------------------

describe("EvalsTab — AC-26/27: compare view", () => {
  beforeEach(() => {
    hooksState.useEvalBatches = {
      data: [BATCH_DONE_1, BATCH_DONE_2],
      isLoading: false,
      isError: false,
    };
    hooksState.batchDetails.set("batch1", BATCH_DETAIL_1);
    hooksState.batchDetails.set("batch2", BATCH_DETAIL_2);
  });

  it("shows CompareView with signed deltas after selecting two done runs", async () => {
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab agent={AGENT} />);

    // Initially, compare view is absent
    expect(screen.queryByTestId("compare-view")).not.toBeInTheDocument();

    // Select both done batch checkboxes
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);

    // CompareView should appear
    const compareView = screen.getByTestId("compare-view");
    expect(compareView).toBeInTheDocument();
  });

  it("shows the per-case flip row for cases where pass differs between runs", async () => {
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab agent={AGENT} />);

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);

    // case1 flipped: batch1→pass=true, batch2→pass=false
    const flipRow = screen.getByTestId("flip-row-case1");
    expect(flipRow).toBeInTheDocument();
    // "pass" in baseline col, "fail" in candidate col
    const cells = within(flipRow).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent(/pass/i);
    expect(cells[2]).toHaveTextContent(/fail/i);
  });

  it("dismisses the CompareView when Close is clicked", async () => {
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab agent={AGENT} />);

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
// AC-28: cost formatting
// ---------------------------------------------------------------------------

describe("EvalsTab — AC-28: cost formatting in RunHistory", () => {
  it('formats cost_usd=0.042 as "$0.042"', () => {
    // BATCH_DONE_1 has cost_usd=0.042
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByTestId("cost-batch1")).toHaveTextContent("$0.042");
  });

  it('formats cost_usd=null as "—"', () => {
    hooksState.useEvalBatches = {
      data: [BATCH_DONE_2], // cost_usd: null
      isLoading: false,
      isError: false,
    };
    hooksState.batchDetails.set("batch2", BATCH_DETAIL_2);
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByTestId("cost-batch2")).toHaveTextContent("—");
  });
});
