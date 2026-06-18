import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunCostBadge } from "./RunCostBadge";

afterEach(cleanup);

describe("RunCostBadge", () => {
  it("compact: shows the dollar amount for a sub-cent cost", () => {
    render(<RunCostBadge cost={0.012} />);
    expect(screen.getByText("$0.012")).toBeInTheDocument();
  });

  it("compact: ≥$1 renders with 2 decimals", () => {
    render(<RunCostBadge cost={1.2} />);
    expect(screen.getByText("$1.20")).toBeInTheDocument();
  });

  it("renders '—' for null cost — never '$0.00' for missing data", () => {
    render(<RunCostBadge cost={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("renders '$0.00' for a legitimate zero cost (free model)", () => {
    render(<RunCostBadge cost={0} />);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("full variant: combines token totals with the dollar amount", () => {
    render(<RunCostBadge cost={0.001} tokensIn={9119} tokensOut={1234} variant="full" />);
    expect(screen.getByText(/9\.1K→1\.2K tok · \$0\.001/)).toBeInTheDocument();
  });

  it("full variant: when tokens are missing, only the dollar amount renders", () => {
    render(<RunCostBadge cost={0.001} variant="full" />);
    expect(screen.getByText("$0.001")).toBeInTheDocument();
    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
  });
});
