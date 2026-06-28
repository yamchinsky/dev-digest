/**
 * SmartDiffViewer tests — client surface, jsdom + RTL + Vitest.
 *
 * Provider wiring:
 *   - NextIntlClientProvider wraps every render with the real en/smartDiff.json
 *     and en/shell.json messages (FileCard uses the "shell" namespace).
 *   - QueryClientProvider is NOT needed: SmartDiffViewer and FileCard receive
 *     their data via props and do not call any TanStack Query hooks.
 *
 * scrollIntoView mock:
 *   jsdom does not implement Element.prototype.scrollIntoView; we install a
 *   vi.fn() on the prototype before each test and restore it after.
 *
 * Fixtures:
 *   Three SmartDiffGroups — core (src/app/feature.ts, 1 finding on line 12),
 *   wiring (tsconfig.json, no findings), boilerplate (pnpm-lock.yaml, no
 *   findings) — plus matching PrFile entries whose patches contain enough
 *   lines to render line 12 on the new side (RIGHT:12).
 *
 *   The core patch starts at line 1 (+10 context lines then a + line 12) so
 *   CodeLine produces an element with id="dl:src/app/feature.ts:RIGHT:12".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { SmartDiff, PrFile } from "@devdigest/shared";

import smartDiffMessages from "../../../../messages/en/smartDiff.json";
import shellMessages from "../../../../messages/en/shell.json";

import { SmartDiffViewer } from "./SmartDiffViewer";

// ---------------------------------------------------------------------------
// Provider helper
// ---------------------------------------------------------------------------

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ smartDiff: smartDiffMessages, shell: shellMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A patch for src/app/feature.ts that places a "+" line at new-side line 12.
 * The hunk starts at old=1/new=1; 10 context lines bring us to line 11, then
 * the addition becomes line 12 on the new side.
 */
const CORE_PATCH = [
  "@@ -1,11 +1,12 @@",
  " line1",
  " line2",
  " line3",
  " line4",
  " line5",
  " line6",
  " line7",
  " line8",
  " line9",
  " line10",
  " line11",
  "+added-line-12",
].join("\n");

const WIRING_PATCH = "@@ -1,2 +1,2 @@\n config-line-1\n config-line-2";
const BOILERPLATE_PATCH = "@@ -1,2 +1,2 @@\n lock-line-1\n lock-line-2";

const SMART_DIFF_BASE: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/app/feature.ts",
          additions: 12,
          deletions: 0,
          finding_lines: [12],
          findings: [{ id: "find-1", start_line: 12, severity: "WARNING" }],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "tsconfig.json",
          additions: 2,
          deletions: 0,
          finding_lines: [],
          findings: [],
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "pnpm-lock.yaml",
          additions: 2,
          deletions: 0,
          finding_lines: [],
          findings: [],
        },
      ],
    },
  ],
  split_suggestion: {
    too_big: false,
    total_lines: 16,
    proposed_splits: [],
  },
};

const PR_FILES: PrFile[] = [
  { path: "src/app/feature.ts", additions: 12, deletions: 0, patch: CORE_PATCH },
  { path: "tsconfig.json", additions: 2, deletions: 0, patch: WIRING_PATCH },
  { path: "pnpm-lock.yaml", additions: 2, deletions: 0, patch: BOILERPLATE_PATCH },
];

// ---------------------------------------------------------------------------
// scrollIntoView mock — jsdom does not implement it
// ---------------------------------------------------------------------------

let scrollIntoViewMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollIntoViewMock = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

afterEach(() => {
  cleanup();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (Element.prototype as any).scrollIntoView;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SmartDiffViewer", () => {
  it("should render three role group headers in order core → wiring → boilerplate", () => {
    renderWithProviders(<SmartDiffViewer smartDiff={SMART_DIFF_BASE} files={PR_FILES} />);

    const headers = [
      screen.getByText("Core logic"),
      screen.getByText("Wiring"),
      screen.getByText("Boilerplate"),
    ];

    // Verify DOM order via compareDocumentPosition
    expect(headers[0]!.compareDocumentPosition(headers[1]!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(headers[1]!.compareDocumentPosition(headers[2]!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("should expand core files with findings by default, showing their line text", () => {
    renderWithProviders(<SmartDiffViewer smartDiff={SMART_DIFF_BASE} files={PR_FILES} />);

    // The addition on line 12 of the core file must be visible
    expect(screen.getByText("added-line-12")).toBeInTheDocument();
  });

  it("should collapse boilerplate files with no findings by default, hiding their line text", () => {
    renderWithProviders(<SmartDiffViewer smartDiff={SMART_DIFF_BASE} files={PR_FILES} />);

    // pnpm-lock.yaml has no findings → FileCard starts collapsed → lines not rendered
    expect(screen.queryByText("lock-line-1")).not.toBeInTheDocument();
  });

  it("should render a finding indicator badge for the core file showing the finding count", () => {
    renderWithProviders(<SmartDiffViewer smartDiff={SMART_DIFF_BASE} files={PR_FILES} />);

    // The badge aria-label is "1 findings" (from smartDiff.json findingsBadge)
    expect(
      screen.getByRole("button", { name: "1 findings" }),
    ).toBeInTheDocument();
  });

  it("should call onOpenFinding with the file's finding id when the header badge is clicked", async () => {
    const user = userEvent.setup();
    const onOpenFinding = vi.fn();
    renderWithProviders(
      <SmartDiffViewer smartDiff={SMART_DIFF_BASE} files={PR_FILES} onOpenFinding={onOpenFinding} />,
    );

    // The aggregated header badge deep-links to the file's (only) finding.
    const badge = screen.getByRole("button", { name: "1 findings" });
    await user.click(badge);

    expect(onOpenFinding).toHaveBeenCalledWith("find-1");
  });

  it("should render a clickable in-line severity badge on the finding's line and call onOpenFinding", async () => {
    const user = userEvent.setup();
    const onOpenFinding = vi.fn();
    renderWithProviders(
      <SmartDiffViewer smartDiff={SMART_DIFF_BASE} files={PR_FILES} onOpenFinding={onOpenFinding} />,
    );

    // The core file starts expanded; line 12 (RIGHT:12) carries one finding, so
    // an in-line badge button is rendered next to that line's code. The badge
    // shows the reviewer-facing lowercase label ("warning") + an icon.
    const inlineBadge = screen.getByRole("button", { name: "View warning finding" });
    expect(inlineBadge).toHaveTextContent("warning");
    await user.click(inlineBadge);

    expect(onOpenFinding).toHaveBeenCalledWith("find-1");
  });

  it("should pick the most-severe finding for the header badge deep-link", async () => {
    const user = userEvent.setup();
    const onOpenFinding = vi.fn();
    const multi: SmartDiff = {
      ...SMART_DIFF_BASE,
      groups: SMART_DIFF_BASE.groups.map((g) =>
        g.role === "core"
          ? {
              ...g,
              files: [
                {
                  ...g.files[0]!,
                  finding_lines: [1, 12],
                  findings: [
                    { id: "warn-low", start_line: 1, severity: "WARNING" },
                    { id: "crit-high", start_line: 12, severity: "CRITICAL" },
                  ],
                },
              ],
            }
          : g,
      ),
    };
    renderWithProviders(
      <SmartDiffViewer smartDiff={multi} files={PR_FILES} onOpenFinding={onOpenFinding} />,
    );

    // Two findings → badge shows count 2 and links to the CRITICAL one.
    const badge = screen.getByRole("button", { name: "2 findings" });
    await user.click(badge);

    expect(onOpenFinding).toHaveBeenCalledWith("crit-high");
  });

  it("should render the SplitBanner with the proposed split name when too_big is true", () => {
    const smartDiffTooBig: SmartDiff = {
      ...SMART_DIFF_BASE,
      split_suggestion: {
        too_big: true,
        total_lines: 1200,
        proposed_splits: [
          { name: "auth-changes", files: ["src/app/feature.ts"] },
        ],
      },
    };

    renderWithProviders(<SmartDiffViewer smartDiff={smartDiffTooBig} files={PR_FILES} />);

    // Banner title uses the smartDiff.splitBannerTitle key
    expect(
      screen.getByText(/This PR is 1200 lines\. Consider splitting:/i),
    ).toBeInTheDocument();

    // Proposed split name is rendered
    expect(screen.getByText("auth-changes")).toBeInTheDocument();
  });

  it("should not render the SplitBanner when too_big is false", () => {
    renderWithProviders(<SmartDiffViewer smartDiff={SMART_DIFF_BASE} files={PR_FILES} />);

    // SMART_DIFF_BASE has too_big: false — no banner role="note" in the DOM
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("should show a flat file list without group headers when Original order is selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SmartDiffViewer smartDiff={SMART_DIFF_BASE} files={PR_FILES} />);

    // Switch to Original order
    await user.click(screen.getByRole("button", { name: /original order/i }));

    // Group headers must be gone
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.queryByText("Wiring")).not.toBeInTheDocument();
    expect(screen.queryByText("Boilerplate")).not.toBeInTheDocument();

    // All three file paths are present (flat list)
    expect(screen.getByText("src/app/feature.ts")).toBeInTheDocument();
    expect(screen.getByText("tsconfig.json")).toBeInTheDocument();
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("should restore group headers when Smart order is re-selected after viewing Original order", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SmartDiffViewer smartDiff={SMART_DIFF_BASE} files={PR_FILES} />);

    // Switch to Original order
    await user.click(screen.getByRole("button", { name: /original order/i }));
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();

    // Switch back to Smart order
    await user.click(screen.getByRole("button", { name: /smart order/i }));

    // Group headers are restored
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByText("Wiring")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
  });
});
