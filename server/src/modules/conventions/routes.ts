import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';

const ListQuery = z.object({
  runId: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

const EditBody = z.object({
  rule: z.string().min(5).max(200),
});

const BuildSkillBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  runId: z.string().uuid().optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.post(
    '/repos/:id/conventions/extract',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/conventions',
    { schema: { params: IdParams, querystring: ListQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.params.id, {
        ...(req.query.runId !== undefined ? { runId: req.query.runId } : {}),
        ...(req.query.status !== undefined ? { status: req.query.status } : {}),
      });
    },
  );

  app.post(
    '/conventions/:id/approve',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.approve(workspaceId, req.params.id);
    },
  );

  app.post(
    '/conventions/:id/reject',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.reject(workspaceId, req.params.id);
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: EditBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.edit(workspaceId, req.params.id, { rule: req.body.rule });
    },
  );

  app.post(
    '/repos/:id/conventions/preview-skill',
    { schema: { params: IdParams, body: BuildSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.previewSkillFromApproved(workspaceId, req.params.id, {
        name: req.body.name,
        description: req.body.description,
        ...(req.body.runId !== undefined ? { runId: req.body.runId } : {}),
      });
    },
  );

  app.post(
    '/repos/:id/conventions/build-skill',
    { schema: { params: IdParams, body: BuildSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.buildSkillFromApproved(workspaceId, req.params.id, {
        name: req.body.name,
        description: req.body.description,
        ...(req.body.runId !== undefined ? { runId: req.body.runId } : {}),
      });
      reply.status(201);
      return result;
    },
  );
}
