import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const mockMutateAsync = vi.fn().mockResolvedValue({
  runs: [{ run_id: "r1", agent_id: "a1", agent_name: "Security" }],
});

// useAgents mock: the factory returns a vi.fn() so per-test overrides via
// mockReturnValue work correctly (vi.doMock after import is a no-op in Vitest).
const mockUseAgents = vi.fn();

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => mockUseAgents(),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  useRunMultiAgentReview: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(cleanup);

/** Two enabled agents — the default for most tests. */
const TWO_AGENTS = [
  {
    id: "a1",
    name: "Security",
    model: "gpt-4.1",
    enabled: true,
    estimate: { duration_avg_ms: 8200, cost_avg_usd: 0.06 },
  },
  {
    id: "a2",
    name: "Performance",
    model: "gpt-4.1",
    enabled: true,
    estimate: { duration_avg_ms: null, cost_avg_usd: null },
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RunReviewDropdown (multi-agent picker)", () => {
  beforeEach(() => {
    mockUseAgents.mockReturnValue({ data: TWO_AGENTS });
  });

  it("renders the trigger button", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });

  it("opens the picker popover on click", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));
    expect(screen.getByText("Select agents")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();
  });

  it("shows estimates for agents with history and ~? for those without", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));
    // Security has duration=8200ms → ~8s
    expect(screen.getByText("~8s")).toBeInTheDocument();
    // Performance has null estimates → ~?
    expect(screen.getByText("~?")).toBeInTheDocument();
    expect(screen.getByText("~$?")).toBeInTheDocument();
  });

  it("renders the run button with count when agents are checked", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));
    // Both agents pre-checked: count = 2
    expect(screen.getByText("Run multi-agent review (2)")).toBeInTheDocument();
  });
});

describe("RunReviewDropdown empty state", () => {
  it("shows CTA to /agents when no enabled agents exist and run button is disabled", () => {
    // Return an empty agent list for this test — the module-level vi.mock factory
    // delegates to mockUseAgents, so mockReturnValue takes effect immediately.
    mockUseAgents.mockReturnValue({ data: [] });

    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));

    // The empty-state CTA link to /agents must be present
    expect(screen.getByText("Go to Agents →")).toBeInTheDocument();

    // The empty-state title and body must appear
    expect(screen.getByText("No agents configured")).toBeInTheDocument();

    // The run button is still rendered in the footer but is disabled (no agents checked)
    const runBtn = screen.getByRole("button", { name: /Run multi-agent review/i });
    expect(runBtn).toBeDisabled();
  });
});
