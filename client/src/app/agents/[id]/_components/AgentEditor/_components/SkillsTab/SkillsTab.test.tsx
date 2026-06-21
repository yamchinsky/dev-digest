import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";

/* Mock the hooks BEFORE importing the component. We don't drive dnd-kit's
   pointer interactions in jsdom (too brittle); instead we verify the two
   things that matter for the API contract: the linked-vs-unlinked grouping
   the user sees, and the payload shape produced when the user toggles a
   checkbox (link / unlink). */
const setSkillsMutate = vi.fn();

vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: ALL_SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentSkills: () => ({ data: LINKED, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetAgentSkills: () => ({ mutate: setSkillsMutate, isError: false }),
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

afterEach(() => {
  cleanup();
  setSkillsMutate.mockClear();
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

  it("posts the new skill_ids array when linking an unlinked skill", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    // The three Checkbox primitives are role=checkbox; index 2 = flake-patterns
    // (unlinked). Clicking should append its id and fire the mutation.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    fireEvent.click(checkboxes[2]!);
    expect(setSkillsMutate).toHaveBeenCalledTimes(1);
    expect(setSkillsMutate).toHaveBeenCalledWith({
      agentId: "tqr",
      skillIds: ["sk1", "sk2", "sk3"],
    });
  });

  it("removes the id when unlinking an already-linked skill", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!); // sk1 currently linked → unlink
    expect(setSkillsMutate).toHaveBeenCalledWith({
      agentId: "tqr",
      skillIds: ["sk2"],
    });
  });
});
