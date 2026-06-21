/**
 * outcomeOf — the badge reflects the review OUTCOME (deterministic from
 * blocker/finding counts), not the lifecycle. tsOf — epoch ms with NaN /
 * missing tolerated as 0 so the timeline sort stays stable.
 */
import { describe, it, expect } from "vitest";
import type { RunSummary } from "@devdigest/shared";
import { outcomeOf, tsOf } from "./helpers";

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "r",
    agent_id: "a",
    agent_name: "n",
    provider: "openrouter",
    model: "m",
    status: "done",
    error: null,
    duration_ms: 0,
    tokens_in: 0,
    tokens_out: 0,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T00:00:00.000Z",
    score: null,
    blockers: null,
    cost_usd: null,
    ...o,
  };
}

describe("outcomeOf", () => {
  it("returns 'running' for a running run regardless of counts", () => {
    expect(outcomeOf(run({ status: "running", blockers: 9, findings_count: 9 })).key).toBe(
      "running",
    );
  });

  it("returns 'error' for a failed run", () => {
    expect(outcomeOf(run({ status: "failed" })).key).toBe("error");
  });

  it("returns 'cancelled' for a cancelled run", () => {
    expect(outcomeOf(run({ status: "cancelled" })).key).toBe("cancelled");
  });

  it("returns 'rejected' when a settled run has blockers (blockers win over findings)", () => {
    expect(outcomeOf(run({ status: "done", blockers: 1, findings_count: 5 })).key).toBe(
      "rejected",
    );
  });

  it("returns 'reviewed' when a settled run has non-blocking findings only", () => {
    expect(outcomeOf(run({ status: "done", blockers: 0, findings_count: 3 })).key).toBe(
      "reviewed",
    );
  });

  it("returns 'approved' when a settled run has zero blockers and zero findings", () => {
    expect(outcomeOf(run({ status: "done", blockers: 0, findings_count: 0 })).key).toBe(
      "approved",
    );
  });

  it("treats null blockers/findings_count as zero (clean → approved)", () => {
    expect(outcomeOf(run({ status: "done", blockers: null, findings_count: null as unknown as number })).key).toBe(
      "approved",
    );
  });

  it("treats an undefined/empty status as a settled run and uses counts", () => {
    expect(outcomeOf(run({ status: undefined as unknown as string, blockers: 2 })).key).toBe(
      "rejected",
    );
    expect(outcomeOf(run({ status: "", blockers: 0, findings_count: 0 })).key).toBe("approved");
  });
});

describe("tsOf", () => {
  it("returns 0 for null / undefined / empty", () => {
    expect(tsOf(null)).toBe(0);
    expect(tsOf(undefined)).toBe(0);
    expect(tsOf("")).toBe(0);
  });

  it("returns epoch ms for a valid ISO string", () => {
    expect(tsOf("1970-01-01T00:00:00.000Z")).toBe(0);
    expect(tsOf("2026-06-11T18:44:34.000Z")).toBe(
      Date.UTC(2026, 5, 11, 18, 44, 34),
    );
  });

  it("returns 0 for an unparseable string (sorts last)", () => {
    expect(tsOf("not-a-date")).toBe(0);
    expect(tsOf("hello world")).toBe(0);
  });
});
