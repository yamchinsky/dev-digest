import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { WorkspaceService } from './service.js';

/**
 * Workspace routes.
 *
 * F1 — workspace manager:
 *   GET /workspace              → workspace info + cloneDir + cloned repos summary
 *
 * Project Context (T3):
 *   GET /workspace/context-docs          → all context docs for the workspace
 *   GET /repos/:repoId/context-docs      → context docs scoped to one repo
 *   GET /workspace/context-docs/preview  → raw Markdown content for a single doc
 *                                          ?repoId=<uuid>&path=<relative-path>
 *
 * Cleanup/re-pull of individual repos is handled by the repos module
 * (refresh/delete); this surface gives the UI an overview.
 */

/** Querystring for the preview endpoint. */
const PreviewQuery = z.object({
  repoId: z.string().uuid(),
  path: z.string().min(1),
});

/** Params for repo-scoped endpoints (repoId is a uuid FK → repos.id). */
const RepoIdParams = z.object({ repoId: z.string().uuid() });

export default async function workspaceRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new WorkspaceService(container);

  // ── F1: workspace overview ────────────────────────────────────────────────

  app.get('/workspace', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const repos = await container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId));
    return {
      workspaceId,
      cloneDir: container.config.cloneDir,
      repos: repos.map((r) => ({
        id: r.id,
        full_name: r.fullName,
        clone_path: r.clonePath,
        last_polled_at: r.lastPolledAt?.toISOString() ?? null,
        cloned: Boolean(r.clonePath),
      })),
    };
  });

  // ── T3: Project Context discovery ─────────────────────────────────────────

  /** All context docs discovered across every cloned repo in the workspace. */
  app.get('/workspace/context-docs', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listForWorkspace(workspaceId);
  });

  /** Context docs scoped to a single repo (verifies repo belongs to workspace). */
  app.get(
    '/repos/:repoId/context-docs',
    { schema: { params: RepoIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listForRepo(workspaceId, req.params.repoId);
    },
  );

  /**
   * Return raw Markdown content for a single context doc.
   * The path is whitelist-checked against the discovered set before read.
   */
  app.get(
    '/workspace/context-docs/preview',
    { schema: { querystring: PreviewQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.preview(workspaceId, req.query.repoId, req.query.path);
    },
  );
}
