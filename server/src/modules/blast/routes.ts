import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module.
 *   GET /pulls/:id/blast  → BlastRadius (token-free; no LLM, no run_traces row)
 *
 * Mirrors the smart-diff pattern: reads only — no RunLogger, no SSE stream,
 * no rate-limit needed (pure DB + repo-intel reads).
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BlastService(app.container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastRadius } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.blastForPull(workspaceId, req.params.id);
    },
  );
}
