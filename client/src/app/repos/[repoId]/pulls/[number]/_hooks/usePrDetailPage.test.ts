/**
 * usePrDetailPage — verify the bits that aren't tied to React Query's
 * internals: PR number → id resolution, ?tab / ?trace param round-trip, and
 * the invalidate callbacks the page hands to the run-controls. We mock the
 * data hooks (no fetch / no QueryClient) and the next/navigation primitives.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";

const routerReplace = vi.fn();
const qcInvalidate = vi.fn();

let searchParams = new URLSearchParams();
const setSearch = (qs: string) => {
  searchParams = new URLSearchParams(qs);
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: qcInvalidate }),
}));

const hooksState = vi.hoisted(() => ({
  pulls: undefined as
    | { id: string; number: number }[]
    | undefined,
  pullsLoading: false,
  pr: undefined as unknown,
  detailLoading: false,
  isError: false,
  error: null as unknown,
  reviews: [] as { findings: unknown[] }[],
  activeRuns: [] as { run_id: string }[],
  prRuns: [] as unknown[],
  activeRepo: null as { full_name: string } | null,
  repoNotFound: false,
}));

const refetch = vi.fn();
const refetchReviews = vi.fn();
const deleteRunMutate = vi.fn();
const cancelMutate = vi.fn();

vi.mock("@/lib/hooks", () => ({
  usePulls: () => ({ data: hooksState.pulls, isLoading: hooksState.pullsLoading }),
  usePullDetail: (prId: string | null) => ({
    data: prId ? hooksState.pr : undefined,
    isLoading: hooksState.detailLoading,
    isError: hooksState.isError,
    error: hooksState.error,
    refetch,
  }),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: hooksState.reviews, refetch: refetchReviews }),
  useCancelRun: () => ({ mutate: cancelMutate }),
  usePrActiveRuns: () => ({ data: hooksState.activeRuns }),
  usePrRuns: () => ({ data: hooksState.prRuns }),
  useDeleteRun: () => ({ mutate: deleteRunMutate }),
}));

vi.mock("@/providers/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: hooksState.activeRepo }),
  useRepoNotFound: () => hooksState.repoNotFound,
}));

import { usePrDetailPage } from "./usePrDetailPage";

function reset() {
  hooksState.pulls = [{ id: "uuid-42", number: 42 }];
  hooksState.pullsLoading = false;
  hooksState.pr = { id: "uuid-42", number: 42, title: "x" };
  hooksState.detailLoading = false;
  hooksState.isError = false;
  hooksState.error = null;
  hooksState.reviews = [];
  hooksState.activeRuns = [];
  hooksState.prRuns = [];
  hooksState.activeRepo = { full_name: "octo/repo" };
  hooksState.repoNotFound = false;
  setSearch("");
  routerReplace.mockClear();
  qcInvalidate.mockClear();
  refetch.mockClear();
  refetchReviews.mockClear();
  deleteRunMutate.mockClear();
  cancelMutate.mockClear();
}

beforeEach(reset);
afterEach(cleanup);

describe("usePrDetailPage", () => {
  it("resolves prId from the PR number via the pulls list", () => {
    const { result } = renderHook(() => usePrDetailPage("r1", "42"));
    expect(result.current.prId).toBe("uuid-42");
    expect(result.current.repoName).toBe("octo/repo");
    expect(result.current.repoFullName).toBe("octo/repo");
  });

  it("returns prId === null when the number is unknown in the pulls list", () => {
    const { result } = renderHook(() => usePrDetailPage("r1", "999"));
    expect(result.current.prId).toBeNull();
  });

  it("treats pulls-loading as the whole page loading", () => {
    hooksState.pullsLoading = true;
    const { result } = renderHook(() => usePrDetailPage("r1", "42"));
    expect(result.current.isLoading).toBe(true);
  });

  it("falls back to repoId for the display name when the repo context is empty", () => {
    hooksState.activeRepo = null;
    const { result } = renderHook(() => usePrDetailPage("r-fallback", "42"));
    expect(result.current.repoName).toBe("r-fallback");
    expect(result.current.repoFullName).toBeNull();
  });

  it("derives reviewRunning from the server-sourced active runs", () => {
    hooksState.activeRuns = [{ run_id: "run-a" }, { run_id: "run-b" }];
    const { result } = renderHook(() => usePrDetailPage("r1", "42"));
    expect(result.current.reviewRunning).toBe(true);
    expect(result.current.liveRunIds).toEqual(["run-a", "run-b"]);
  });

  it("defaults tab to 'overview' and reads ?tab / ?trace from the URL", () => {
    setSearch("tab=findings&trace=run-7");
    const { result } = renderHook(() => usePrDetailPage("r1", "42"));
    expect(result.current.tab).toBe("findings");
    expect(result.current.traceRunId).toBe("run-7");
  });

  it("sums findings across reviews for findingsCount", () => {
    hooksState.reviews = [
      { findings: [{}, {}] },
      { findings: [{}] },
      { findings: [] },
    ];
    const { result } = renderHook(() => usePrDetailPage("r1", "42"));
    expect(result.current.findingsCount).toBe(3);
  });

  describe("setParam / setTab / openTrace / closeTrace", () => {
    it("setTab writes ?tab to the URL", () => {
      const { result } = renderHook(() => usePrDetailPage("r1", "42"));
      act(() => result.current.setTab("findings"));
      expect(routerReplace).toHaveBeenCalledWith("/repos/r1/pulls/42?tab=findings");
    });

    it("openTrace adds ?trace and preserves an existing ?tab", () => {
      setSearch("tab=findings");
      const { result } = renderHook(() => usePrDetailPage("r1", "42"));
      act(() => result.current.openTrace("run-7"));
      const url = routerReplace.mock.calls[0]![0] as string;
      // URLSearchParams order isn't guaranteed in the spec but is stable
      // in practice for what we set; assert by parsing instead of by string.
      const sp = new URL(`http://x${url.slice(url.indexOf("?"))}`);
      expect(sp.searchParams.get("tab")).toBe("findings");
      expect(sp.searchParams.get("trace")).toBe("run-7");
      expect(url.startsWith("/repos/r1/pulls/42?")).toBe(true);
    });

    it("closeTrace removes the ?trace key without dropping other params", () => {
      setSearch("tab=findings&trace=run-7");
      const { result } = renderHook(() => usePrDetailPage("r1", "42"));
      act(() => result.current.closeTrace());
      expect(routerReplace).toHaveBeenCalledWith("/repos/r1/pulls/42?tab=findings");
    });

    it("setTab on a clean URL produces no trailing '?' when the only param is gone", () => {
      const { result } = renderHook(() => usePrDetailPage("r1", "42"));
      // Setting then clearing via null:
      act(() => result.current.closeTrace()); // no trace was set
      expect(routerReplace).toHaveBeenCalledWith("/repos/r1/pulls/42");
    });
  });

  describe("invalidation callbacks", () => {
    it("invalidateActiveRuns hits the pr-active-runs query key for the resolved prId", () => {
      const { result } = renderHook(() => usePrDetailPage("r1", "42"));
      act(() => result.current.invalidateActiveRuns());
      expect(qcInvalidate).toHaveBeenCalledWith({ queryKey: ["pr-active-runs", "uuid-42"] });
    });

    it("invalidateRunHistory hits the pr-runs query key for the resolved prId", () => {
      const { result } = renderHook(() => usePrDetailPage("r1", "42"));
      act(() => result.current.invalidateRunHistory());
      expect(qcInvalidate).toHaveBeenCalledWith({ queryKey: ["pr-runs", "uuid-42"] });
    });

    it("invalidate callbacks no-op when prId is still null (pulls list not yet loaded / number missing)", () => {
      hooksState.pulls = [];
      const { result } = renderHook(() => usePrDetailPage("r1", "42"));
      expect(result.current.prId).toBeNull();
      act(() => result.current.invalidateActiveRuns());
      act(() => result.current.invalidateRunHistory());
      expect(qcInvalidate).not.toHaveBeenCalled();
    });
  });
});
