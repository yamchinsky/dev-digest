import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiAgentReviewResults.json";
import { AgentTab } from "./AgentTab";

// Mock the useFindingAction hook
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({
    mutate: vi.fn((args: { action: string }, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    }),
    isPending: false,
  }),
}));

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
    duration_ms: 3500,
    tokens_in: 100,
    tokens_out: 50,
    findings_count: 1,
    grounding: "1/1 passed",
    ran_at: "2026-07-09T00:00:00.000Z",
    score: 72,
    blockers: 1,
    cost_usd: 0.004,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "finding-1",
    review_id: "review-1",
    severity: "CRITICAL",
    category: "security",
    title: "SQL Injection",
    file: "src/db/query.ts",
    start_line: 42,
    end_line: 44,
    rationale: "User input is passed directly into a SQL query without sanitization.",
    suggestion: "Use parameterized queries or an ORM.",
    confidence: 0.95,
    kind: null,
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function renderTab(props: Partial<React.ComponentProps<typeof AgentTab>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgentReviewResults: messages }}>
      <AgentTab
        runSummary={props.runSummary ?? makeRunSummary()}
        findings={props.findings ?? [makeFinding()]}
        liveStatus={props.liveStatus ?? null}
        prId={props.prId ?? "pr-1"}
        onViewTrace={props.onViewTrace ?? vi.fn()}
        summary={props.summary}
      />
    </NextIntlClientProvider>,
  );
}

describe("AgentTab — summary banner", () => {
  it("renders score, status, duration, cost, and View trace button", () => {
    renderTab();

    expect(screen.getByText(/72/)).toBeInTheDocument(); // score
    expect(screen.getByText("done")).toBeInTheDocument();
    expect(screen.getByText(/3\.5s/)).toBeInTheDocument(); // duration
    expect(screen.getByText(/\$0\.004/)).toBeInTheDocument(); // cost
    expect(screen.getByRole("button", { name: /view trace/i })).toBeInTheDocument();
  });

  it("shows n/a for missing duration and cost", () => {
    renderTab({
      runSummary: makeRunSummary({ duration_ms: null, cost_usd: null }),
    });
    // Both should show n/a
    expect(screen.getAllByText(/n\/a/).length).toBeGreaterThanOrEqual(1);
  });

  it("calls onViewTrace when View trace is clicked", async () => {
    const user = userEvent.setup();
    const onViewTrace = vi.fn();
    renderTab({ onViewTrace });

    await user.click(screen.getByRole("button", { name: /view trace/i }));
    expect(onViewTrace).toHaveBeenCalledOnce();
  });
});

describe("AgentTab — finding list + expand (AC-12, AC-13)", () => {
  it("renders finding in collapsed state", () => {
    renderTab();
    expect(screen.getByText("SQL Injection")).toBeInTheDocument();
    // Rationale should not be visible until expanded
    expect(screen.queryByText(/parameterized queries/i)).not.toBeInTheDocument();
  });

  it("expands a finding to show all fields and 4 action buttons (AC-13)", async () => {
    const user = userEvent.setup();
    renderTab();

    // Click the finding row to expand
    await user.click(screen.getByText("SQL Injection"));

    // Verify all required fields appear
    expect(screen.getByText(/User input is passed directly/)).toBeInTheDocument(); // rationale
    expect(screen.getByText(/parameterized queries/i)).toBeInTheDocument(); // suggestion
    expect(screen.getByText(/95% confidence/i)).toBeInTheDocument(); // confidence

    // All 4 buttons
    expect(screen.getByRole("button", { name: /^accept$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^dismiss$/i })).toBeInTheDocument();
    expect(screen.getByText(/learn/i)).toBeInTheDocument();
    expect(screen.getByText(/turn into eval case/i)).toBeInTheDocument();
  });

  it("stub buttons are disabled with appropriate tooltips", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByText("SQL Injection"));

    const learnBtn = screen.getByRole("button", { name: /learn/i });
    const evalBtn = screen.getByRole("button", { name: /turn into eval case/i });

    expect(learnBtn).toBeDisabled();
    expect(evalBtn).toBeDisabled();
    expect(learnBtn).toHaveAttribute("title", "TODO: Memory homework");
    expect(evalBtn).toHaveAttribute("title", "TODO: L06 evals");
  });

  it("Accept button calls finding action and updates visual state (AC-14)", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByText("SQL Injection"));
    const acceptBtn = screen.getByRole("button", { name: /^accept$/i });
    await user.click(acceptBtn);

    // After accepting, button text should update
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /accepted/i })).toBeInTheDocument();
    });
  });

  it("Dismiss button calls finding action and updates visual state (AC-14)", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByText("SQL Injection"));
    const dismissBtn = screen.getByRole("button", { name: /^dismiss$/i });
    await user.click(dismissBtn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /dismissed/i })).toBeInTheDocument();
    });
  });

  it("renders 'No findings' when finding list is empty", () => {
    renderTab({ findings: [] });
    expect(screen.getByText(/no findings/i)).toBeInTheDocument();
  });
});

describe("AgentTab — summary banner (AC-12)", () => {
  it("renders the ReviewRecord summary text when provided", () => {
    renderTab({ summary: "Looks good overall, one minor XSS concern." });
    expect(screen.getByText("Looks good overall, one minor XSS concern.")).toBeInTheDocument();
  });

  it("renders the noSummary fallback when summary is null", () => {
    renderTab({ summary: null });
    expect(screen.getByText("No summary available.")).toBeInTheDocument();
  });

  it("renders the noSummary fallback when summary is undefined (prop absent)", () => {
    renderTab({ summary: undefined });
    expect(screen.getByText("No summary available.")).toBeInTheDocument();
  });

  it("renders summary as a text node, not HTML (LLM-generated content safety)", () => {
    const xss = "<script>alert('xss')</script>";
    renderTab({ summary: xss });
    // React must escape the string — we can find it as plain text
    expect(screen.getByText(xss, { exact: false })).toBeInTheDocument();
    // No actual script element should have been injected
    expect(document.querySelector("script")).toBeNull();
  });
});

describe("AgentTab — LLM text safety", () => {
  it("renders rationale and suggestion as text nodes, not HTML (no dangerouslySetInnerHTML)", async () => {
    const user = userEvent.setup();
    const xssAttempt = "<script>alert('xss')</script>";
    renderTab({
      findings: [
        makeFinding({
          rationale: xssAttempt,
          suggestion: xssAttempt,
        }),
      ],
    });

    await user.click(screen.getByText("SQL Injection"));

    // The text should be rendered as escaped text, not executed as HTML.
    // If React escapes it correctly, we should find the raw string in the DOM.
    const matches = screen.getAllByText(xssAttempt, { exact: false });
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // And there should be no <script> element in the DOM
    expect(document.querySelector("script")).toBeNull();
  });
});
