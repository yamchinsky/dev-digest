/* CiRunsPage.test.tsx — component tests.
 *
 * Coverage:
 *   AC-20: table columns render with fixture rows
 *   AC-21: empty state on empty array
 *   AC-22: filter change updates the query params passed to useCiRuns
 *   AC-24: useCiRuns is called with refetchInterval ≤ 60000
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import type { CiRunsFilters, CiRunsOptions } from "@/lib/hooks/ci";
import ciMessages from "../../../../../messages/en/ci.json";

// ---------------------------------------------------------------------------
// Mock app-shell — avoid full chrome in unit tests
// ---------------------------------------------------------------------------

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Shared hook mock state
// ---------------------------------------------------------------------------

const syncMutate = vi.fn();

const hooksState = vi.hoisted(() => ({
  ciRuns: {
    data: undefined as CiRun[] | undefined,
    isLoading: false,
  },
  syncIsPending: false,
  /** Capture the last call args for assertion. */
  lastCiRunsArgs: {
    filters: {} as CiRunsFilters,
    options: {} as CiRunsOptions,
  },
}));

vi.mock("@/lib/hooks/ci", () => ({
  useCiRuns: (filters: CiRunsFilters, options: CiRunsOptions) => {
    hooksState.lastCiRunsArgs.filters = filters;
    hooksState.lastCiRunsArgs.options = options;
    return { ...hooksState.ciRuns };
  },
  useSyncCiRuns: () => ({
    mutate: syncMutate,
    isPending: hooksState.syncIsPending,
  }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [], isLoading: false }),
}));

// Import AFTER mocks are set up.
import { CiRunsPage } from "./CiRunsPage";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_1: CiRun = {
  id: "run-1",
  ci_installation_id: "inst-1",
  pr_number: 42,
  ran_at: "2025-07-01T12:00:00Z",
  status: "succeeded",
  findings_count: 3,
  cost_usd: 0.0025,
  github_url: "https://github.com/acme/api/actions/runs/12345",
  source: "acme/api",
  agent: "Security Reviewer",
  duration_s: 12.4,
};

const RUN_2: CiRun = {
  id: "run-2",
  ci_installation_id: "inst-2",
  pr_number: 99,
  ran_at: "2025-07-02T08:30:00Z",
  status: "failed",
  findings_count: 0,
  cost_usd: null,
  github_url: null,
  source: "acme/web",
  agent: "Performance Reviewer",
  duration_s: null,
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <CiRunsPage />
    </NextIntlClientProvider>,
  );
}

function setRuns(runs: CiRun[]) {
  hooksState.ciRuns = { data: runs, isLoading: false };
}

beforeEach(() => {
  hooksState.ciRuns = { data: undefined, isLoading: false };
  hooksState.syncIsPending = false;
  hooksState.lastCiRunsArgs = { filters: {}, options: {} };
  syncMutate.mockClear();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// AC-20: table columns render with fixture rows
// ---------------------------------------------------------------------------

describe("CiRunsPage — table columns (AC-20)", () => {
  beforeEach(() => {
    setRuns([RUN_1, RUN_2]);
  });

  it("renders a row for each run", () => {
    renderPage();
    const rows = screen.getAllByTestId("ci-run-row");
    expect(rows).toHaveLength(2);
  });

  it("renders PR number as a link to GitHub", () => {
    renderPage();
    const prLink = screen.getByRole("link", { name: /PR #42/i });
    expect(prLink).toHaveAttribute(
      "href",
      "https://github.com/acme/api/actions/runs/12345",
    );
  });

  it("renders the repository (source) column", () => {
    renderPage();
    const sources = screen.getAllByTestId("run-source");
    expect(sources[0]).toHaveTextContent("acme/api");
    expect(sources[1]).toHaveTextContent("acme/web");
  });

  it("renders the agent name column", () => {
    renderPage();
    const agents = screen.getAllByTestId("run-agent");
    expect(agents[0]).toHaveTextContent("Security Reviewer");
  });

  it("renders a status badge with accessible text (not colour-only)", () => {
    renderPage();
    const statuses = screen.getAllByTestId("run-status");
    // "succeeded" → i18n label "Succeeded"
    expect(statuses[0]).toHaveTextContent(ciMessages.runs.status.succeeded);
    // "failed" → i18n label "Failed"
    expect(statuses[1]).toHaveTextContent(ciMessages.runs.status.failed);
  });

  it("renders findings count", () => {
    renderPage();
    const findings = screen.getAllByTestId("run-findings");
    expect(findings[0]).toHaveTextContent("3");
  });

  it("renders cost formatted as dollars", () => {
    renderPage();
    const costs = screen.getAllByTestId("run-cost");
    expect(costs[0]).toHaveTextContent("$0.0025");
  });

  it("renders a 'View' link to the Actions job when github_url is present", () => {
    renderPage();
    const viewLinks = screen.getAllByRole("link", {
      name: ciMessages.runs.view,
    });
    // RUN_1 has a github_url; RUN_2 does not → only 1 "View" link
    expect(viewLinks).toHaveLength(1);
    expect(viewLinks[0]).toHaveAttribute(
      "href",
      "https://github.com/acme/api/actions/runs/12345",
    );
  });

  it("renders table headers", () => {
    renderPage();
    expect(
      screen.getByText(ciMessages.runs.table.timestamp),
    ).toBeInTheDocument();
    expect(
      screen.getByText(ciMessages.runs.table.status),
    ).toBeInTheDocument();
    expect(
      screen.getByText(ciMessages.runs.table.findings),
    ).toBeInTheDocument();
    expect(
      screen.getByText(ciMessages.runs.table.cost),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-21: empty state on empty array
// ---------------------------------------------------------------------------

describe("CiRunsPage — empty state (AC-21)", () => {
  it("shows empty-state when runs array is empty", () => {
    setRuns([]);
    renderPage();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("empty-title")).toHaveTextContent(
      ciMessages.runs.emptyTitle,
    );
    expect(screen.getByTestId("empty-body")).toHaveTextContent(
      ciMessages.runs.emptyBody,
    );
  });

  it("does NOT show empty-state when runs are present", () => {
    setRuns([RUN_1]);
    renderPage();
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });

  it("does NOT show the table when runs array is empty", () => {
    setRuns([]);
    renderPage();
    expect(screen.queryByTestId("ci-run-row")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-22: filter change updates the query params passed to useCiRuns
// ---------------------------------------------------------------------------

describe("CiRunsPage — filter controls (AC-22)", () => {
  beforeEach(() => {
    setRuns([]);
  });

  it("passes the default 'since' filter to useCiRuns on mount", () => {
    renderPage();
    expect(hooksState.lastCiRunsArgs.filters.since).toBe("7d");
  });

  it("updates the 'since' filter when user changes the time window select", async () => {
    const user = userEvent.setup();
    renderPage();

    // The first <select> (combobox) is the time window selector
    const selects = screen.getAllByRole("combobox");
    // time window is the first select
    await user.selectOptions(selects[0]!, "30d");

    await waitFor(() => {
      expect(hooksState.lastCiRunsArgs.filters.since).toBe("30d");
    });
  });

  it("updates the 'status' filter when user selects a status", async () => {
    const user = userEvent.setup();
    renderPage();

    // The status selector is the last select
    const selects = screen.getAllByRole("combobox");
    const statusSelect = selects[selects.length - 1]!;
    await user.selectOptions(statusSelect, "failed");

    await waitFor(() => {
      expect(hooksState.lastCiRunsArgs.filters.status).toBe("failed");
    });
  });

  it("updates the 'repo' filter when user types in the repo input", async () => {
    const user = userEvent.setup();
    renderPage();

    const repoInput = screen.getByTestId("repo-filter");
    await user.type(repoInput, "acme/payments");

    await waitFor(() => {
      expect(hooksState.lastCiRunsArgs.filters.repo).toBe("acme/payments");
    });
  });
});

// ---------------------------------------------------------------------------
// AC-24: useCiRuns is called with refetchInterval ≤ 60000
// ---------------------------------------------------------------------------

describe("CiRunsPage — auto-poll (AC-24)", () => {
  it("passes refetchInterval ≤ 60000 to useCiRuns", () => {
    setRuns([]);
    renderPage();
    const interval = hooksState.lastCiRunsArgs.options.refetchInterval;
    expect(interval).toBeDefined();
    expect(interval).toBeLessThanOrEqual(60_000);
    // Must be a positive interval (not 0 or negative)
    expect(interval).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Sync button
// ---------------------------------------------------------------------------

describe("CiRunsPage — sync button", () => {
  it("calls sync.mutate when Sync button is clicked", async () => {
    const user = userEvent.setup();
    setRuns([]);
    renderPage();

    const syncBtn = screen.getByTestId("sync-btn");
    await user.click(syncBtn);

    expect(syncMutate).toHaveBeenCalledOnce();
  });

  it("shows 'Refreshing…' text while sync is pending", () => {
    hooksState.syncIsPending = true;
    setRuns([]);
    renderPage();

    expect(screen.getByTestId("sync-btn")).toHaveTextContent(
      ciMessages.runs.refreshing,
    );
  });
});
