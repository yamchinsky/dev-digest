/* hooks/evals.ts — React Query hooks for the eval pipeline (SPEC-04).
   Cases, batch runs, and single-case sync execution. */
"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { notify } from "@/providers/toast";
import type {
  EvalCase,
  EvalCaseInput,
  EvalBatch,
  EvalBatchDetail,
  EvalStartBatchInput,
  EvalRunResult,
} from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Query key helpers (const-typed for safe invalidation at call sites)
// ---------------------------------------------------------------------------

const evalCasesKey = (agentId: string) => ["eval-cases", agentId] as const;
const evalCaseKey = (caseId: string) => ["eval-case", caseId] as const;
const evalBatchesKey = (agentId: string) => ["eval-batches", agentId] as const;
const evalBatchKey = (batchId: string | undefined) =>
  ["eval-batch", batchId] as const;

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

/** GET /agents/:id/eval-cases → EvalCase[] */
export function useEvalCases(agentId: string) {
  return useQuery({
    queryKey: evalCasesKey(agentId),
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
  });
}

/** GET /eval-cases/:id → EvalCase */
export function useEvalCase(caseId: string) {
  return useQuery({
    queryKey: evalCaseKey(caseId),
    queryFn: () => api.get<EvalCase>(`/eval-cases/${caseId}`),
    enabled: !!caseId,
  });
}

/** POST /eval-cases → 201 EvalCase; invalidates the agent's case list. */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) =>
      api.post<EvalCase>("/eval-cases", input),
    onSuccess: (evalCase) => {
      qc.invalidateQueries({ queryKey: evalCasesKey(evalCase.owner_id) });
    },
  });
}

export interface UpdateEvalCaseInput {
  id: string;
  patch: Partial<EvalCaseInput>;
}

/** PUT /eval-cases/:id; invalidates case entry + list. */
export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateEvalCaseInput) =>
      api.put<EvalCase>(`/eval-cases/${id}`, patch),
    onSuccess: (evalCase) => {
      qc.invalidateQueries({ queryKey: evalCasesKey(evalCase.owner_id) });
      qc.setQueryData(evalCaseKey(evalCase.id), evalCase);
    },
  });
}

export interface DeleteEvalCaseInput {
  id: string;
  /** Required so the mutation can invalidate the correct list key after deletion. */
  owner_id: string;
}

/** DELETE /eval-cases/:id; invalidates list and removes the case cache entry. */
export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteEvalCaseInput) =>
      api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: (_d, { id, owner_id }) => {
      qc.invalidateQueries({ queryKey: evalCasesKey(owner_id) });
      qc.removeQueries({ queryKey: evalCaseKey(id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Create from finding (AC-1, AC-6)
// ---------------------------------------------------------------------------

export interface CreateEvalCaseFromFindingInput {
  findingId: string;
  agentId?: string;
}

/** POST /findings/:id/eval-case — promote a finding to an eval case.
    Shows a success toast (via module-level notify) that includes the path
    to the agent's evals tab so the user can navigate there immediately.
    Component-level UX (e.g. a clickable link) is handled by the caller (T10). */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, agentId }: CreateEvalCaseFromFindingInput) =>
      // Always send an object body: the route's body schema is
      // z.object({ agent_id? }), and Fastify rejects an undefined body against
      // an object schema with a 422 — even though every field is optional.
      api.post<EvalCase>(
        `/findings/${findingId}/eval-case`,
        agentId ? { agent_id: agentId } : {},
      ),
    onSuccess: (evalCase) => {
      qc.invalidateQueries({ queryKey: evalCasesKey(evalCase.owner_id) });
      notify.success(
        "Eval case created",
        { href: `/agents/${evalCase.owner_id}?tab=evals` },
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Batch runs
// ---------------------------------------------------------------------------

/** GET /agents/:id/eval-runs → EvalBatch[].
    Self-polls every 2 500 ms while ANY batch in the list is still 'running',
    and stops once none are — so the Recent Runs table and the "Run eval"
    button flip from running → done without a manual refresh. (A batch runs
    fire-and-forget server-side, so nothing else pushes the completion.) */
export function useEvalBatches(agentId: string) {
  return useQuery({
    queryKey: evalBatchesKey(agentId),
    queryFn: () => api.get<EvalBatch[]>(`/agents/${agentId}/eval-runs`),
    refetchInterval: (q) =>
      (q.state.data ?? []).some((b) => b.status === "running") ? 2500 : false,
  });
}

/** GET /eval-runs/:id → EvalBatchDetail.
    Polls at 1 500 ms while status is 'running'; stops automatically on
    done/failed (AC-24).  When the batch completes, invalidates the batches
    list so useEvalBatches reflects the final aggregated metrics. */
export function useEvalBatch(batchId?: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: evalBatchKey(batchId),
    queryFn: () => api.get<EvalBatchDetail>(`/eval-runs/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (q) =>
      q.state.data?.batch.status === "running" ? 1500 : false,
  });

  const status = query.data?.batch.status;
  const agentId = query.data?.batch.agent_id;

  // Invalidate the parent list when the batch transitions to a terminal state.
  // useEffect is appropriate here: it synchronizes an external side-effect
  // (cache invalidation) with observed data — NOT derived-state computation.
  useEffect(() => {
    if ((status === "done" || status === "failed") && agentId) {
      qc.invalidateQueries({ queryKey: evalBatchesKey(agentId) });
    }
  }, [status, agentId, qc]);

  return query;
}

/** POST /agents/:id/eval-runs → 202 EvalBatch; invalidates the batches list. */
export function useStartEvalBatch(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalStartBatchInput) =>
      api.post<EvalBatch>(`/agents/${agentId}/eval-runs`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evalBatchesKey(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Single-case sync run
// ---------------------------------------------------------------------------

/** POST /eval-cases/:id/run → EvalRunResult */
export function useRunEvalCase() {
  return useMutation({
    mutationFn: (caseId: string) =>
      api.post<EvalRunResult>(`/eval-cases/${caseId}/run`),
  });
}
