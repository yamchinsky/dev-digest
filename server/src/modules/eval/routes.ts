import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalBatch,
  EvalBatchDetail,
  EvalCase,
  EvalCaseInput,
  EvalExpectation,
  EvalRunResult,
  EvalStartBatchInput,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalService } from './service.js';

/**
 * Eval module routes (SPEC-04).
 *
 *   POST /findings/:id/eval-case          → 201 EvalCase | 422
 *   POST /eval-cases                      → 201 EvalCase | 422
 *   GET  /eval-cases/:id                  → 200 EvalCase | 404
 *   PUT  /eval-cases/:id                  → 200 EvalCase | 404 | 422
 *   DELETE /eval-cases/:id                → 204 | 404
 *   GET  /agents/:id/eval-cases           → 200 EvalCase[]
 *   POST /agents/:id/eval-runs            → 202 EvalBatch | 422
 *   GET  /agents/:id/eval-runs            → 200 EvalBatch[]
 *   GET  /eval-runs/:id                   → 200 EvalBatchDetail | 404
 *   POST /eval-cases/:id/run              → 200 EvalRunResult | 422
 */

/** POST /findings/:id/eval-case — seed from a decided finding. */
const FromFindingBody = z.object({
  agent_id: z.string().uuid().optional(),
});

/** Create body — EvalCaseInput with expected_output validated as EvalExpectation
 *  and end_line >= start_line enforced (AC-9). */
const CreateEvalCaseBody = EvalCaseInput.extend({
  expected_output: EvalExpectation,
}).superRefine((data, ctx) => {
  const exp = data.expected_output;
  if (exp.end_line < exp.start_line) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'end_line must be >= start_line',
      path: ['expected_output', 'end_line'],
    });
  }
});

/** Update body — same shape but all fields optional. */
const UpdateEvalCaseBody = z.object({
  name: z.string().min(1).optional(),
  input_diff: z.string().optional(),
  input_files: z.unknown().optional(),
  input_meta: z.unknown().optional(),
  expected_output: EvalExpectation.superRefine((data, ctx) => {
    if (data.end_line < data.start_line) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'end_line must be >= start_line',
        path: ['end_line'],
      });
    }
  }).optional(),
  notes: z.string().nullish(),
});

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(app.container);

  // ---------------------------------------------------------------------------
  // POST /findings/:id/eval-case  — seed case from an accepted/dismissed finding
  // ---------------------------------------------------------------------------
  app.post(
    '/findings/:id/eval-case',
    {
      schema: {
        params: IdParams,
        body: FromFindingBody,
        response: { 201: EvalCase },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const evalCase = await service.createCaseFromFinding(
        workspaceId,
        req.params.id,
        req.body.agent_id,
      );
      reply.status(201);
      return evalCase;
    },
  );

  // ---------------------------------------------------------------------------
  // POST /eval-cases  — manual create
  // ---------------------------------------------------------------------------
  app.post(
    '/eval-cases',
    {
      schema: {
        body: CreateEvalCaseBody,
        response: { 201: EvalCase },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = req.body;
      const evalCase = await service.createCase(workspaceId, {
        owner_kind: body.owner_kind,
        owner_id: body.owner_id,
        name: body.name,
        input_diff: body.input_diff,
        input_files: body.input_files,
        input_meta: body.input_meta,
        expected_output: body.expected_output,
        notes: body.notes,
      });
      reply.status(201);
      return evalCase;
    },
  );

  // ---------------------------------------------------------------------------
  // GET /eval-cases/:id
  // ---------------------------------------------------------------------------
  app.get(
    '/eval-cases/:id',
    { schema: { params: IdParams, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const evalCase = await service.getCase(workspaceId, req.params.id);
      if (!evalCase) throw new NotFoundError('Eval case not found');
      return evalCase;
    },
  );

  // ---------------------------------------------------------------------------
  // PUT /eval-cases/:id
  // ---------------------------------------------------------------------------
  app.put(
    '/eval-cases/:id',
    {
      schema: {
        params: IdParams,
        body: UpdateEvalCaseBody,
        response: { 200: EvalCase },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const evalCase = await service.updateCase(workspaceId, req.params.id, req.body);
      if (!evalCase) throw new NotFoundError('Eval case not found');
      return evalCase;
    },
  );

  // ---------------------------------------------------------------------------
  // DELETE /eval-cases/:id
  // ---------------------------------------------------------------------------
  app.delete(
    '/eval-cases/:id',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const ok = await service.deleteCase(workspaceId, req.params.id);
      if (!ok) throw new NotFoundError('Eval case not found');
      return reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------------------
  // GET /agents/:id/eval-cases
  // ---------------------------------------------------------------------------
  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCase) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listCases(workspaceId, req.params.id);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /agents/:id/eval-runs  — start a batch (202, fire-and-forget)
  // ---------------------------------------------------------------------------
  app.post(
    '/agents/:id/eval-runs',
    {
      schema: {
        params: IdParams,
        body: EvalStartBatchInput,
        response: { 202: EvalBatch },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const batch = await service.startBatch(workspaceId, req.params.id, req.body);
      reply.status(202);
      return batch;
    },
  );

  // ---------------------------------------------------------------------------
  // GET /agents/:id/eval-runs  — batch history (batches only, not single runs)
  // ---------------------------------------------------------------------------
  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: z.array(EvalBatch) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listBatches(workspaceId, req.params.id);
    },
  );

  // ---------------------------------------------------------------------------
  // GET /eval-runs/:id  — batch detail with per-run results
  // ---------------------------------------------------------------------------
  app.get(
    '/eval-runs/:id',
    { schema: { params: IdParams, response: { 200: EvalBatchDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const detail = await service.getBatchDetail(workspaceId, req.params.id);
      if (!detail) throw new NotFoundError('Eval run batch not found');
      return detail;
    },
  );

  // ---------------------------------------------------------------------------
  // POST /eval-cases/:id/run  — single-case sync run (batchId=NULL)
  // ---------------------------------------------------------------------------
  app.post(
    '/eval-cases/:id/run',
    {
      schema: {
        params: IdParams,
        body: EvalStartBatchInput,
        response: { 200: EvalRunResult },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runSingleCase(workspaceId, req.params.id, req.body);
    },
  );
}
