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

  it("should call scrollIntoView on the finding anchor when the core file is expanded and the badge is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SmartDiffViewer smartDiff={SMART_DIFF_BASE} files={PR_FILES} />);

    // The core file starts expanded (has findings), so the anchor element exists.
    const badge = screen.getByRole("button", { name: "1 findings" });
    await user.click(badge);

    // scrollIntoView must have been called on the anchor element whose id
    // matches the line-anchor convention: dl:<path>:RIGHT:<line>
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
      });
    });

    // Confirm it was called on the correct element
    const calledOnElement = scrollIntoViewMock.mock.instances[0] as Element | undefined;
    expect(calledOnElement?.id).toBe("dl:src/app/feature.ts:RIGHT:12");
  });

  it("should expand a collapsed file and then call scrollIntoView when its finding badge is clicked", async () => {
    const user = userEvent.setup();

    // Craft a SmartDiff where the core file starts collapsed: no finding_lines,
    // but we inject findings via a modified SmartDiff that has findings but
    // a very large line count so it would auto-collapse... Actually the collapse
    // logic in SmartDiffFileRow is: hasFindings → open=true, no findings → open=false.
    // To test the "collapsed → click badge → expand → scroll" path, we need a
    // file that HAS findings but starts collapsed.  The only way that happens is
    // if the file has findings AND something forces it closed.  In the current
    // component, hasFindings always means open=true on mount — so this specific
    // sub-case (badge click on a collapsed-but-has-findings file) is unreachable
    // via normal initial render.
    //
    // Instead we test the equivalent UX: user collapses an expanded core file
    // by clicking its header, then clicks the finding badge — the badge click
    // should re-expand the file and scroll.

    renderWithProviders(<SmartDiffViewer smartDiff={SMART_DIFF_BASE} files={PR_FILES} />);

    // Step 1: line text is visible (file starts expanded)
    expect(screen.getByText("added-line-12")).toBeInTheDocument();

    // Step 2: collapse the file by clicking its header
    const filePath = screen.getByText("src/app/feature.ts");
    await user.click(filePath);

    // Step 3: line text is now hidden
    expect(screen.queryByText("added-line-12")).not.toBeInTheDocument();

    // Step 4: click the finding badge — should re-expand and scroll
    const badge = screen.getByRole("button", { name: "1 findings" });
    await user.click(badge);

    // Step 5: line text reappears (file is open again)
    expect(await screen.findByText("added-line-12")).toBeInTheDocument();

    // Step 6: scrollIntoView is eventually called on the anchor
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
      });
    });
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
