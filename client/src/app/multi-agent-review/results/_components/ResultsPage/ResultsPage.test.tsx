import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, ReviewRecord, FindingRecord, RunEvent } from "@devdigest/shared";
import messagesResults from "../../../../../../messages/en/multiAgentReviewResults.json";
import messagesRuns from "../../../../../../messages/en/runs.json";
import { ResultsPage } from "./ResultsPage";

// Mock hooks
vi.mock("@/lib/hooks/reviews", () => ({
  usePrRuns: vi.fn(),
  usePrReviews: vi.fn(),
  useRunEvents: vi.fn(),
  useFindingAction: vi.fn(),
}));

// Mock RunTraceDrawer so it doesn't need deep internals
vi.mock("@/components/RunTraceDrawer", () => ({
  default: ({ runId, onClose }: { runId: string; onClose: () => void }) => (
    <div data-testid="run-trace-drawer" data-run-id={runId}>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

import * as hooks from "@/lib/hooks/reviews";

afterEach(cleanup);

function makeRunSummary(id: string, name: string, status: string, overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: id,
    agent_id: `agent-${id}`,
    agent_name: name,
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status,
    error: null,
    duration_ms: 1500,
    tokens_in: 100,
    tokens_out: 50,
    findings_count: 0,
    grounding: "0/0",
    ran_at: "2026-07-09T00:00:00.000Z",
    score: 88,
    blockers: 0,
    cost_usd: 0.002,
    ...overrides,
  };
}

function makeFinding(): FindingRecord {
  return {
    id: "finding-1",
    review_id: "review-1",
    severity: "WARNING",
    category: "security",
    title: "Potential XSS",
    file: "src/render.ts",
    start_line: 5,
    end_line: 8,
    rationale: "Untrusted output rendered without escaping.",
    suggestion: "Use a sanitization library.",
    confidence: 0.85,
    kind: null,
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
  };
}

function makeReview(runId: string, findings: FindingRecord[] = []): ReviewRecord {
  return {
    id: `review-${runId}`,
    pr_id: "pr-1",
    agent_id: "agent-1",
    run_id: runId,
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "approve",
    summary: "Looks good to me.",
    score: 88,
    model: "deepseek/deepseek-v4-flash",
    grounding: "1/1 passed",
    created_at: "2026-07-09T00:00:00.000Z",
    findings,
  };
}

function setupHooks({
  runs = [] as RunSummary[],
  reviews = [] as ReviewRecord[],
  events = [] as RunEvent[],
  running = false,
  refetchReviews = vi.fn(),
} = {}) {
  vi.mocked(hooks.usePrRuns).mockReturnValue({
    data: runs,
    isLoading: false,
    error: null,
  } as ReturnType<typeof hooks.usePrRuns>);

  vi.mocked(hooks.usePrReviews).mockReturnValue({
    data: reviews,
    isLoading: false,
    error: null,
    refetch: refetchReviews,
  } as unknown as ReturnType<typeof hooks.usePrReviews>);

  vi.mocked(hooks.useRunEvents).mockReturnValue({ events, running });

  vi.mocked(hooks.useFindingAction).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useFindingAction>);

  return { refetchReviews };
}

const messages = {
  multiAgentReviewResults: messagesResults,
  runs: messagesRuns,
};

function renderResults(prId: string, runIds: string[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ResultsPage prId={prId} runIds={runIds} />
    </NextIntlClientProvider>,
  );
}

describe("ResultsPage — reviews re-pull on run completion", () => {
  it("does NOT refetch reviews while all runs are still running", () => {
    const { refetchReviews } = setupHooks({
      runs: [makeRunSummary("run-1", "Security Reviewer", "running")],
      reviews: [],
    });
    renderResults("pr-1", ["run-1"]);
    expect(refetchReviews).not.toHaveBeenCalled();
  });

  it("refetches reviews when a run reaches a terminal state (findings arrive without a manual reload)", () => {
    // Regression: usePrReviews has no auto-poll, so a run finishing after
    // page load kept "0 findings" until the user reloaded the page.
    const refetchReviews = vi.fn();
    setupHooks({
      runs: [makeRunSummary("run-1", "Security Reviewer", "running")],
      reviews: [],
      refetchReviews,
    });
    const { rerender } = renderResults("pr-1", ["run-1"]);
    expect(refetchReviews).not.toHaveBeenCalled();

    // The run lands: the next poll of usePrRuns reports it done.
    setupHooks({
      runs: [makeRunSummary("run-1", "Security Reviewer", "done")],
      reviews: [],
      refetchReviews,
    });
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ResultsPage prId="pr-1" runIds={["run-1"]} />
      </NextIntlClientProvider>,
    );
    expect(refetchReviews).toHaveBeenCalled();
  });
});

describe("ResultsPage — Columns view (AC-7, AC-8, AC-23)", () => {
  beforeEach(() => {
    setupHooks({
      runs: [
        makeRunSummary("run-1", "Security Reviewer", "done"),
        makeRunSummary("run-2", "Perf Reviewer", "running"),
      ],
      reviews: [
        makeReview("run-1", [makeFinding()]),
        makeReview("run-2"),
      ],
    });
  });

  it("renders one column per run id from URL (AC-8)", () => {
    renderResults("pr-1", ["run-1", "run-2"]);
    // getAllByText because agent names may appear in column headers AND DisagreementBlock
    expect(screen.getAllByText("Security Reviewer").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Perf Reviewer").length).toBeGreaterThanOrEqual(1);
  });

  it("completed run renders findings immediately (AC-23)", () => {
    renderResults("pr-1", ["run-1", "run-2"]);
    // Finding may appear in column card + DisagreementBlock
    expect(screen.getAllByText("Potential XSS").length).toBeGreaterThanOrEqual(1);
  });

  it("running run shows 'running' status (AC-7)", () => {
    renderResults("pr-1", ["run-1", "run-2"]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("ResultsPage — failed run renders error state, others render results (AC-17)", () => {
  it("failed column shows error, done column shows findings", () => {
    setupHooks({
      runs: [
        makeRunSummary("run-1", "Security Reviewer", "done"),
        makeRunSummary("run-2", "Perf Reviewer", "failed", { error: "LLM timeout", score: null }),
      ],
      reviews: [makeReview("run-1", [makeFinding()])],
    });

    renderResults("pr-1", ["run-1", "run-2"]);

    expect(screen.getAllByText("Potential XSS").length).toBeGreaterThanOrEqual(1); // done column
    expect(screen.getByText(/run failed/i)).toBeInTheDocument(); // failed column
    expect(screen.getByText("LLM timeout")).toBeInTheDocument();
  });
});

describe("ResultsPage — run_id not in workspace list renders not-found", () => {
  it("renders not-found state for unknown run id", () => {
    setupHooks({
      runs: [makeRunSummary("run-1", "Security Reviewer", "done")],
      reviews: [],
    });

    // run-99 is not in the workspace run list
    renderResults("pr-1", ["run-1", "run-99"]);

    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });
});

describe("ResultsPage — View trace opens RunTraceDrawer (AC-9)", () => {
  it("clicking 'View trace' opens the RunTraceDrawer with the correct runId", async () => {
    const user = userEvent.setup();
    setupHooks({
      runs: [makeRunSummary("run-1", "Security Reviewer", "done")],
      reviews: [makeReview("run-1", [makeFinding()])],
    });

    renderResults("pr-1", ["run-1"]);

    // Drawer should not be visible yet
    expect(screen.queryByTestId("run-trace-drawer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /view trace/i }));

    const drawer = screen.getByTestId("run-trace-drawer");
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute("data-run-id", "run-1");
  });

  it("closing the drawer removes it from DOM", async () => {
    const user = userEvent.setup();
    setupHooks({
      runs: [makeRunSummary("run-1", "Security Reviewer", "done")],
      reviews: [makeReview("run-1")],
    });

    renderResults("pr-1", ["run-1"]);

    await user.click(screen.getByRole("button", { name: /view trace/i }));
    expect(screen.getByTestId("run-trace-drawer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByTestId("run-trace-drawer")).not.toBeInTheDocument();
  });
});

describe("ResultsPage — Tabs view toggle (AC-12)", () => {
  beforeEach(() => {
    setupHooks({
      runs: [
        makeRunSummary("run-1", "Security Reviewer", "done"),
        makeRunSummary("run-2", "Perf Reviewer", "done"),
      ],
      reviews: [makeReview("run-1"), makeReview("run-2")],
    });
  });

  it("toggles to Tabs view when Tabs button is clicked", async () => {
    const user = userEvent.setup();
    renderResults("pr-1", ["run-1", "run-2"]);

    const tabsBtn = screen.getByRole("tab", { name: /^tabs$/i });
    await user.click(tabsBtn);

    // Should show tab navigation with agent names
    const agentTabs = screen.getAllByRole("tab");
    const agentTabNames = agentTabs.map((t) => t.textContent);
    expect(agentTabNames).toContain("Security Reviewer");
    expect(agentTabNames).toContain("Perf Reviewer");
  });

  it("view toggle buttons have correct ARIA attributes", () => {
    renderResults("pr-1", ["run-1", "run-2"]);

    const columnsTab = screen.getByRole("tab", { name: /^columns$/i });
    const tabsTab = screen.getByRole("tab", { name: /^tabs$/i });

    expect(columnsTab).toHaveAttribute("aria-selected", "true");
    expect(tabsTab).toHaveAttribute("aria-selected", "false");
  });
});

describe("ResultsPage — SSE status updates (AC-7)", () => {
  it("live SSE 'result' event updates column status to done", () => {
    setupHooks({
      runs: [makeRunSummary("run-1", "Security Reviewer", "running")],
      reviews: [],
      events: [
        { runId: "run-1", kind: "result" as const, msg: "done", seq: 1, t: "01.00" },
      ],
    });

    renderResults("pr-1", ["run-1"]);

    // The getLiveStatus function maps 'result' events to 'done'
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("live SSE 'error' event updates column status to failed", () => {
    setupHooks({
      runs: [makeRunSummary("run-1", "Security Reviewer", "running")],
      reviews: [],
      events: [
        { runId: "run-1", kind: "error" as const, msg: "timeout", seq: 1, t: "00.50" },
      ],
    });

    renderResults("pr-1", ["run-1"]);

    expect(screen.getByText("failed")).toBeInTheDocument();
  });
});
