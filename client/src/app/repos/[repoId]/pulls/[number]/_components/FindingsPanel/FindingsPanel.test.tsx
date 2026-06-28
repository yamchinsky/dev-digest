import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function mkFinding(over: Partial<FindingRecord> & Pick<FindingRecord, "id" | "title">): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: `${over.title} rationale.`,
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

const FINDINGS: FindingRecord[] = [mkFinding({ id: "f1", title: "Hardcoded secret" })];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel deep-link (targetFindingId)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (Element.prototype as any).scrollIntoView;
  });

  it("expands the deep-linked card even when it is not the first one", () => {
    // Sorted by severity: the CRITICAL card renders first (auto-expanded), the
    // SUGGESTION card second — yet targeting the second must expand it too.
    const findings = [
      mkFinding({ id: "crit", title: "Critical issue", severity: "CRITICAL" }),
      mkFinding({ id: "sugg", title: "Minor nit", severity: "SUGGESTION" }),
    ];

    renderWithIntl(<FindingsPanel findings={findings} prId="pr1" targetFindingId="sugg" />);

    // The targeted (second) card's rationale body is visible.
    expect(screen.getByText("Minor nit rationale.")).toBeInTheDocument();
  });
});
