/* CiTab.test.tsx — vitest+RTL tests for the CiTab component.
 *
 * ACs covered:
 *   AC-27  installations list renders (date, target badge, PR link)
 *   AC-28  empty state + "Export to CI" button present + aria-label + keyboard-operable
 *   AC-30  CI run history sub-list is rendered
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiInstallation, CiRun } from "@devdigest/shared";
import ciMessages from "../../../../../../../../messages/en/ci.json";
import agentsMessages from "../../../../../../../../messages/en/agents.json";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const updateAgentMutate = vi.fn();

const mockState = vi.hoisted(() => ({
  installations: undefined as CiInstallation[] | undefined,
  installsLoading: false,
  ciRuns: [] as CiRun[],
  runsLoading: false,
}));

vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({
    mutate: updateAgentMutate,
    isPending: false,
  }),
}));

vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations: (_agentId: string) => ({
    data: mockState.installations,
    isLoading: mockState.installsLoading,
  }),
  useCiRuns: () => ({
    data: mockState.ciRuns,
    isLoading: mockState.runsLoading,
  }),
  useExportCi: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

// Mock ExportWizard so we don't need a QueryClientProvider in CiTab tests.
// CiTab.test.tsx only verifies the CiTab shell (AC-27/28/30), not wizard internals.
vi.mock("./ExportWizard", () => ({
  ExportWizard: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" data-testid="export-wizard-mock">
      <button onClick={onClose}>Close Wizard</button>
    </div>
  ),
}));

// Import AFTER mocks
import { CiTab } from "./CiTab";

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

const INSTALLATION_1: CiInstallation = {
  id: "install1",
  agent_id: "agent1",
  repo: "acme/payments-api",
  target_type: "gha",
  installed_at: "2025-06-01T10:00:00Z",
};

const CI_RUN_1: CiRun = {
  id: "run1",
  ci_installation_id: "install1",
  pr_number: 42,
  ran_at: "2025-06-10T12:00:00Z",
  status: "succeeded",
  findings_count: 3,
  cost_usd: 0.001,
  github_url: "https://github.com/acme/payments-api/actions/runs/12345",
  source: "github_actions",
  agent: "test-agent",
};

const CI_RUN_2: CiRun = {
  id: "run2",
  ci_installation_id: "install1",
  pr_number: 41,
  ran_at: "2025-06-09T11:00:00Z",
  status: "failed",
  findings_count: 0,
  cost_usd: null,
  github_url: null,
  source: "github_actions",
  agent: "test-agent",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTab(agent: Agent = AGENT) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ci: ciMessages, agents: agentsMessages }}
    >
      <CiTab agent={agent} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mockState.installations = undefined;
  mockState.installsLoading = false;
  mockState.ciRuns = [];
  mockState.runsLoading = false;
  updateAgentMutate.mockReset();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// AC-28: Empty state + "Export to CI" button
// ---------------------------------------------------------------------------

describe("CiTab — AC-28: empty state and Export to CI button", () => {
  it("shows empty state when no installations", () => {
    mockState.installations = [];
    renderTab();

    expect(screen.getByTestId("ci-empty-state")).toBeInTheDocument();
    expect(screen.getByText(ciMessages.ciTab.empty)).toBeInTheDocument();
  });

  it("renders 'Export to CI' button with correct aria-label", () => {
    mockState.installations = [];
    renderTab();

    const btn = screen.getByTestId("export-to-ci-button");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-label", ciMessages.ciTab.exportToCi);
  });

  it("Export to CI button is keyboard-operable (opens wizard on Enter)", async () => {
    const user = userEvent.setup();
    mockState.installations = [];
    renderTab();

    const btn = screen.getByTestId("export-to-ci-button");
    btn.focus();
    await user.keyboard("{Enter}");

    // Wizard modal should appear
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens ExportWizard when Export to CI button is clicked", async () => {
    const user = userEvent.setup();
    mockState.installations = [];
    renderTab();

    const btn = screen.getByTestId("export-to-ci-button");
    await user.click(btn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-27: Installations list
// ---------------------------------------------------------------------------

describe("CiTab — AC-27: installations list", () => {
  beforeEach(() => {
    mockState.installations = [INSTALLATION_1];
  });

  it("renders the installations list container when installs exist", () => {
    renderTab();
    expect(screen.getByTestId("installations-list")).toBeInTheDocument();
  });

  it("shows target type badge for each installation", () => {
    renderTab();
    // GHA target badge
    expect(screen.getByText("GHA")).toBeInTheDocument();
  });

  it("shows repo name for each installation", () => {
    renderTab();
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
  });

  it("shows installation date", () => {
    renderTab();
    const dateEl = screen.getByTestId("install-date-install1");
    expect(dateEl).toBeInTheDocument();
    // Date should be non-empty
    expect(dateEl.textContent).toBeTruthy();
  });

  it("does NOT show empty state when installations exist", () => {
    renderTab();
    expect(screen.queryByTestId("ci-empty-state")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-30: CI run history sub-list
// ---------------------------------------------------------------------------

describe("CiTab — AC-30: CI run history sub-list", () => {
  beforeEach(() => {
    mockState.installations = [INSTALLATION_1];
    mockState.ciRuns = [CI_RUN_1, CI_RUN_2];
  });

  it("renders the CI runs list", () => {
    renderTab();
    expect(screen.getByTestId("ci-runs-list")).toBeInTheDocument();
  });

  it("renders each run with findings count", () => {
    renderTab();
    const findings1 = screen.getByTestId("run-findings-run1");
    expect(findings1).toHaveTextContent("3");
  });

  it("renders run status", () => {
    renderTab();
    // Statuses should be visible
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("renders PR number", () => {
    renderTab();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("#41")).toBeInTheDocument();
  });

  it("renders a 'View' link when github_url is present", () => {
    renderTab();
    const viewLinks = screen.getAllByText(ciMessages.runs.view);
    expect(viewLinks.length).toBeGreaterThanOrEqual(1);
    expect(viewLinks[0]).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/actions/runs/12345",
    );
  });

  it("shows empty run state when no CI runs exist", () => {
    mockState.ciRuns = [];
    renderTab();
    expect(screen.getByTestId("ci-runs-empty")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-29: ci_fail_on selector uses useUpdateAgent (not a new mutation)
// ---------------------------------------------------------------------------

describe("CiTab — AC-29: ci_fail_on selector calls useUpdateAgent", () => {
  beforeEach(() => {
    mockState.installations = [];
  });

  it("renders a ci_fail_on selector", () => {
    renderTab();
    // The SelectInput renders a <select>
    const selects = document.querySelectorAll("select");
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });

  it("calls useUpdateAgent.mutate when ci_fail_on changes", async () => {
    const user = userEvent.setup();
    renderTab();

    const selects = document.querySelectorAll("select");
    // First select is ci_fail_on
    const ciFailOnSelect = selects[0]!;
    await user.selectOptions(ciFailOnSelect, "warning");

    expect(updateAgentMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "agent1",
        patch: expect.objectContaining({ ci_fail_on: "warning" }),
      }),
    );
  });
});
