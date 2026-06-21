/**
 * diffLines — LCS-based line diff used by the Versions tab. We don't pin the
 * exact backtracking order (multiple optimal LCSes are possible); we verify
 * the equality CONTRACT: the eq+del lines reconstruct the old text and the
 * eq+add lines reconstruct the new text, and adds/dels counts come out right
 * via diffStats. Plus a hardcoded happy-path case for readability.
 */
import { describe, it, expect } from "vitest";
import { diffLines, diffStats } from "./diff";

function oldFromDiff(parts: ReturnType<typeof diffLines>) {
  return parts.filter((p) => p.kind !== "add").map((p) => p.text).join("\n");
}
function newFromDiff(parts: ReturnType<typeof diffLines>) {
  return parts.filter((p) => p.kind !== "del").map((p) => p.text).join("\n");
}

describe("diffLines", () => {
  it("returns a single eq segment for two empty strings", () => {
    const d = diffLines("", "");
    expect(d).toEqual([{ kind: "eq", text: "" }]);
  });

  it("returns only equals when the strings match", () => {
    const d = diffLines("a\nb\nc", "a\nb\nc");
    expect(d.every((p) => p.kind === "eq")).toBe(true);
    expect(diffStats(d)).toEqual({ adds: 0, dels: 0 });
  });

  it("marks every new line as 'add' when the old text is empty", () => {
    // split("\n") on "" yields [""], so the empty old line appears as one
    // del-of-empty alongside the real adds — but the round-trip still holds.
    const d = diffLines("", "x\ny");
    const adds = d.filter((p) => p.kind === "add").map((p) => p.text);
    expect(adds).toEqual(["x", "y"]);
    expect(oldFromDiff(d)).toBe("");
    expect(newFromDiff(d)).toBe("x\ny");
  });

  it("marks every old line as 'del' when the new text is empty", () => {
    const d = diffLines("x\ny", "");
    const dels = d.filter((p) => p.kind === "del").map((p) => p.text);
    expect(dels).toEqual(["x", "y"]);
    expect(oldFromDiff(d)).toBe("x\ny");
    expect(newFromDiff(d)).toBe("");
  });

  it("preserves the common prefix and replaces the middle", () => {
    const d = diffLines("a\nb\nc", "a\nB\nc");
    // The contract: del/eq lines rebuild the original, add/eq lines rebuild the new.
    expect(oldFromDiff(d)).toBe("a\nb\nc");
    expect(newFromDiff(d)).toBe("a\nB\nc");
    expect(diffStats(d)).toEqual({ adds: 1, dels: 1 });
  });

  it("handles a multi-line insertion in the middle", () => {
    const d = diffLines("a\nz", "a\nx\ny\nz");
    expect(oldFromDiff(d)).toBe("a\nz");
    expect(newFromDiff(d)).toBe("a\nx\ny\nz");
    expect(diffStats(d)).toEqual({ adds: 2, dels: 0 });
  });

  it("handles a totally different text (everything deleted + everything added)", () => {
    const d = diffLines("a\nb", "c\nd");
    expect(oldFromDiff(d)).toBe("a\nb");
    expect(newFromDiff(d)).toBe("c\nd");
    expect(diffStats(d)).toEqual({ adds: 2, dels: 2 });
  });

  it("handles trailing newline (split keeps the trailing empty segment)", () => {
    const d = diffLines("a\n", "a\n");
    expect(d.every((p) => p.kind === "eq")).toBe(true);
    expect(d.map((p) => p.text)).toEqual(["a", ""]);
  });

  it("scales to a few hundred lines without throwing", () => {
    const oldText = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
    const newText = Array.from({ length: 300 }, (_, i) =>
      i % 10 === 0 ? `line ${i} changed` : `line ${i}`,
    ).join("\n");
    const d = diffLines(oldText, newText);
    const { adds, dels } = diffStats(d);
    expect(adds).toBe(30);
    expect(dels).toBe(30);
    expect(oldFromDiff(d)).toBe(oldText);
    expect(newFromDiff(d)).toBe(newText);
  });
});

describe("diffStats", () => {
  it("counts adds and dels and ignores eq", () => {
    expect(
      diffStats([
        { kind: "eq", text: "a" },
        { kind: "add", text: "b" },
        { kind: "add", text: "c" },
        { kind: "del", text: "d" },
      ]),
    ).toEqual({ adds: 2, dels: 1 });
  });

  it("returns zeros for an empty list", () => {
    expect(diffStats([])).toEqual({ adds: 0, dels: 0 });
  });
});
