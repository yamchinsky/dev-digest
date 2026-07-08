import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillBenchmarkRun, SkillBenchmarkStartInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillEvalService } from './service.js';

/**
 * Skill benchmark routes — the "Skill Editor · Evals" tab.
 *
 *   POST /skills/:id/benchmarks     → 202 SkillBenchmarkRun | 404 | 422
 *   GET  /skills/:id/benchmarks     → 200 SkillBenchmarkRun[] | 404
 *   GET  /skill-benchmarks/:id      → 200 SkillBenchmarkRun | 404
 */
export default async function skillEvalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillEvalService(app.container);

  // POST /skills/:id/benchmarks — start a benchmark (202, fire-and-forget)
  app.post(
    '/skills/:id/benchmarks',
    {
      schema: {
        params: IdParams,
        body: SkillBenchmarkStartInput,
        response: { 202: SkillBenchmarkRun },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const run = await service.startBenchmark(workspaceId, req.params.id, req.body);
      reply.status(202);
      return run;
    },
  );

  // GET /skills/:id/benchmarks — run history (newest first)
  app.get(
    '/skills/:id/benchmarks',
    { schema: { params: IdParams, response: { 200: z.array(SkillBenchmarkRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listRuns(workspaceId, req.params.id);
    },
  );

  // GET /skill-benchmarks/:id — a single run
  app.get(
    '/skill-benchmarks/:id',
    { schema: { params: IdParams, response: { 200: SkillBenchmarkRun } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const run = await service.getRun(workspaceId, req.params.id);
      if (!run) throw new NotFoundError('Skill benchmark run not found');
      return run;
    },
  );
}
