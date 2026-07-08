/* EvalsTab.test.tsx — vitest+jsdom tests for the Skills Lab benchmark tab.
 *
 * Pattern mirrors AgentEditor/EvalsTab.test.tsx:
 *  – vi.hoisted for shared mutable hook state
 *  – vi.mock("@/lib/hooks/skills") intercepting the two benchmark hooks
 *  – NextIntlClientProvider with skills.json messages
 *
 * Covers: summary table (with_skill/without_skill/Δ), qualitative diff,
 * empty state, run button disabled while running, run history.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillBenchmarkRun } from "@devdigest/shared";
import skillsMessages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";

const startMutate = vi.fn();

const hooksState = vi.hoisted(() => ({
  benchmarks: {
    data: undefined as SkillBenchmarkRun[] | undefined,
    isLoading: false,
    isError: false,
  },
  startPending: false,
}));

vi.mock("@/lib/hooks/skills", () => ({
  useSkillBenchmarks: (_skillId: string) => ({
    ...hooksState.benchmarks,
    refetch: vi.fn(),
  }),
  useStartSkillBenchmark: (_skillId: string) => ({
    mutate: startMutate,
    isPending: hooksState.startPending,
  }),
}));

import { EvalsTab } from "./EvalsTab";

const SKILL: Skill = {
  id: "skill1",
  name: "branch-coverage-rubric",
  description: "Flag uncovered branches.",
  type: "rubric",
  source: "manual",
  body: "# Branch coverage",
  enabled: true,
  version: 1,
};

const DONE_RUN: SkillBenchmarkRun = {
  id: "run1",
  skill_id: "skill1",
  workspace_id: "ws1",
  status: "done",
  skill_version: 1,
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  with_skill: { checks_passed: 7, checks_total: 7, pass_rate: 1, duration_ms: 112_000, tokens: 33_268 },
  without_skill: { checks_passed: 4, checks_total: 7, pass_rate: 4 / 7, duration_ms: 66_000, tokens: 16_346 },
  cases: [
    {
      name: "discount-boundary-branch",
      aspects: [
        { aspect: "Uncovered else branch", with_skill: "flags the untested else", without_skill: "generic", with_pass: true, without_pass: true },
        { aspect: "Boundary value tested", with_skill: "calls out the boundary", without_skill: "—", with_pass: true, without_pass: false },
      ],
    },
  ],
  cost_usd: 0.0123,
  error: null,
  created_at: "2026-07-08T10:00:00Z",
  finished_at: "2026-07-08T10:02:00Z",
};

const RUNNING_RUN: SkillBenchmarkRun = {
  ...DONE_RUN,
  id: "run2",
  status: "running",
  with_skill: null,
  without_skill: null,
  cases: [],
  finished_at: null,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>
      <ToastProvider>
        <EvalsTab skill={SKILL} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  hooksState.benchmarks = { data: [DONE_RUN], isLoading: false, isError: false };
  hooksState.startPending = false;
});

afterEach(() => {
  cleanup();
  startMutate.mockClear();
});

describe("Skills EvalsTab — summary", () => {
  it("renders the with_skill / without_skill pass rates and token delta", () => {
    renderTab();
    expect(screen.getByText("100% (7/7)")).toBeInTheDocument();
    expect(screen.getByText("57% (4/7)")).toBeInTheDocument();
    // token delta = 33268 - 16346 = 16922
    expect(screen.getByText("+16,922")).toBeInTheDocument();
  });

  it("renders the qualitative diff aspects", () => {
    renderTab();
    expect(screen.getByText("discount-boundary-branch")).toBeInTheDocument();
    expect(screen.getByText("Uncovered else branch")).toBeInTheDocument();
    expect(screen.getByText("Boundary value tested")).toBeInTheDocument();
  });
});

describe("Skills EvalsTab — empty state", () => {
  it("shows the empty state when there are no runs", () => {
    hooksState.benchmarks = { data: [], isLoading: false, isError: false };
    renderTab();
    expect(screen.getByText(skillsMessages.benchmark.empty.title)).toBeInTheDocument();
  });
});

describe("Skills EvalsTab — run controls", () => {
  it("starts a benchmark when the Run button is clicked", async () => {
    hooksState.benchmarks = { data: [], isLoading: false, isError: false };
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByRole("button", { name: /run benchmark/i }));
    expect(startMutate).toHaveBeenCalledTimes(1);
  });

  it("disables the Run button while a benchmark is running", () => {
    hooksState.benchmarks = { data: [RUNNING_RUN], isLoading: false, isError: false };
    renderTab();
    expect(screen.getByRole("button", { name: /running/i })).toBeDisabled();
  });
});

describe("Skills EvalsTab — history", () => {
  it("lists each run with its model and status", () => {
    renderTab();
    expect(screen.getByText(skillsMessages.benchmark.history)).toBeInTheDocument();
    expect(screen.getAllByText("deepseek/deepseek-v4-flash").length).toBeGreaterThan(0);
  });
});
