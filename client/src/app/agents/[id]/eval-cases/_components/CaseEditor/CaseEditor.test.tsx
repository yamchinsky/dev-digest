/* CaseEditor tests — AC-7 (fields + Run Case presence) and AC-8 (validation).
   Mocks all eval hooks so no network or QueryClient is needed.
   T8's caseEditor.expectation.* keys are stubbed inline so this file
   does not depend on T8's eval.json edit landing first. */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase } from "@devdigest/shared";
import evalJson from "../../../../../../../messages/en/eval.json";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Stub router so the component can call router.push without crashing.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

// Stub eval mutation hooks — expose spies so AC-8 can assert zero calls.
const createMutateMock = vi.fn();
const updateMutateMock = vi.fn();
const runMutateMock = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({
    mutate: createMutateMock,
    isPending: false,
  }),
  useUpdateEvalCase: () => ({
    mutate: updateMutateMock,
    isPending: false,
  }),
  useRunEvalCase: () => ({
    mutate: runMutateMock,
    isPending: false,
    isSuccess: false,
    data: undefined,
  }),
}));

// Delay component import until mocks are registered.
import { CaseEditor } from "./CaseEditor";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** eval.json + stub expectation keys that T8 will add (parallel task). */
const messages = {
  eval: {
    ...evalJson,
    caseEditor: {
      ...evalJson.caseEditor,
      expectation: {
        type: "Type",
        file: "File",
        startLine: "Start line",
        endLine: "End line",
        note: "Note",
        mustFind: "Must find",
        mustNotFlag: "Must not flag",
      },
    },
  },
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// Minimal EvalCase for edit-mode tests.
const EDIT_CASE: EvalCase = {
  id: "case-001",
  owner_kind: "agent",
  owner_id: "agent-001",
  name: "Test stripe leak",
  input_diff: "+  stripeKey: 'sk_live_...'",
  input_files: null,
  input_meta: { title: "Add Stripe", body: "Wire up payments." },
  expected_output: {
    type: "must_find",
    file: "src/config.ts",
    start_line: 10,
    end_line: 15,
  },
  notes: null,
};

// ---------------------------------------------------------------------------
// AC-7: Fields + Run Case button presence
// ---------------------------------------------------------------------------

describe("CaseEditor — AC-7: fields present", () => {
  it("new mode: renders all form fields and NO Run Case button", () => {
    renderWithIntl(<CaseEditor agentId="agent-001" />);

    // Name field
    expect(screen.getByText("Name")).toBeInTheDocument();
    // Input section with Diff tab
    expect(screen.getByText("Diff")).toBeInTheDocument();
    // PR meta tab
    expect(screen.getByText("PR meta")).toBeInTheDocument();
    // Expected output section
    expect(screen.getByText("Expected output")).toBeInTheDocument();
    // Type select
    expect(screen.getByText("Type")).toBeInTheDocument();
    // File input
    expect(screen.getByText("File")).toBeInTheDocument();
    // Line inputs
    expect(screen.getByText("Start line")).toBeInTheDocument();
    expect(screen.getByText("End line")).toBeInTheDocument();
    // Save button present
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    // Run Case button ABSENT in new mode
    expect(
      screen.queryByRole("button", { name: /run case/i }),
    ).not.toBeInTheDocument();
  });

  it("edit mode: renders all form fields AND the Run Case button", () => {
    renderWithIntl(
      <CaseEditor
        agentId="agent-001"
        caseId="case-001"
        initialValues={EDIT_CASE}
      />,
    );

    // Name is pre-filled
    expect(screen.getByDisplayValue("Test stripe leak")).toBeInTheDocument();
    // Save button
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    // Run Case button IS present
    expect(
      screen.getByRole("button", { name: /run case/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-8: Client-side validation — start_line > end_line
// ---------------------------------------------------------------------------

describe("CaseEditor — AC-8: start_line > end_line validation", () => {
  it("shows inline error and does not call mutate when start_line > end_line", async () => {
    const user = userEvent.setup();
    renderWithIntl(<CaseEditor agentId="agent-001" />);

    // Find the numeric inputs by aria-label
    const startInput = screen.getByRole("spinbutton", { name: /start line/i });
    const endInput = screen.getByRole("spinbutton", { name: /end line/i });

    // Enter start_line=10, end_line=5 (invalid: 10 > 5)
    await user.clear(startInput);
    await user.type(startInput, "10");
    await user.clear(endInput);
    await user.type(endInput, "5");

    // Submit
    await user.click(screen.getByRole("button", { name: /save/i }));

    // Validation error is visible
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toMatch(/start_line/i);

    // No fetch/mutate calls
    expect(createMutateMock).not.toHaveBeenCalled();
    expect(updateMutateMock).not.toHaveBeenCalled();
  });

  it("does not show an error when start_line ≤ end_line", async () => {
    const user = userEvent.setup();
    renderWithIntl(<CaseEditor agentId="agent-001" />);

    const startInput = screen.getByRole("spinbutton", { name: /start line/i });
    const endInput = screen.getByRole("spinbutton", { name: /end line/i });

    await user.clear(startInput);
    await user.type(startInput, "5");
    await user.clear(endInput);
    await user.type(endInput, "10");

    await user.click(screen.getByRole("button", { name: /save/i }));

    // No validation alert
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // create was called (validation passed)
    expect(createMutateMock).toHaveBeenCalledOnce();
  });
});
