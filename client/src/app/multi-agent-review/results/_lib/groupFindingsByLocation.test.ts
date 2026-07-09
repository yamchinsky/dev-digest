import { describe, it, expect } from "vitest";
import {
  groupFindingsByLocation,
  type FindingInput,
} from "./groupFindingsByLocation";

function finding(
  runId: string,
  file: string,
  startLine: number,
  endLine: number,
  overrides: Partial<FindingInput> = {},
): FindingInput {
  return {
    findingId: `${runId}-${file}-${startLine}`,
    runId,
    file,
    startLine,
    endLine,
    severity: "WARNING",
    title: `Finding at ${file}:${startLine}`,
    ...overrides,
  };
}

describe("groupFindingsByLocation", () => {
  it("returns [] when given no findings", () => {
    expect(groupFindingsByLocation([], ["run-1", "run-2"])).toEqual([]);
  });

  it("returns [] when given no run ids", () => {
    const f = finding("run-1", "src/foo.ts", 10, 20);
    expect(groupFindingsByLocation([f], [])).toEqual([]);
  });

  it("single finding from one agent — the other gets 'did-not-flag'", () => {
    const f = finding("run-1", "src/foo.ts", 10, 20);
    const groups = groupFindingsByLocation([f], ["run-1", "run-2"]);

    expect(groups).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const g = groups[0]!;
    expect(g.file).toBe("src/foo.ts");
    expect(g.startLine).toBe(10);
    expect(g.endLine).toBe(20);
    expect(g.cells["run-1"]).toEqual({ severity: "WARNING", title: f.title });
    expect(g.cells["run-2"]).toBe("did-not-flag");
    expect(g.isConflict).toBe(true);
  });

  it("two agents with overlapping findings on the same file → one group with two cells", () => {
    const f1 = finding("run-1", "src/bar.ts", 5, 15, { severity: "CRITICAL", title: "A" });
    const f2 = finding("run-2", "src/bar.ts", 10, 25, { severity: "WARNING", title: "B" });

    const groups = groupFindingsByLocation([f1, f2], ["run-1", "run-2"]);

    expect(groups).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const g = groups[0]!;
    expect(g.cells["run-1"]).toEqual({ severity: "CRITICAL", title: "A" });
    expect(g.cells["run-2"]).toEqual({ severity: "WARNING", title: "B" });
    expect(g.isConflict).toBe(false); // both flagged
    expect(g.startLine).toBe(5);
    expect(g.endLine).toBe(25);
  });

  it("non-overlapping findings on the same file → two separate groups", () => {
    const f1 = finding("run-1", "src/baz.ts", 1, 5);
    const f2 = finding("run-2", "src/baz.ts", 10, 20);

    const groups = groupFindingsByLocation([f1, f2], ["run-1", "run-2"]);

    expect(groups).toHaveLength(2);
    // Each group has only one agent flagged → both are conflicts
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(groups[0]!.isConflict).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(groups[1]!.isConflict).toBe(true);
  });

  it("findings on different files → separate groups per file", () => {
    const f1 = finding("run-1", "src/a.ts", 1, 10);
    const f2 = finding("run-2", "src/b.ts", 1, 10);

    const groups = groupFindingsByLocation([f1, f2], ["run-1", "run-2"]);

    expect(groups).toHaveLength(2);
    const files = groups.map((g) => g.file).sort();
    expect(files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("both agents flag exactly the same location → isConflict is false", () => {
    const f1 = finding("run-1", "src/x.ts", 10, 20, { title: "Same" });
    const f2 = finding("run-2", "src/x.ts", 10, 20, { title: "Same" });

    const groups = groupFindingsByLocation([f1, f2], ["run-1", "run-2"]);

    expect(groups).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(groups[0]!.isConflict).toBe(false);
  });

  it("all findings from one agent, none from the other → all groups are conflicts", () => {
    const f1 = finding("run-1", "src/lib.ts", 5, 10);
    const f2 = finding("run-1", "src/lib.ts", 20, 30);

    const groups = groupFindingsByLocation([f1, f2], ["run-1", "run-2"]);

    expect(groups.every((g) => g.isConflict)).toBe(true);
    expect(groups.every((g) => g.cells["run-2"] === "did-not-flag")).toBe(true);
  });

  it("exact boundary touch (A.end === B.start) counts as overlap", () => {
    // A=[1,10], B=[10,20] → A.start(1) <= B.end(20) && B.start(10) <= A.end(10) → overlaps
    const f1 = finding("run-1", "src/touch.ts", 1, 10);
    const f2 = finding("run-2", "src/touch.ts", 10, 20);

    const groups = groupFindingsByLocation([f1, f2], ["run-1", "run-2"]);

    expect(groups).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(groups[0]!.cells["run-1"]).not.toBe("did-not-flag");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(groups[0]!.cells["run-2"]).not.toBe("did-not-flag");
  });

  it("three agents — one flags, two do not → conflict, two did-not-flag cells", () => {
    const f1 = finding("run-1", "src/multi.ts", 5, 15);

    const groups = groupFindingsByLocation([f1], ["run-1", "run-2", "run-3"]);

    expect(groups).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const g = groups[0]!;
    expect(g.isConflict).toBe(true);
    expect(g.cells["run-1"]).not.toBe("did-not-flag");
    expect(g.cells["run-2"]).toBe("did-not-flag");
    expect(g.cells["run-3"]).toBe("did-not-flag");
  });
});
