import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard deep-link (targetFindingId)", () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
  });
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (Element.prototype as any).scrollIntoView;
  });

  it("expands and scrolls into view when targetFindingId matches", () => {
    renderWithIntl(<FindingCard f={FINDING} targetFindingId={FINDING.id} onAction={() => {}} />);

    // Body (rationale) becomes visible even though defaultExpanded is unset.
    expect(screen.getByText(/A.*Stripe key is committed/)).toBeInTheDocument();
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("stays collapsed and does not scroll when targetFindingId does not match", () => {
    renderWithIntl(<FindingCard f={FINDING} targetFindingId="other-id" onAction={() => {}} />);

    // Collapsed: the rationale body is not rendered.
    expect(screen.queryByText(/A.*Stripe key is committed/)).not.toBeInTheDocument();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});

describe("FindingCard — createEvalCase button", () => {
  const ACCEPTED: FindingRecord = { ...FINDING, accepted_at: "2024-01-01T00:00:00Z" };
  const DISMISSED: FindingRecord = { ...FINDING, dismissed_at: "2024-01-01T00:00:00Z" };

  it("shows 'Create eval case' button for an accepted finding and fires the callback on click", async () => {
    const user = userEvent.setup();
    const onCreateEvalCase = vi.fn();
    renderWithIntl(
      <FindingCard
        f={ACCEPTED}
        defaultExpanded
        onAction={() => {}}
        onCreateEvalCase={onCreateEvalCase}
      />,
    );
    const btn = screen.getByRole("button", { name: /create eval case/i });
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(onCreateEvalCase).toHaveBeenCalledOnce();
  });

  it("shows 'Create eval case' button for a dismissed finding", () => {
    renderWithIntl(
      <FindingCard
        f={DISMISSED}
        defaultExpanded
        onAction={() => {}}
        onCreateEvalCase={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /create eval case/i })).toBeInTheDocument();
  });

  it("does not show 'Create eval case' button for an undecided finding", () => {
    renderWithIntl(
      <FindingCard
        f={FINDING}
        defaultExpanded
        onAction={() => {}}
        onCreateEvalCase={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /create eval case/i }),
    ).not.toBeInTheDocument();
  });
});
