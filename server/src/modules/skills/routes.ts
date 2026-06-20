import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateSkillBody,
  ImportCommitBody,
  ImportSkillUpload,
  SkillType,
  UpdateSkillBody,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import { IMPORT_PREVIEW_BODY_LIMIT } from './constants.js';

/**
 * A1 — skills module.
 *   GET    /skills                        → list (workspace-scoped, filterable)
 *   POST   /skills                        → create
 *   GET    /skills/:id                    → one skill
 *   PUT    /skills/:id                    → patch (body change bumps version)
 *   PATCH  /skills/:id/enabled            → toggle enabled (sugar)
 *   DELETE /skills/:id                    → delete
 *   POST   /skills/import/preview         → parse .md or .zip, return items
 *   POST   /skills/import/commit          → persist a reviewed preview
 */

const ListQuery = z.object({
  type: SkillType.optional(),
  enabled: z.preprocess((v) => {
    if (typeof v === 'string') return v === 'true';
    return v;
  }, z.boolean().optional()),
  q: z.string().optional(),
});

const ToggleEnabledBody = z.object({ enabled: z.boolean() });

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', { schema: { querystring: ListQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, {
      ...(req.query.type !== undefined ? { type: req.query.type } : {}),
      ...(req.query.enabled !== undefined ? { enabled: req.query.enabled } : {}),
      ...(req.query.q !== undefined ? { q: req.query.q } : {}),
    });
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, {
      name: req.body.name,
      description: req.body.description,
      type: req.body.type,
      body: req.body.body,
      ...(req.body.enabled !== undefined ? { enabled: req.body.enabled } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.patch(
    '/skills/:id/enabled',
    { schema: { params: IdParams, body: ToggleEnabledBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, { enabled: req.body.enabled });
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  // Import: per-route bodyLimit override — base64 of a 1 MB zip is ~1.36 MB,
  // and the global cap is 1 MB. 2 MiB gives headroom for the JSON envelope.
  app.post(
    '/skills/import/preview',
    {
      schema: { body: ImportSkillUpload },
      bodyLimit: IMPORT_PREVIEW_BODY_LIMIT,
    },
    async (req) => {
      await getContext(app.container, req); // workspace gate
      const items = service.previewImport({
        filename: req.body.filename,
        contentBase64: req.body.content_base64,
      });
      return { items };
    },
  );

  app.post(
    '/skills/import/commit',
    { schema: { body: ImportCommitBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skills = await service.commitImport(workspaceId, req.body);
      reply.status(201);
      return skills;
    },
  );
}
