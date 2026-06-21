import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@/types";
import messages from "../../../../../../../messages/en/prReview.json";
import { FindingsCell } from "./FindingsCell";

afterEach(cleanup);

function withIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ITEMS: NonNullable<PrMeta["findings"]>["items"] = [
  {
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded API key",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    confidence: 0.95,
    rationale_excerpt: "A literal sk_live_… key is committed.",
  },
  {
    severity: "WARNING",
    category: "perf",
    title: "N+1 query",
    file: "src/api/users.ts",
    start_line: 46,
    end_line: 52,
    confidence: 0.86,
    rationale_excerpt: "Per-row query inside a loop.",
  },
  {
    severity: "SUGGESTION",
    category: "style",
    title: "Extract magic number",
    file: "src/util/time.ts",
    start_line: 8,
    end_line: 8,
    confidence: 0.62,
    rationale_excerpt: "Unexplained constant repeated twice.",
  },
];

describe("FindingsCell", () => {
  it("renders one pill per non-zero severity with its count", () => {
    withIntl(
      <FindingsCell
        findings={{
          counts: { CRITICAL: 1, WARNING: 2, SUGGESTION: 3 },
          items: ITEMS,
        }}
      />,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders em-dash when findings is null", () => {
    withIntl(<FindingsCell findings={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders em-dash when all severity counts are zero", () => {
    withIntl(
      <FindingsCell
        findings={{
          counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
          items: [],
        }}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the tooltip with finding titles on hover", () => {
    const { container } = withIntl(
      <FindingsCell
        findings={{
          counts: { CRITICAL: 1, WARNING: 1, SUGGESTION: 1 },
          items: ITEMS,
        }}
      />,
    );
    const cell = container.firstElementChild!;
    fireEvent.mouseEnter(cell);
    expect(screen.getByText("Hardcoded API key")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Extract magic number")).toBeInTheDocument();

    fireEvent.mouseLeave(cell);
    expect(screen.queryByText("Hardcoded API key")).not.toBeInTheDocument();
  });
});
