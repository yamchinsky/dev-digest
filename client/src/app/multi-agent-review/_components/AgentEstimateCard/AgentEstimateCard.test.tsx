import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../messages/en/multiAgentReview.json";
import { AgentEstimateCard } from "./AgentEstimateCard";

afterEach(cleanup);

const BASE_AGENT: Agent = {
  id: "ag-1",
  name: "Security Reviewer",
  description: "Looks for vulnerabilities",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderCard(props: {
  agent: Agent;
  checked: boolean;
  onToggle?: (id: string) => void;
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgentReview: messages }}>
      <AgentEstimateCard
        agent={props.agent}
        checked={props.checked}
        onToggle={props.onToggle ?? vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("AgentEstimateCard", () => {
  it("renders agent name and description", () => {
    renderCard({ agent: BASE_AGENT, checked: false });
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Looks for vulnerabilities")).toBeInTheDocument();
  });

  it("shows numeric estimates when available (AC-4)", () => {
    const agent: Agent = {
      ...BASE_AGENT,
      estimate: { duration_avg_ms: 45000, cost_avg_usd: 0.03 },
    };
    renderCard({ agent, checked: true });
    // ~45s duration
    expect(screen.getByText("~45s")).toBeInTheDocument();
    // ~$0.03 cost
    expect(screen.getByText("~$0.03")).toBeInTheDocument();
  });

  it("shows ~? and ~$? when estimate is null (AC-5)", () => {
    const agent: Agent = {
      ...BASE_AGENT,
      estimate: { duration_avg_ms: null, cost_avg_usd: null },
    };
    renderCard({ agent, checked: false });
    expect(screen.getByText("~?")).toBeInTheDocument();
    expect(screen.getByText("~$?")).toBeInTheDocument();
  });

  it("shows ~? and ~$? when estimate field is absent (AC-5)", () => {
    const agent: Agent = { ...BASE_AGENT, estimate: undefined };
    renderCard({ agent, checked: false });
    expect(screen.getByText("~?")).toBeInTheDocument();
    expect(screen.getByText("~$?")).toBeInTheDocument();
  });

  it("calls onToggle with agent id when clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const agent: Agent = {
      ...BASE_AGENT,
      estimate: { duration_avg_ms: 10000, cost_avg_usd: 0.01 },
    };
    renderCard({ agent, checked: false, onToggle });
    await user.click(screen.getByText("Security Reviewer"));
    expect(onToggle).toHaveBeenCalledWith("ag-1");
  });

  it("reflects checked state visually via aria-checked", () => {
    renderCard({ agent: BASE_AGENT, checked: true });
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });
});
