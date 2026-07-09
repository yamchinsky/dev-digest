/* ConfigureRunPage.test.tsx
 *
 * Coverage:
 *   AC-3:  No PR selected → agent panel disabled/placeholder
 *   AC-4:  PR selected → agent cards + summary line rendered
 *   AC-5:  Null estimates → "~?" / "~$?" displayed
 *   AC-6:  Launch navigates to results URL with correct pr + runs params
 *   AC-18: Empty agent list → /agents CTA + disabled launch button
 *   AC-19: Empty PR list → disabled selector
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, PrMeta, Repo, ReviewRunResponse } from "@devdigest/shared";
import messages from "../../../../../messages/en/multiAgentReview.json";

// ---------------------------------------------------------------------------
// Mock AppShell
// ---------------------------------------------------------------------------
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// ---------------------------------------------------------------------------
// Shared hook mock state
// ---------------------------------------------------------------------------
const hooksState = vi.hoisted(() => ({
  repos: [] as Repo[],
  pulls: [] as PrMeta[],
  agents: [] as Agent[],
  runResult: null as ReviewRunResponse | null,
  runIsPending: false,
}));

vi.mock("@/lib/hooks/core", () => ({
  useRepos: () => ({ data: hooksState.repos }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: hooksState.agents }),
}));

const runMutateAsync = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  useRunMultiAgentReview: () => ({
    mutateAsync: runMutateAsync,
    isPending: hooksState.runIsPending,
  }),
}));

// useQueries is called with repos; each query fetches pulls.
// We mock at the @tanstack/react-query level to always return the same pulls list.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...original,
    useQueries: () => [{ data: hooksState.pulls, isLoading: false }],
  };
});

// Import AFTER mocks.
import { ConfigureRunPage } from "./ConfigureRunPage";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const REPO: Repo = {
  id: "repo-1",
  workspace_id: "ws-1",
  owner: "acme",
  name: "frontend",
  full_name: "acme/frontend",
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
};

const PR_A: PrMeta = {
  id: "pr-uuid-1",
  number: 42,
  title: "Add OAuth flow",
  author: "alice",
  branch: "feature/oauth",
  base: "main",
  head_sha: "abc123",
  additions: 100,
  deletions: 20,
  files_count: 5,
  status: "open",
};

const PR_B: PrMeta = {
  id: "pr-uuid-2",
  number: 43,
  title: "Fix security bug",
  author: "bob",
  branch: "fix/sec",
  base: "main",
  head_sha: "def456",
  additions: 5,
  deletions: 2,
  files_count: 1,
  status: "open",
};

const AGENT_SECURITY: Agent = {
  id: "ag-1",
  name: "Security Reviewer",
  description: "Flags security issues",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  estimate: { duration_avg_ms: 30000, cost_avg_usd: 0.05 },
};

const AGENT_PERF: Agent = {
  id: "ag-2",
  name: "Performance Reviewer",
  description: "Finds performance bottlenecks",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  system_prompt: "You are a performance reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  estimate: { duration_avg_ms: null, cost_avg_usd: null },
};

const RUN_RESPONSE: ReviewRunResponse = {
  pr_id: "pr-uuid-1",
  runs: [
    { run_id: "run-1", agent_id: "ag-1", agent_name: "Security Reviewer" },
    { run_id: "run-2", agent_id: "ag-2", agent_name: "Performance Reviewer" },
  ],
  reviews: [],
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgentReview: messages }}>
      <ConfigureRunPage />
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  hooksState.repos = [REPO];
  hooksState.pulls = [PR_A, PR_B];
  hooksState.agents = [AGENT_SECURITY, AGENT_PERF];
  hooksState.runResult = null;
  hooksState.runIsPending = false;
  runMutateAsync.mockResolvedValue(RUN_RESPONSE);
  mockPush.mockClear();
  runMutateAsync.mockClear();
});

afterEach(cleanup);

describe("ConfigureRunPage — PR selector", () => {
  it("renders the PR selector (AC-19 baseline)", () => {
    renderPage();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("shows disabled selector with placeholder when no PRs (AC-19)", () => {
    hooksState.pulls = [];
    renderPage();
    const select = screen.getByRole("combobox");
    expect(select).toBeDisabled();
  });

  it("lists PRs as options in the selector", () => {
    renderPage();
    expect(screen.getByText("#42 Add OAuth flow")).toBeInTheDocument();
    expect(screen.getByText("#43 Fix security bug")).toBeInTheDocument();
  });
});

describe("ConfigureRunPage — agent panel (AC-3)", () => {
  it("shows placeholder text when no PR is selected", () => {
    renderPage();
    expect(screen.getByText(messages.agentPanel.selectPrFirst)).toBeInTheDocument();
  });

  it("does NOT show agent cards when no PR is selected", () => {
    renderPage();
    expect(screen.queryByText("Security Reviewer")).not.toBeInTheDocument();
  });
});

describe("ConfigureRunPage — with PR selected (AC-4)", () => {
  async function selectPR() {
    const user = userEvent.setup();
    renderPage();
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "pr-uuid-1");
    return user;
  }

  it("renders agent cards after selecting a PR", async () => {
    await selectPR();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Performance Reviewer")).toBeInTheDocument();
  });

  it("shows numeric estimates when available (AC-5)", async () => {
    await selectPR();
    expect(screen.getByText("~30s")).toBeInTheDocument();
    expect(screen.getByText("~$0.05")).toBeInTheDocument();
  });

  it("shows ~? and ~$? for null estimates (AC-5)", async () => {
    await selectPR();
    // AGENT_PERF has null estimates
    expect(screen.getByText("~?")).toBeInTheDocument();
    expect(screen.getByText("~$?")).toBeInTheDocument();
  });

  it("shows the summary line with time and cost labels (AC-4)", async () => {
    await selectPR();
    // Summary should appear with the max time label (null agent causes ~?)
    expect(screen.getByText(messages.summary.time.replace("{value}", "~?"))).toBeInTheDocument();
  });

  it("renders launch button as enabled when agents are checked and PR selected", async () => {
    await selectPR();
    const btn = screen.getByRole("button", { name: /Run multi-agent review/i });
    expect(btn).toBeEnabled();
  });
});

describe("ConfigureRunPage — launch (AC-6)", () => {
  it("calls mutateAsync and navigates to results URL on launch", async () => {
    const user = userEvent.setup();
    renderPage();

    // Select a PR
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "pr-uuid-1");

    // Click launch
    const btn = screen.getByRole("button", { name: /Run multi-agent review/i });
    await user.click(btn);

    await waitFor(() => {
      expect(runMutateAsync).toHaveBeenCalledWith({
        prId: "pr-uuid-1",
        agentIds: expect.arrayContaining(["ag-1", "ag-2"]),
      });
    });

    expect(mockPush).toHaveBeenCalledWith(
      "/multi-agent-review/results?pr=pr-uuid-1&runs=run-1,run-2",
    );
  });
});

describe("ConfigureRunPage — empty agents (AC-18)", () => {
  beforeEach(() => {
    hooksState.agents = [];
  });

  it("shows /agents CTA when no agents exist", async () => {
    const user = userEvent.setup();
    renderPage();
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "pr-uuid-1");

    expect(screen.getByText(messages.agentPanel.goToAgents)).toBeInTheDocument();
  });

  it("keeps launch button disabled when no agents exist (AC-18)", async () => {
    const user = userEvent.setup();
    renderPage();
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "pr-uuid-1");

    const btn = screen.getByRole("button", { name: /Run multi-agent review/i });
    expect(btn).toBeDisabled();
  });

  it("navigates to /agents when CTA is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "pr-uuid-1");

    const ctaBtn = screen.getByText(messages.agentPanel.goToAgents);
    await user.click(ctaBtn);

    expect(mockPush).toHaveBeenCalledWith("/agents");
  });
});

describe("ConfigureRunPage — unchecking all agents", () => {
  it("disables launch button when no agents are checked", async () => {
    // Render with only ONE agent so we only need to uncheck once.
    hooksState.agents = [AGENT_SECURITY];
    const user = userEvent.setup();
    renderPage();

    // Select a PR
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "pr-uuid-1");

    // Uncheck the single agent's checkbox
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    await user.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "false");

    const btn = screen.getByRole("button", { name: /Run multi-agent review/i });
    expect(btn).toBeDisabled();
  });
});
