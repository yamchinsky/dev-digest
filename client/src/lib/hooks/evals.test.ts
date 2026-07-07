/* evals.test.ts — regression guard for useCreateEvalCaseFromFinding.
   The `POST /findings/:id/eval-case` route declares an object body schema
   (z.object({ agent_id? })). Fastify rejects an `undefined` body against an
   object schema with a 422 "Request validation failed" — even though every
   field is optional. So the hook must ALWAYS send an object, never undefined.
   This test asserts the request body shape; mocking the hook in component
   tests (as EvalsTab/FindingsPanel do) can't catch this. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const post = vi.fn();
vi.mock("@/services/api", () => ({
  api: { post: (...args: unknown[]) => post(...args) },
  API_BASE: "",
}));
vi.mock("@/providers/toast", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

import { useCreateEvalCaseFromFinding } from "./evals";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useCreateEvalCaseFromFinding — request body", () => {
  beforeEach(() => post.mockReset());

  it("sends {} (never undefined) when no agentId — Fastify rejects an undefined body", async () => {
    post.mockResolvedValue({ id: "c1", owner_id: "a1" });
    const { result } = renderHook(() => useCreateEvalCaseFromFinding(), { wrapper });
    result.current.mutate({ findingId: "f1" });
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("/findings/f1/eval-case", {});
  });

  it("includes agent_id (snake_case) when provided", async () => {
    post.mockResolvedValue({ id: "c1", owner_id: "a1" });
    const { result } = renderHook(() => useCreateEvalCaseFromFinding(), { wrapper });
    result.current.mutate({ findingId: "f1", agentId: "a9" });
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("/findings/f1/eval-case", { agent_id: "a9" });
  });
});
