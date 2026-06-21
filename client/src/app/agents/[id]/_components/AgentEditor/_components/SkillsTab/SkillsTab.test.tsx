import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";

/* We mock the hook layer (not the network) and switch its return values per
   test by mutating `hooksState`. The component tree never sees React Query —
   the contract under test is "what does SkillsTab render and emit for each
   hook state combination", so a per-test toggle is more legible than spinning
   up a real QueryClient with `fetch` stubs. */
const setSkillsMutate = vi.fn();
const refetchAllFn = vi.fn();
const refetchLinksFn = vi.fn();

type HookState<T> = { data: T | undefined; isLoading: boolean; isError: boolean };
const hooksState = vi.hoisted(() => ({
  useSkills: { data: undefined, isLoading: false, isError: false } as HookState<unknown>,
  useAgentSkills: { data: undefined, isLoading: false, isError: false } as HookState<unknown>,
  useSetAgentSkills: { isError: false } as { isError: boolean },
}));

vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ ...hooksState.useSkills, refetch: refetchAllFn }),
  useAgentSkills: (_id: string) => ({ ...hooksState.useAgentSkills, refetch: refetchLinksFn }),
  useSetAgentSkills: () => ({ mutate: setSkillsMutate, isError: hooksState.useSetAgentSkills.isError }),
}));

import { SkillsTab } from "./SkillsTab";

const ALL_SKILLS: Skill[] = [
  {
    id: "sk1",
    name: "branch-coverage-rubric",
    description: "Check both sides of every branch.",
    type: "rubric",
    source: "manual",
    body: "# rubric",
    enabled: true,
    version: 1,
  },
  {
    id: "sk2",
    name: "corner-case-checklist",
    description: "Common edge cases for new public surfaces.",
    type: "rubric",
    source: "manual",
    body: "# checklist",
    enabled: true,
    version: 1,
  },
  {
    id: "sk3",
    name: "flake-patterns",
    description: "Detect flaky test patterns.",
    type: "custom",
    source: "extracted",
    body: "# flakes",
    enabled: true,
    version: 1,
  },
];

const LINKED: AgentSkillLink[] = [
  { agent_id: "tqr", skill_id: "sk1", order: 0 },
  { agent_id: "tqr", skill_id: "sk2", order: 1 },
];

const AGENT: Agent = {
  id: "tqr",
  name: "Test Quality Reviewer",
  description: "x",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "x",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ agents: agentsMessages, skills: skillsMessages }}
    >
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

function loadedHappyPath() {
  hooksState.useSkills = { data: ALL_SKILLS, isLoading: false, isError: false };
  hooksState.useAgentSkills = { data: LINKED, isLoading: false, isError: false };
  hooksState.useSetAgentSkills = { isError: false };
}

beforeEach(() => {
  loadedHappyPath();
});

afterEach(() => {
  cleanup();
  setSkillsMutate.mockClear();
  refetchAllFn.mockClear();
  refetchLinksFn.mockClear();
});

describe("AgentEditor → Skills tab", () => {
  it("renders the enabled-count badge based on linked skills", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();
  });

  it("renders linked skills before unlinked ones", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    const names = screen.getAllByText(/-rubric|checklist|flake-patterns/);
    expect(names.map((n) => n.textContent)).toEqual([
      "branch-coverage-rubric",
      "corner-case-checklist",
      "flake-patterns",
    ]);
  });

  it("posts the new skill_ids array when linking an unlinked skill", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SkillsTab agent={AGENT} />);
    // The three Checkbox primitives are role=checkbox; index 2 = flake-patterns
    // (unlinked). Clicking should append its id and fire the mutation.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    await user.click(checkboxes[2]!);
    expect(setSkillsMutate).toHaveBeenCalledTimes(1);
    expect(setSkillsMutate).toHaveBeenCalledWith({
      agentId: "tqr",
      skillIds: ["sk1", "sk2", "sk3"],
    });
  });

  it("removes the id when unlinking an already-linked skill", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SkillsTab agent={AGENT} />);
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]!); // sk1 currently linked → unlink
    expect(setSkillsMutate).toHaveBeenCalledWith({
      agentId: "tqr",
      skillIds: ["sk2"],
    });
  });
});

describe("AgentEditor → Skills tab — filter", () => {
  it("filters by name (case-insensitive)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SkillsTab agent={AGENT} />);
    const filter = screen.getByPlaceholderText(/filter/i);
    await user.type(filter, "FLAKE");
    expect(screen.queryByText("branch-coverage-rubric")).not.toBeInTheDocument();
    expect(screen.queryByText("corner-case-checklist")).not.toBeInTheDocument();
    expect(screen.getByText("flake-patterns")).toBeInTheDocument();
  });

  it("filters by description (case-insensitive)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SkillsTab agent={AGENT} />);
    const filter = screen.getByPlaceholderText(/filter/i);
    await user.type(filter, "edge cases");
    // sk2's description matches; sk1/sk3 don't.
    expect(screen.getByText("corner-case-checklist")).toBeInTheDocument();
    expect(screen.queryByText("branch-coverage-rubric")).not.toBeInTheDocument();
    expect(screen.queryByText("flake-patterns")).not.toBeInTheDocument();
  });

  it("shows zero rows when the needle matches nothing", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SkillsTab agent={AGENT} />);
    const filter = screen.getByPlaceholderText(/filter/i);
    await user.type(filter, "zzznomatchzzz");
    expect(screen.queryByText("branch-coverage-rubric")).not.toBeInTheDocument();
    expect(screen.queryByText("corner-case-checklist")).not.toBeInTheDocument();
    expect(screen.queryByText("flake-patterns")).not.toBeInTheDocument();
  });
});

describe("AgentEditor → Skills tab — hydration", () => {
  it("rehydrates orderedLinkedIds when switching to a different agent", () => {
    const { rerender } = renderWithIntl(<SkillsTab agent={AGENT} />);
    // Initial render: 2 linked / 3 total.
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();

    // Switch agent — server returns just one link this time. The useEffect
    // keyed on agent.id must rehydrate orderedLinkedIds; otherwise the badge
    // would still read "2 of 3".
    const AGENT_2: Agent = { ...AGENT, id: "sec" };
    hooksState.useAgentSkills = {
      data: [{ agent_id: "sec", skill_id: "sk3", order: 0 }] as AgentSkillLink[],
      isLoading: false,
      isError: false,
    };
    rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ agents: agentsMessages, skills: skillsMessages }}
      >
        <ToastProvider>
          <SkillsTab agent={AGENT_2} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("1 of 3 enabled")).toBeInTheDocument();
  });

  it("does not crash when links is undefined on first render (still loading edge)", () => {
    // links === undefined but loadingLinks === false (impossible in practice
    // for our hooks, but the hydration guard `if (!links) return` makes the
    // component robust to it). Verifies the empty linked group renders.
    hooksState.useAgentSkills = { data: undefined, isLoading: false, isError: false };
    renderWithIntl(<SkillsTab agent={AGENT} />);
    expect(screen.getByText("0 of 3 enabled")).toBeInTheDocument();
  });
});

describe("AgentEditor → Skills tab — loading / error / empty", () => {
  it("renders the skeleton while either query is loading", () => {
    hooksState.useSkills = { data: undefined, isLoading: true, isError: false };
    const { container } = renderWithIntl(<SkillsTab agent={AGENT} />);
    // No skill rows yet, no badge text.
    expect(screen.queryByText("branch-coverage-rubric")).not.toBeInTheDocument();
    expect(screen.queryByText(/enabled/)).not.toBeInTheDocument();
    // Skeleton primitive is a plain div with role=presentation; assert the
    // container is non-empty as a structural smoke.
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the error state with a retry button when either query errors", async () => {
    const user = userEvent.setup();
    hooksState.useSkills = { data: undefined, isLoading: false, isError: true };
    renderWithIntl(<SkillsTab agent={AGENT} />);
    expect(screen.getByText(/could not load skills/i)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /retry/i });
    await user.click(retry);
    expect(refetchAllFn).toHaveBeenCalledTimes(1);
    expect(refetchLinksFn).toHaveBeenCalledTimes(1);
  });

  it("renders the empty-state message when there are no skills at all", () => {
    hooksState.useSkills = { data: [], isLoading: false, isError: false };
    hooksState.useAgentSkills = { data: [], isLoading: false, isError: false };
    renderWithIntl(<SkillsTab agent={AGENT} />);
    // Empty translation key: agents.skills.empty
    expect(screen.getByText(agentsMessages.skills.empty)).toBeInTheDocument();
  });

  it("renders the mutation error fallback when setSkills.isError is true", () => {
    hooksState.useSetAgentSkills = { isError: true };
    renderWithIntl(<SkillsTab agent={AGENT} />);
    // skills.drawer.importFailed is the fallback string used.
    const container = screen.getByText(skillsMessages.drawer.importFailed);
    expect(container).toBeInTheDocument();
  });
});

