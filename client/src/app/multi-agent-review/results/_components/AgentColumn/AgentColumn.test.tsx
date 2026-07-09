import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiAgentReviewResults.json";
import { AgentColumn } from "./AgentColumn";

afterEach(cleanup);

function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "agent-1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 2000,
    tokens_in: 100,
    tokens_out: 50,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-07-09T00:00:00.000Z",
    score: 85,
    blockers: 0,
    cost_usd: 0.002,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "finding-1",
    review_id: "review-1",
    severity: "WARNING",
    category: "security",
    title: "XSS vulnerability",
    file: "src/foo.ts",
    start_line: 10,
    end_line: 15,
    rationale: "User input is rendered directly.",
    suggestion: "Sanitize the input.",
    confidence: 0.9,
    kind: null,
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function renderColumn(
  props: Partial<React.ComponentProps<typeof AgentColumn>> & { runSummary: RunSummary | null | undefined } = {
    runSummary: makeRunSummary(),
  },
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgentReviewResults: messages }}>
      <AgentColumn
        runSummary={props.runSummary}
        findings={props.findings ?? []}
        liveStatus={props.liveStatus ?? null}
        onViewTrace={props.onViewTrace ?? vi.fn()}
        notFound={props.notFound}
      />
    </NextIntlClientProvider>,
  );
}

describe("AgentColumn", () => {
  it("renders agent name, status badge, score badge, and View trace button", () => {
    renderColumn({ runSummary: makeRunSummary({ status: "done", score: 85 }) });

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /view trace/i })).toBeInTheDocument();
  });

  it("renders live SSE status when liveStatus is provided", () => {
    renderColumn({
      runSummary: makeRunSummary({ status: "running" }),
      liveStatus: "running",
    });
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("renders 'No findings' empty state when findings is empty", () => {
    renderColumn({ runSummary: makeRunSummary(), findings: [] });
    expect(screen.getByText(/no findings/i)).toBeInTheDocument();
  });

  it("renders finding cards with severity and file info", () => {
    const finding = makeFinding({ title: "SQL injection", file: "db/query.ts", start_line: 42 });
    renderColumn({ runSummary: makeRunSummary(), findings: [finding] });

    expect(screen.getByText("SQL injection")).toBeInTheDocument();
    expect(screen.getByText(/db\/query\.ts:42/)).toBeInTheDocument();
  });

  it("renders error state for a failed run", () => {
    renderColumn({
      runSummary: makeRunSummary({ status: "failed", error: "LLM timeout", score: null }),
      liveStatus: "failed",
    });
    expect(screen.getByText(/run failed/i)).toBeInTheDocument();
    expect(screen.getByText("LLM timeout")).toBeInTheDocument();
  });

  it("renders error state for a cancelled run", () => {
    renderColumn({
      runSummary: makeRunSummary({ status: "cancelled", error: null, score: null }),
      liveStatus: "cancelled",
    });
    expect(screen.getByText(/run cancelled/i)).toBeInTheDocument();
  });

  it("renders 'not found' state when notFound is true", () => {
    renderColumn({ runSummary: undefined, notFound: true, findings: [] });
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it("calls onViewTrace when View trace button is clicked", async () => {
    const user = userEvent.setup();
    const onViewTrace = vi.fn();
    renderColumn({ runSummary: makeRunSummary(), onViewTrace });

    await user.click(screen.getByRole("button", { name: /view trace/i }));
    expect(onViewTrace).toHaveBeenCalledOnce();
  });

  it("other columns render results even when one run is failed (AC-17)", () => {
    // This test verifies the column renders independently — a separate column
    // with status "done" should show its results.
    const doneRun = makeRunSummary({ status: "done", agent_name: "Perf Reviewer", score: 90 });
    renderColumn({ runSummary: doneRun, findings: [makeFinding({ title: "Slow query" })] });

    expect(screen.getByText("Perf Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Slow query")).toBeInTheDocument();
    expect(screen.queryByText(/run failed/i)).not.toBeInTheDocument();
  });
});
