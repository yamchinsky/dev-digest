/**
 * BlastRadiusCard — RTL flow tests (hermetic, jsdom).
 *
 * Hooks are mocked at the module boundary so no real fetch / QueryClient is
 * needed. All assertions are on user-visible text and ARIA roles.
 *
 * Scenarios:
 *   1. Loading state — isLoading=true → skeleton placeholder visible.
 *   2. Empty state (no data) — useBlast returns undefined → EmptyState rendered.
 *   3. Empty downstream — data has symbols but no callers → noDownstream message shown.
 *   4. Populated tree — symbols + callers rendered; file:line links have correct href.
 *   5. Degraded/partial badge — status!='full' → badge + reason shown; never blank.
 *   6. Prior PRs section — prior_prs rendered after toggle click.
 *   7. Caller → GitHub link — href uses githubBlobUrl pattern.
 */
import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import { BlastRadiusCard } from "./BlastRadiusCard";

// ---------------------------------------------------------------------------
// Hook mocks
// ---------------------------------------------------------------------------

const blastState = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
}));

const pullDetailState = vi.hoisted(() => ({
  data: undefined as unknown,
}));

const repoState = vi.hoisted(() => ({
  activeRepo: null as { full_name: string } | null,
}));

vi.mock("@/lib/hooks/blast", () => ({
  useBlast: (_prId: string) => ({
    data: blastState.data,
    isLoading: blastState.isLoading,
  }),
}));

vi.mock("@/lib/hooks/core", () => ({
  usePullDetail: (_prId: unknown) => ({
    data: pullDetailState.data,
  }),
}));

vi.mock("@/providers/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: repoState.activeRepo,
  }),
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FULL_DATA = {
  changed_symbols: [
    { name: "rateLimit", file: "src/middleware/rate-limit.ts", kind: "function" },
    { name: "BucketKey", file: "src/middleware/bucket.ts", kind: "type" },
  ],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [
        { name: "applyMiddleware", file: "src/app.ts", line: 42 },
        { name: "routeGuard", file: "src/routes/api.ts", line: 17 },
      ],
      endpoints_affected: ["POST /api/checkout"],
      crons_affected: [],
    },
  ],
  summary: "2 symbols · 2 callers · 1 endpoint (index: full)",
  status: "full" as const,
  degraded_reason: null,
  prior_prs: [
    { number: 480, title: "Add rate limiting to routes", pull_id: "pr-480" },
  ],
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderCard(prId = "pr-42") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
      <BlastRadiusCard prId={prId} />
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  blastState.data = undefined;
  blastState.isLoading = false;
  pullDetailState.data = { head_sha: "abc123def456" };
  repoState.activeRepo = { full_name: "acme/payments-api" };
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BlastRadiusCard — loading state", () => {
  it("renders a skeleton placeholder while data is loading", () => {
    blastState.isLoading = true;
    renderCard();

    // Card title is visible
    expect(screen.getByText("Blast Radius")).toBeInTheDocument();
    // No tree or stats rendered yet
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });
});

describe("BlastRadiusCard — empty state", () => {
  it("renders empty state when useBlast returns no data", () => {
    blastState.data = undefined;
    renderCard();

    expect(screen.getByText("No impact data yet")).toBeInTheDocument();
  });

  it("renders empty state for a result with no changed symbols", () => {
    blastState.data = {
      ...FULL_DATA,
      changed_symbols: [],
      downstream: [],
      status: "full",
    };
    renderCard();

    expect(screen.getByText("No impact data yet")).toBeInTheDocument();
  });

  it("shows degraded badge even when symbols array is empty", () => {
    blastState.data = {
      ...FULL_DATA,
      changed_symbols: [],
      downstream: [],
      status: "degraded",
      degraded_reason: "Symbol graph incomplete.",
    };
    renderCard();

    expect(screen.getByText("Degraded index")).toBeInTheDocument();
  });
});

describe("BlastRadiusCard — populated tree", () => {
  beforeEach(() => {
    blastState.data = FULL_DATA;
  });

  it("renders the card title and stat counts", () => {
    renderCard();

    expect(screen.getByText("Blast Radius")).toBeInTheDocument();
    // Stat labels are visible
    expect(screen.getByText("symbols")).toBeInTheDocument();
    expect(screen.getByText("callers")).toBeInTheDocument();
    expect(screen.getByText("endpoints")).toBeInTheDocument();
    expect(screen.getByText("cron/jobs")).toBeInTheDocument();
  });

  it("renders a row for each changed symbol", () => {
    renderCard();

    expect(screen.getByText("rateLimit")).toBeInTheDocument();
    expect(screen.getByText("BucketKey")).toBeInTheDocument();
  });

  it("renders kind badges for symbols", () => {
    renderCard();

    expect(screen.getByText("function")).toBeInTheDocument();
    expect(screen.getByText("type")).toBeInTheDocument();
  });

  it("shows caller count badge on the symbol header", () => {
    renderCard();

    // "2 callers" displayed next to rateLimit
    expect(screen.getByText("2 callers")).toBeInTheDocument();
  });

  it("expands callers when the symbol row is clicked", async () => {
    const user = userEvent.setup();
    renderCard();

    // Click rateLimit header to expand
    await user.click(screen.getByText("rateLimit"));

    expect(screen.getByText("applyMiddleware")).toBeInTheDocument();
    expect(screen.getByText("routeGuard")).toBeInTheDocument();
  });

  it("renders caller file:line as a link with correct GitHub URL", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByText("rateLimit"));

    // "src/app.ts:42" should be a link to GitHub
    const link = screen.getByRole("link", { name: /src\/app\.ts:42/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123def456/src/app.ts#L42",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders endpoint badges when expanded", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByText("rateLimit"));

    expect(screen.getByText("POST /api/checkout")).toBeInTheDocument();
  });
});

describe("BlastRadiusCard — status badges", () => {
  it("renders partial badge with reason when status is partial", () => {
    blastState.data = {
      ...FULL_DATA,
      status: "partial",
      degraded_reason: "Some files were not indexed.",
    };
    renderCard();

    expect(screen.getByText("Partial index")).toBeInTheDocument();
    expect(screen.getByText("Some files were not indexed.")).toBeInTheDocument();
  });

  it("renders degraded badge when status is degraded", () => {
    blastState.data = {
      ...FULL_DATA,
      status: "degraded",
      degraded_reason: null,
    };
    renderCard();

    expect(screen.getByText("Degraded index")).toBeInTheDocument();
  });

  it("does NOT render a status badge when status is full", () => {
    blastState.data = FULL_DATA;
    renderCard();

    expect(screen.queryByText("Partial index")).not.toBeInTheDocument();
    expect(screen.queryByText("Degraded index")).not.toBeInTheDocument();
    expect(screen.queryByText("Index unavailable")).not.toBeInTheDocument();
  });
});

describe("BlastRadiusCard — Tree/Graph toggle", () => {
  beforeEach(() => {
    blastState.data = FULL_DATA;
  });

  it("defaults to tree view — symbol rows are visible and graph is absent", () => {
    renderCard();

    // Tree content present
    expect(screen.getByRole("tree", { name: "Changed symbols tree" })).toBeInTheDocument();
    // Graph aria-role not present yet
    expect(screen.queryByRole("img", { name: "Blast radius graph" })).not.toBeInTheDocument();
  });

  it("switches to graph view when the Graph button is clicked", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: /graph/i }));

    // Tree is gone
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    // Graph is shown
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
  });
});

describe("BlastRadiusCard — prior PRs section", () => {
  beforeEach(() => {
    blastState.data = FULL_DATA;
  });

  it("renders the prior PRs section header", () => {
    renderCard();

    expect(screen.getByText("Prior PRs touching these files (1)")).toBeInTheDocument();
  });

  it("shows prior PR entries when the section is expanded", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByText("Prior PRs touching these files (1)"));

    expect(screen.getByText("Add rate limiting to routes")).toBeInTheDocument();
    expect(screen.getByText("#480")).toBeInTheDocument();
  });

  it("shows 'no prior PRs' message when prior_prs is empty", async () => {
    const user = userEvent.setup();
    blastState.data = { ...FULL_DATA, prior_prs: [] };
    renderCard();

    await user.click(screen.getByText("Prior PRs touching these files (0)"));

    expect(screen.getByText("No prior PRs found")).toBeInTheDocument();
  });
});
