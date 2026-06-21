/**
 * ImportSkillDialog — two-stage import: pick → review → save.
 *
 * We mock the network at the hook layer (useImportPreview / useImportCommit)
 * and exercise:
 *  - filename-ext guard surfaces an inline error and stays on the pick stage;
 *  - a successful preview transitions to the review stage and renders one
 *    card per parsed item;
 *  - the trust checkbox gates the Save button (the import contract);
 *  - editing a field calls patch logic (round-trip through the textinput);
 *  - missing required fields surface an inline error and skip the commit;
 *  - commit error path shows the message and stays open;
 *  - commit success closes the dialog.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import skillsMessages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";
import { ApiError } from "@/services/api";
import type { ImportPreviewItem } from "@devdigest/shared";

const previewMutate = vi.fn<(arg: unknown) => Promise<unknown>>();
const commitMutate = vi.fn<(arg: unknown) => Promise<unknown>>();

const hookState = vi.hoisted(() => ({
  previewPending: false,
  commitPending: false,
}));

vi.mock("@/lib/hooks/skills", () => ({
  useImportPreview: () => ({ mutateAsync: previewMutate, isPending: hookState.previewPending }),
  useImportCommit: () => ({ mutateAsync: commitMutate, isPending: hookState.commitPending }),
}));

// `fileToBase64` uses File.arrayBuffer which jsdom doesn't implement; the
// helpers themselves are covered separately. Here we only need an inert pass-
// through so the dialog can move from pick → review. `isAcceptedFilename`
// is a swappable mock so we can exercise both branches.
const isAcceptedFilenameMock = vi.fn<(n: string) => boolean>();
vi.mock("./helpers", () => ({
  fileToBase64: vi.fn().mockResolvedValue("Zm9v"),
  isAcceptedFilename: (n: string) => isAcceptedFilenameMock(n),
}));

import { ImportSkillDialog } from "./ImportSkillDialog";

const ITEMS: ImportPreviewItem[] = [
  {
    filename: "rubric.md",
    name: "branch-coverage-rubric",
    description: "Check both sides of every branch.",
    type: "rubric",
    body: "# rubric\nbody",
  },
  {
    filename: "security.md",
    name: "secret-scanner",
    description: "Flag hardcoded API keys.",
    type: "security",
    body: "# security\nbody",
  },
];

function renderDialog(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>
        <ToastProvider>
          <ImportSkillDialog onClose={onClose} />
        </ToastProvider>
      </NextIntlClientProvider>,
    ),
  };
}

function fileInput(): HTMLInputElement {
  // The dialog hides the file input (display: none) and triggers it via the
  // drop zone's onClick. userEvent.upload works through the input itself.
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function makeFile(name: string, body = "# x\nbody") {
  return new File([body], name, { type: "text/markdown" });
}

beforeEach(() => {
  hookState.previewPending = false;
  hookState.commitPending = false;
  previewMutate.mockReset();
  commitMutate.mockReset();
  isAcceptedFilenameMock.mockReset();
  // Default to accepting; flip per-test.
  isAcceptedFilenameMock.mockImplementation((n) =>
    /\.(md|markdown|txt|zip)$/i.test(n),
  );
});

afterEach(cleanup);

describe("ImportSkillDialog — pick stage", () => {
  it("renders the drop zone with the file-type hint", () => {
    renderDialog();
    expect(screen.getByText(/Drop a skill file/i)).toBeInTheDocument();
    expect(screen.getByText(/.md, .markdown, .txt, or a .zip/)).toBeInTheDocument();
  });

  it("rejects an unsupported extension inline (no preview call)", async () => {
    const user = userEvent.setup();
    // Simulate the guard rejecting whatever the user uploads. We upload a .md
    // (so the <input accept="..."> doesn't filter the event out before we even
    // see it), and the swapped guard is what fires the inline error.
    isAcceptedFilenameMock.mockReturnValue(false);
    renderDialog();
    await user.upload(fileInput(), makeFile("ignored.md"));
    expect(previewMutate).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Unsupported file\. Accepted: \.md, \.markdown, \.txt, \.zip/i),
    ).toBeInTheDocument();
  });

  it("accepts a .md file, calls preview, and transitions to the review stage", async () => {
    const user = userEvent.setup();
    previewMutate.mockResolvedValueOnce({ items: ITEMS });
    renderDialog();
    await user.upload(fileInput(), makeFile("rubric.md"));
    await waitFor(() => expect(previewMutate).toHaveBeenCalledTimes(1));
    // Subtitle: "<n> skill(s) ready to save" — proves we moved to review stage.
    expect(await screen.findByText(/2 skill\(s\) ready to save/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("branch-coverage-rubric")).toBeInTheDocument();
    expect(screen.getByDisplayValue("secret-scanner")).toBeInTheDocument();
  });

  it("surfaces an ApiError message from preview without leaving the pick stage", async () => {
    const user = userEvent.setup();
    previewMutate.mockRejectedValueOnce(new ApiError("Could not parse zip", 400, "BAD_ZIP", null));
    renderDialog();
    await user.upload(fileInput(), makeFile("bundle.zip"));
    expect(await screen.findByText(/Could not parse zip/)).toBeInTheDocument();
    // Still in pick stage — the drop zone copy is still on screen.
    expect(screen.getByText(/Drop a skill file/i)).toBeInTheDocument();
  });
});

describe("ImportSkillDialog — review stage", () => {
  async function goToReview() {
    const user = userEvent.setup();
    previewMutate.mockResolvedValueOnce({ items: ITEMS });
    const ctx = renderDialog();
    await user.upload(fileInput(), makeFile("rubric.md"));
    await screen.findByText(/2 skill\(s\) ready to save/i);
    return { user, ...ctx };
  }

  it("trust checkbox gates the Save button", async () => {
    const { user } = await goToReview();
    const save = screen.getByRole("button", { name: /save 2 skills/i });
    expect(save).toBeDisabled();
    // The checkbox is the only role=checkbox on screen in this stage.
    const trust = screen.getByRole("checkbox");
    await user.click(trust);
    expect(save).toBeEnabled();
  });

  it("commit fires with the (possibly edited) items array and closes on success", async () => {
    const { user, onClose } = await goToReview();
    commitMutate.mockResolvedValueOnce([]);
    // Edit the first name to verify the patch round-trip; we then expect
    // commit to receive the edited value.
    const nameInput = screen.getByDisplayValue("branch-coverage-rubric") as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, "renamed-rubric");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /save 2 skills/i }));
    await waitFor(() => expect(commitMutate).toHaveBeenCalledTimes(1));
    const submitted = commitMutate.mock.calls[0]![0] as ImportPreviewItem[];
    expect(submitted[0]!.name).toBe("renamed-rubric");
    expect(submitted[1]!.name).toBe("secret-scanner");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("validates missing required fields before committing", async () => {
    const { user } = await goToReview();
    const descInput = screen.getByDisplayValue("Check both sides of every branch.") as HTMLInputElement;
    await user.clear(descInput);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /save 2 skills/i }));
    expect(commitMutate).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/is missing name, description, or body/i),
    ).toBeInTheDocument();
  });

  it("surfaces a commit ApiError and does NOT close the dialog", async () => {
    const { user, onClose } = await goToReview();
    commitMutate.mockRejectedValueOnce(new ApiError("duplicate name", 409, "DUP", null));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /save 2 skills/i }));
    expect(await screen.findByText(/duplicate name/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Back returns to the pick stage", async () => {
    const { user } = await goToReview();
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText(/Drop a skill file/i)).toBeInTheDocument();
  });

  it("Save button label adapts to singular vs plural item count", async () => {
    const user = userEvent.setup();
    previewMutate.mockResolvedValueOnce({ items: [ITEMS[0]!] });
    renderDialog();
    await user.upload(fileInput(), makeFile("rubric.md"));
    expect(await screen.findByRole("button", { name: /save 1 skill$/i })).toBeInTheDocument();
  });
});

describe("ImportSkillDialog — close", () => {
  it("close button on the modal header calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog(onClose);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
