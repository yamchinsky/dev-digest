/* ExportWizard.test.tsx — vitest+RTL tests for the CI Export Wizard.
 *
 * ACs covered:
 *   AC-1  GHA selected → Continue enabled once repo matches owner/name
 *   AC-2  CircleCI/Jenkins/Generic CLI disabled with "coming soon" badge
 *   AC-3  blank or invalid repo blocks Continue
 *   AC-4  preview step shows CiFile list (path visible)
 *   AC-5  editable file in <textarea>; non-editable in <pre>
 *   AC-6  DEVDIGEST_POST_AS present in workflow / absent from manifest (via preview mock)
 *   AC-7  trigger checkboxes: opened+synchronize checked+disabled, reopened unchecked+enabled
 *   AC-8  post_as selector default is "GitHub review"
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import ciMessages from "../../../../../../../../messages/en/ci.json";
import agentsMessages from "../../../../../../../../messages/en/agents.json";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const exportMutate = vi.fn();

const mockState = vi.hoisted(() => ({
  exportPending: false,
  previewData: undefined as { files: { path: string; contents: string; editable: boolean }[] } | undefined,
  previewLoading: false,
}));

vi.mock("@/lib/hooks/ci", () => ({
  useExportCi: () => ({
    mutate: exportMutate,
    isPending: mockState.exportPending,
  }),
  useCiInstallations: () => ({ data: undefined, isLoading: false }),
  useCiRuns: () => ({ data: [], isLoading: false }),
  useSyncCiRuns: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      // Only intercept ci-preview queries
      if (Array.isArray(queryKey) && queryKey[0] === "ci-preview") {
        return {
          data: mockState.previewData,
          isLoading: mockState.previewLoading,
          isError: false,
        };
      }
      return { data: undefined, isLoading: false, isError: false };
    },
  };
});

// Import AFTER mocks
import { ExportWizard } from "./ExportWizard";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKFLOW_CONTENTS = `name: DevDigest Review
on:
  pull_request:
    types: [opened, synchronize]
env:
  DEVDIGEST_POST_AS: github_review
jobs:
  review:
    runs-on: ubuntu-latest`;

const MANIFEST_CONTENTS = `name: my-agent
provider: openrouter
model: gpt-4o
system_prompt: You are a reviewer.
strategy: auto
ci_fail_on: critical`;

const MOCK_FILES = [
  {
    path: ".github/workflows/devdigest.yml",
    contents: WORKFLOW_CONTENTS,
    editable: true,
  },
  {
    path: ".devdigest/agents/my-agent.yaml",
    contents: MANIFEST_CONTENTS,
    editable: false,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const onClose = vi.fn();

function renderWizard() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ci: ciMessages, agents: agentsMessages }}
    >
      <ExportWizard agentId="agent1" agentName="Test Agent" onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

async function advanceToStep(step: number, repoValue = "acme/payments-api") {
  const user = userEvent.setup();
  if (step === 0) return user;

  // Fill repo and advance from step 0 → 1
  const repoInput = screen.getByTestId("repo-input");
  await user.clear(repoInput);
  await user.type(repoInput, repoValue);
  const continueBtn = screen.getByRole("button", {
    name: ciMessages.exportWizard.continue,
  });
  await user.click(continueBtn);

  if (step === 1) return user;

  // Advance to step 2
  const continueBtn2 = screen.getByRole("button", {
    name: ciMessages.exportWizard.continue,
  });
  await user.click(continueBtn2);

  if (step === 2) return user;

  // Advance to step 3
  const continueBtn3 = screen.getByRole("button", {
    name: ciMessages.exportWizard.continue,
  });
  await user.click(continueBtn3);

  return user;
}

beforeEach(() => {
  mockState.exportPending = false;
  mockState.previewData = undefined;
  mockState.previewLoading = false;
  exportMutate.mockReset();
  onClose.mockReset();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// AC-1: GHA selected → Continue enabled when repo matches owner/name
// ---------------------------------------------------------------------------

describe("ExportWizard — AC-1: GHA selected enables Continue with valid repo", () => {
  it("Continue is disabled initially (no repo entered)", () => {
    renderWizard();
    const continueBtn = screen.getByRole("button", {
      name: ciMessages.exportWizard.continue,
    });
    expect(continueBtn).toBeDisabled();
  });

  it("Continue is enabled when GHA is selected and repo matches owner/name", async () => {
    const user = userEvent.setup();
    renderWizard();

    const repoInput = screen.getByTestId("repo-input");
    await user.type(repoInput, "acme/payments-api");

    const continueBtn = screen.getByRole("button", {
      name: ciMessages.exportWizard.continue,
    });
    expect(continueBtn).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// AC-2: CircleCI / Jenkins / Generic CLI disabled with "coming soon" badge
// ---------------------------------------------------------------------------

describe("ExportWizard — AC-2: non-GHA targets disabled with coming soon badge", () => {
  it("shows coming soon badge for CircleCI", () => {
    renderWizard();
    expect(screen.getByTestId("coming-soon-circle")).toBeInTheDocument();
  });

  it("shows coming soon badge for Jenkins", () => {
    renderWizard();
    expect(screen.getByTestId("coming-soon-jenkins")).toBeInTheDocument();
  });

  it("shows coming soon badge for Generic CLI", () => {
    renderWizard();
    expect(screen.getByTestId("coming-soon-cli")).toBeInTheDocument();
  });

  it("CircleCI option has aria-disabled", () => {
    renderWizard();
    const circle = screen.getByTestId("target-option-circle");
    expect(circle).toHaveAttribute("aria-disabled", "true");
  });

  it("Jenkins option has aria-disabled", () => {
    renderWizard();
    const jenkins = screen.getByTestId("target-option-jenkins");
    expect(jenkins).toHaveAttribute("aria-disabled", "true");
  });

  it("Generic CLI option has aria-disabled", () => {
    renderWizard();
    const cli = screen.getByTestId("target-option-cli");
    expect(cli).toHaveAttribute("aria-disabled", "true");
  });
});

// ---------------------------------------------------------------------------
// AC-3: Blank or invalid repo blocks Continue
// ---------------------------------------------------------------------------

describe("ExportWizard — AC-3: invalid repo blocks Continue", () => {
  it("Continue disabled with blank repo", () => {
    renderWizard();
    // Leave repo blank
    const continueBtn = screen.getByRole("button", {
      name: ciMessages.exportWizard.continue,
    });
    expect(continueBtn).toBeDisabled();
  });

  it("Continue disabled with repo missing slash (not owner/name)", async () => {
    const user = userEvent.setup();
    renderWizard();

    const repoInput = screen.getByTestId("repo-input");
    await user.type(repoInput, "payments-api");

    const continueBtn = screen.getByRole("button", {
      name: ciMessages.exportWizard.continue,
    });
    expect(continueBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// AC-4 / AC-5: Preview shows files; editable in textarea, non-editable in pre
// ---------------------------------------------------------------------------

describe("ExportWizard — AC-4/5: preview step renders files correctly", () => {
  beforeEach(() => {
    mockState.previewData = { files: MOCK_FILES };
  });

  it("shows the path of each generated file", async () => {
    renderWizard();
    await advanceToStep(1);

    expect(
      screen.getByText(".github/workflows/devdigest.yml"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(".devdigest/agents/my-agent.yaml"),
    ).toBeInTheDocument();
  });

  it("renders editable file in a textarea", async () => {
    renderWizard();
    await advanceToStep(1);

    const textarea = screen.getByTestId(
      "file-editor-.github-workflows-devdigest.yml",
    );
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveValue(WORKFLOW_CONTENTS);
  });

  it("renders non-editable file in a pre element", async () => {
    renderWizard();
    await advanceToStep(1);

    const pre = screen.getByTestId(
      "file-preview-.devdigest-agents-my-agent.yaml",
    );
    expect(pre.tagName).toBe("PRE");
    expect(pre).toHaveTextContent("my-agent");
  });
});

// ---------------------------------------------------------------------------
// AC-6: DEVDIGEST_POST_AS in workflow, absent from manifest
// ---------------------------------------------------------------------------

describe("ExportWizard — AC-6: DEVDIGEST_POST_AS in workflow / absent from manifest", () => {
  beforeEach(() => {
    mockState.previewData = { files: MOCK_FILES };
  });

  it("workflow file contents include DEVDIGEST_POST_AS", async () => {
    renderWizard();
    await advanceToStep(1);

    const textarea = screen.getByTestId(
      "file-editor-.github-workflows-devdigest.yml",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain("DEVDIGEST_POST_AS");
  });

  it("manifest file contents do NOT contain post_as", async () => {
    renderWizard();
    await advanceToStep(1);

    const pre = screen.getByTestId(
      "file-preview-.devdigest-agents-my-agent.yaml",
    );
    expect(pre.textContent).not.toContain("post_as");
  });
});

// ---------------------------------------------------------------------------
// AC-7: Configure checkboxes
// ---------------------------------------------------------------------------

describe("ExportWizard — AC-7: trigger checkboxes in Configure step", () => {
  beforeEach(() => {
    mockState.previewData = { files: MOCK_FILES };
  });

  it("opened checkbox is checked and disabled", async () => {
    renderWizard();
    await advanceToStep(2);

    const cb = screen.getByTestId("checkbox-opened");
    expect(cb).toBeChecked();
    expect(cb).toBeDisabled();
  });

  it("synchronize checkbox is checked and disabled", async () => {
    renderWizard();
    await advanceToStep(2);

    const cb = screen.getByTestId("checkbox-synchronize");
    expect(cb).toBeChecked();
    expect(cb).toBeDisabled();
  });

  it("reopened checkbox is unchecked and enabled by default", async () => {
    renderWizard();
    await advanceToStep(2);

    const cb = screen.getByTestId("checkbox-reopened");
    expect(cb).not.toBeChecked();
    expect(cb).not.toBeDisabled();
  });

  it("reopened checkbox becomes checked when clicked", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToStep(2);

    const cb = screen.getByTestId("checkbox-reopened");
    await user.click(cb);
    expect(cb).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// AC-8: post_as selector
// ---------------------------------------------------------------------------

describe("ExportWizard — AC-8: post_as selector defaults to GitHub review", () => {
  beforeEach(() => {
    mockState.previewData = { files: MOCK_FILES };
  });

  it("post_as selector defaults to github_review", async () => {
    renderWizard();
    await advanceToStep(2);

    const sel = screen.getByTestId("post-as-select");
    expect((sel as HTMLSelectElement).value).toBe("github_review");
  });

  it("post_as selector has all 3 options", async () => {
    renderWizard();
    await advanceToStep(2);

    const sel = screen.getByTestId("post-as-select");
    const options = Array.from((sel as HTMLSelectElement).options).map(
      (o) => o.value,
    );
    expect(options).toContain("github_review");
    expect(options).toContain("pr_comment");
    expect(options).toContain("none");
  });

  it("user can change post_as to pr_comment", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToStep(2);

    const sel = screen.getByTestId("post-as-select");
    await user.selectOptions(sel, "pr_comment");
    expect((sel as HTMLSelectElement).value).toBe("pr_comment");
  });
});
