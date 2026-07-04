import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BriefRecord } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * brief module.
 *   GET  /pulls/:id/brief → { brief: BriefRecord | null }   (no LLM)
 *   POST /pulls/:id/brief → { brief: BriefRecord, dropped_items: number }  (one LLM call)
 *
 * Response schemas are declared on every route so serializerCompiler acts as
 * a runtime validation gate (INSIGHTS: omitting `response` bypasses the gate).
 *
 * POST carries a per-route rate limit (5/min) — tighter than the global 120/min
 * because each call makes an LLM call.
 */

const BriefGetResponse = z.object({
  brief: BriefRecord.nullable(),
  // true when the brief was generated for an older head SHA (AC-17).
  stale: z.boolean(),
});

const BriefPostResponse = z.object({
  brief: BriefRecord,
  dropped_items: z.number().int(),
});

export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  app.get(
    '/pulls/:id/brief',
    {
      schema: {
        params: IdParams,
        response: { 200: BriefGetResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getBrief(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/brief',
    {
      schema: {
        params: IdParams,
        response: { 200: BriefPostResponse },
      },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.generateBrief(workspaceId, req.params.id);
    },
  );
}
