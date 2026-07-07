/* PrecisionDipAlert.test.tsx — unit tests for computePrecisionDip helper
   and PrecisionDipAlert rendering. */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatch } from "@devdigest/shared";
import evalMessages from "../../../messages/en/eval.json";
import { computePrecisionDip, PrecisionDipAlert } from "./PrecisionDipAlert";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_BATCH: EvalBatch = {
  id: "b1",
  agent_id: "agent1",
  workspace_id: "ws1",
  status: "done",
  agent_version: 5,
  system_prompt: "You are a reviewer.",
  provider: "openai",
  model: "gpt-4.1",
  strategy: "single-pass",
  skill_bodies: null,
  cases_total: 3,
  cases_passed: 3,
  recall: 0.9,
  precision: 0.8,
  citation_accuracy: 0.95,
  cost_usd: 0.05,
  duration_ms: 1000,
  error: null,
  created_at: "2024-02-01T10:00:00Z",
  finished_at: "2024-02-01T10:01:00Z",
};

const PREV_BATCH: EvalBatch = {
  ...BASE_BATCH,
  id: "b0",
  agent_version: 4,
  precision: 0.9, // higher than latest
  created_at: "2024-01-01T10:00:00Z",
  finished_at: "2024-01-01T10:01:00Z",
};

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// computePrecisionDip — pure helper
// ---------------------------------------------------------------------------

describe("computePrecisionDip", () => {
  it("returns null when fewer than 2 done batches", () => {
    expect(computePrecisionDip([])).toBeNull();
    expect(computePrecisionDip([BASE_BATCH])).toBeNull();
  });

  it("returns null when precision did NOT drop", () => {
    // latest has precision >= prev
    const sameOrHigher = { ...BASE_BATCH, precision: 0.9 }; // same as PREV
    expect(computePrecisionDip([sameOrHigher, PREV_BATCH])).toBeNull();
  });

  it("returns null when precision improved", () => {
    const better = { ...BASE_BATCH, precision: 0.95 };
    expect(computePrecisionDip([better, PREV_BATCH])).toBeNull();
  });

  it("returns dip data when precision dropped", () => {
    // latest=0.8, prev=0.9 → dip of 10pts on v5
    const result = computePrecisionDip([BASE_BATCH, PREV_BATCH]);
    expect(result).not.toBeNull();
    expect(result?.pts).toBe(10);
    expect(result?.version).toBe(5);
  });

  it("returns null when either precision is null", () => {
    const nullLatest = { ...BASE_BATCH, precision: null };
    expect(computePrecisionDip([nullLatest, PREV_BATCH])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PrecisionDipAlert — rendering
// ---------------------------------------------------------------------------

describe("PrecisionDipAlert", () => {
  it("renders the warning banner when precision dropped", () => {
    wrap(<PrecisionDipAlert doneBatches={[BASE_BATCH, PREV_BATCH]} />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    // Message should mention precision dip
    expect(alert).toHaveTextContent(/10pts/i);
    expect(alert).toHaveTextContent(/v5/i);
  });

  it("renders nothing when precision did not drop", () => {
    const higher = { ...BASE_BATCH, precision: 0.95 };
    wrap(<PrecisionDipAlert doneBatches={[higher, PREV_BATCH]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders nothing when fewer than 2 batches", () => {
    wrap(<PrecisionDipAlert doneBatches={[BASE_BATCH]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders nothing when batches array is empty", () => {
    wrap(<PrecisionDipAlert doneBatches={[]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
