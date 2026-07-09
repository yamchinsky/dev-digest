import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiAgentReviewResults.json";
import { DisagreementBlock } from "./DisagreementBlock";
import type { GroupedLocation } from "../../_lib/groupFindingsByLocation";

afterEach(cleanup);

function makeRunSummary(id: string, name: string): RunSummary {
  return {
    run_id: id,
    agent_id: `agent-${id}`,
    agent_name: name,
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    findings_count: 1,
    grounding: "1/1 passed",
    ran_at: "2026-07-09T00:00:00.000Z",
    score: 80,
    blockers: 0,
    cost_usd: 0.002,
  };
}

function makeConflictGroup(runIds: string[]): GroupedLocation {
  const cells: Record<string, { severity: string; title: string } | "did-not-flag"> = {};
  const [firstId, ...restIds] = runIds;
  if (firstId) cells[firstId] = { severity: "WARNING", title: "SQL Injection" };
  for (const id of restIds) {
    cells[id] = "did-not-flag";
  }
  return {
    file: "src/foo.ts",
    startLine: 10,
    endLine: 20,
    cells,
    isConflict: true,
  };
}

function makeAgreeGroup(runIds: string[]): GroupedLocation {
  const cells: Record<string, { severity: string; title: string } | "did-not-flag"> = {};
  for (const id of runIds) {
    cells[id] = { severity: "CRITICAL", title: "XSS" };
  }
  return {
    file: "src/bar.ts",
    startLine: 5,
    endLine: 8,
    cells,
    isConflict: false,
  };
}

function renderBlock(props: Partial<React.ComponentProps<typeof DisagreementBlock>> = {}) {
  const runIds = props.runIds ?? ["run-1", "run-2"];
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgentReviewResults: messages }}>
      <DisagreementBlock
        groups={props.groups ?? []}
        runSummaries={props.runSummaries ?? [makeRunSummary("run-1", "Agent A"), makeRunSummary("run-2", "Agent B")]}
        runIds={runIds}
      />
    </NextIntlClientProvider>,
  );
}

describe("DisagreementBlock — empty states", () => {
  it("shows 'single agent' message when only one run id is present (AC-15 edge case)", () => {
    renderBlock({ runIds: ["run-1"] });
    expect(screen.getByText(/no cross-agent data/i)).toBeInTheDocument();
  });

  it("shows 'all agents agree' message when groups is empty (AC-15 edge case)", () => {
    renderBlock({ groups: [] });
    expect(screen.getByText(/all agents agree/i)).toBeInTheDocument();
  });
});

describe("DisagreementBlock — rendering groups (AC-15)", () => {
  it("renders conflict groups with flagged and did-not-flag cells", () => {
    const group = makeConflictGroup(["run-1", "run-2"]);
    renderBlock({ groups: [group] });

    expect(screen.getByText("SQL Injection")).toBeInTheDocument();
    expect(screen.getByText(/did not flag/i)).toBeInTheDocument();
    expect(screen.getByText("Agent A")).toBeInTheDocument();
    expect(screen.getByText("Agent B")).toBeInTheDocument();
  });

  it("shows file:line location for each group", () => {
    const group = makeConflictGroup(["run-1", "run-2"]);
    renderBlock({ groups: [group] });

    expect(screen.getByText(/src\/foo\.ts:10/)).toBeInTheDocument();
  });

  it("renders multiple groups", () => {
    const g1 = makeConflictGroup(["run-1", "run-2"]);
    const g2 = makeAgreeGroup(["run-1", "run-2"]);
    renderBlock({ groups: [g1, g2] });

    expect(screen.getByText(/src\/foo\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/src\/bar\.ts/)).toBeInTheDocument();
  });
});

describe("DisagreementBlock — Show only conflicts toggle (AC-16)", () => {
  it("toggle is accessible via keyboard — role=switch, aria-checked", () => {
    const group = makeConflictGroup(["run-1", "run-2"]);
    renderBlock({ groups: [group] });

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("with toggle OFF, both conflict and non-conflict groups are shown", () => {
    const conflict = makeConflictGroup(["run-1", "run-2"]);
    const agree = makeAgreeGroup(["run-1", "run-2"]);
    renderBlock({ groups: [conflict, agree] });

    // Both file names should be visible
    expect(screen.getByText(/src\/foo\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/src\/bar\.ts/)).toBeInTheDocument();
  });

  it("with toggle ON, only conflict groups are shown", async () => {
    const user = userEvent.setup();
    const conflict = makeConflictGroup(["run-1", "run-2"]);
    const agree = makeAgreeGroup(["run-1", "run-2"]);
    renderBlock({ groups: [conflict, agree] });

    const toggle = screen.getByRole("switch");
    await user.click(toggle);

    // Now only conflict group remains
    expect(screen.getByText(/src\/foo\.ts/)).toBeInTheDocument();
    expect(screen.queryByText(/src\/bar\.ts/)).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("shows empty message when conflicts toggle is ON but no conflict groups exist", async () => {
    const user = userEvent.setup();
    const agree = makeAgreeGroup(["run-1", "run-2"]);
    renderBlock({ groups: [agree] });

    const toggle = screen.getByRole("switch");
    await user.click(toggle);

    expect(screen.getByText(/no conflicts with current filter/i)).toBeInTheDocument();
  });

  it("toggle is keyboard-operable with Space", async () => {
    const user = userEvent.setup();
    const group = makeConflictGroup(["run-1", "run-2"]);
    renderBlock({ groups: [group] });

    const toggle = screen.getByRole("switch");
    toggle.focus();
    await user.keyboard(" ");

    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
