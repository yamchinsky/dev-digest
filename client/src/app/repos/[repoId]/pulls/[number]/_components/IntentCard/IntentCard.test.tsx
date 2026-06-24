/**
 * IntentCard — RTL flow tests (hermetic, jsdom).
 *
 * Hooks are mocked at the module boundary so no real fetch / QueryClient is
 * needed. All assertions are on user-visible text and ARIA roles.
 *
 * Scenarios:
 *   1. Empty state  — GET resolves { intent: null } → empty-state copy +
 *      "Derive intent" button rendered; clicking it fires the recompute mutation.
 *   2. Populated state — GET resolves a real Intent → intent text, in-scope
 *      list, out-of-scope list are all visible; "Recompute intent" button present.
 *   3. Recompute success — clicking "Recompute intent" in the populated state
 *      calls the mutation and, on success, shows the model badge.
 */
import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import intentMessages from "../../../../../../../../messages/en/intent.json";
import { IntentCard } from "./IntentCard";

// ---------------------------------------------------------------------------
// Hook mocks — declared before any import that resolves them.
// ---------------------------------------------------------------------------

const mutateMock = vi.fn();

const intentHookState = vi.hoisted(() => ({
  data: undefined as { intent: { intent: string; in_scope: string[]; out_of_scope: string[] } | null } | undefined,
  isLoading: false,
  mutateIsPending: false,
}));

vi.mock("@/lib/hooks/intent", () => ({
  useIntent: (_prId: string) => ({
    data: intentHookState.data,
    isLoading: intentHookState.isLoading,
  }),
  useRecomputeIntent: (_prId: string) => ({
    mutate: mutateMock,
    isPending: intentHookState.mutateIsPending,
  }),
}));

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderCard(prId = "pr-42") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ intent: intentMessages }}>
      <IntentCard prId={prId} />
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mutateMock.mockReset();
  intentHookState.data = undefined;
  intentHookState.isLoading = false;
  intentHookState.mutateIsPending = false;
});

afterEach(cleanup);

describe("IntentCard — empty state", () => {
  it("should render the empty-state title and body when GET returns { intent: null }", () => {
    intentHookState.data = { intent: null };
    renderCard();

    // The empty-state title from intent.json: "No intent derived yet"
    expect(screen.getByText("No intent derived yet")).toBeInTheDocument();
    // The body explains what the derive action does
    expect(
      screen.getByText(
        "Derive the intent to understand what this PR is trying to accomplish and its stated scope.",
      ),
    ).toBeInTheDocument();
    // The section heading is always present
    expect(screen.getByText("PR Intent")).toBeInTheDocument();
  });

  it("should render the 'Derive intent' button when no intent has been derived", () => {
    intentHookState.data = { intent: null };
    renderCard();

    // EmptyState renders its cta prop as a Button child
    expect(screen.getByRole("button", { name: /derive intent/i })).toBeInTheDocument();
  });

  it("should fire the recompute mutation when 'Derive intent' is clicked", async () => {
    const user = userEvent.setup();
    intentHookState.data = { intent: null };
    renderCard();

    await user.click(screen.getByRole("button", { name: /derive intent/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    // First arg is undefined (no mutation variables); second is the options bag
    expect(mutateMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });
});

describe("IntentCard — populated state", () => {
  const INTENT = {
    intent: "Refactor the authentication layer to use JWT tokens.",
    in_scope: ["auth module", "token validation"],
    out_of_scope: ["UI changes", "database migrations"],
  };

  beforeEach(() => {
    intentHookState.data = { intent: INTENT };
  });

  it("should render the intent text when a derived intent exists", () => {
    renderCard();

    expect(
      screen.getByText("Refactor the authentication layer to use JWT tokens."),
    ).toBeInTheDocument();
  });

  it("should render the in-scope and out-of-scope items", () => {
    renderCard();

    // Section labels
    expect(screen.getByText("In scope")).toBeInTheDocument();
    expect(screen.getByText("Out of scope")).toBeInTheDocument();

    // In-scope list items
    expect(screen.getByText("auth module")).toBeInTheDocument();
    expect(screen.getByText("token validation")).toBeInTheDocument();

    // Out-of-scope list items
    expect(screen.getByText("UI changes")).toBeInTheDocument();
    expect(screen.getByText("database migrations")).toBeInTheDocument();
  });

  it("should render the recompute button", () => {
    renderCard();

    expect(screen.getByRole("button", { name: /recompute intent/i })).toBeInTheDocument();
  });

  it("should NOT render the 'Derive intent' button or empty-state copy in the populated state", () => {
    renderCard();

    expect(screen.queryByRole("button", { name: /derive intent/i })).not.toBeInTheDocument();
    expect(screen.queryByText("No intent derived yet")).not.toBeInTheDocument();
  });
});

describe("IntentCard — recompute action", () => {
  const INTENT = {
    intent: "Add pagination to the user list endpoint.",
    in_scope: ["GET /users handler"],
    out_of_scope: ["frontend components"],
  };

  it("should fire the recompute mutation when 'Recompute intent' is clicked", async () => {
    const user = userEvent.setup();
    intentHookState.data = { intent: INTENT };
    renderCard();

    await user.click(screen.getByRole("button", { name: /recompute intent/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it("should show the model badge after a successful recompute", async () => {
    const user = userEvent.setup();

    // Make mutate synchronously call onSuccess so we can observe the state change.
    mutateMock.mockImplementation(
      (_vars: unknown, opts: { onSuccess: (res: { model: string }) => void }) => {
        opts.onSuccess({ model: "deepseek/deepseek-v4-flash" });
      },
    );

    intentHookState.data = { intent: INTENT };
    renderCard();

    await user.click(screen.getByRole("button", { name: /recompute intent/i }));

    // The model badge text uses the "producedBy" i18n key: "Produced by {model}"
    await waitFor(() =>
      expect(
        screen.getByText("Produced by deepseek/deepseek-v4-flash"),
      ).toBeInTheDocument(),
    );
  });
});
