import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CiExport,
  CiExportInput,
  CiFile,
  CiInstallation,
  CiRun,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiService } from './service.js';

/**
 * CI module routes.
 *
 *   POST /agents/:id/export-ci               — generate + optionally push CI bundle
 *   GET  /agents/:id/ci-installations        — list installations for an agent
 *   GET  /ci-runs                            — filtered list of CI run records
 *   POST /ci-runs/sync                       — ingest completed runs from GitHub
 *
 * All handlers:
 *   1. `await getContext(app.container, req)` — workspace resolution first.
 *   2. Delegate to CiService (no business logic in routes).
 *   3. Return domain result (Fastify serializes via the Zod response schema).
 *
 * Response schemas are declared on every route so serializerCompiler acts as
 * a runtime validation gate (omitting `response` bypasses the gate — see INSIGHTS).
 */

/** Optional querystring filters for GET /ci-runs. */
const CiRunsQuery = z.object({
  agent_id: z.string().uuid().optional(),
  repo: z.string().optional(),
  status: z.string().optional(),
  since: z.string().datetime({ offset: true }).optional(),
});

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);

  /**
   * POST /agents/:id/export-ci
   *
   * Generate the CI bundle for the agent. When action='open_pr', commits
   * files to the devdigest/ci branch and opens (or reuses) a PR. When
   * action='files', returns the bundle without any GitHub side effects.
   */
  app.post(
    '/agents/:id/export-ci',
    {
      schema: {
        params: IdParams,
        body: CiExportInput,
        response: { 200: CiExport },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.exportCi(req.params.id, workspaceId, req.body);
    },
  );

  /**
   * GET /agents/:id/ci-installations
   *
   * List all CI installations for a given agent (workspace-scoped).
   */
  app.get(
    '/agents/:id/ci-installations',
    {
      schema: {
        params: IdParams,
        response: { 200: z.array(CiInstallation) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getInstallations(req.params.id, workspaceId);
    },
  );

  /**
   * GET /ci-runs
   *
   * Workspace-scoped list of CI run records with optional filters.
   */
  app.get(
    '/ci-runs',
    {
      schema: {
        querystring: CiRunsQuery,
        response: { 200: z.array(CiRun) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { agent_id, repo, status, since } = req.query;
      return service.getCiRuns(workspaceId, {
        agentId: agent_id,
        repo,
        status,
        since: since ? new Date(since) : undefined,
      });
    },
  );

  /**
   * POST /ci-runs/sync
   *
   * Trigger a sync of all CI run records from GitHub for the workspace.
   * Returns the number of newly-ingested rows.
   */
  app.post(
    '/ci-runs/sync',
    {
      schema: {
        body: z.object({}),
        response: { 200: z.object({ synced: z.number().int() }) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.syncCiRuns(workspaceId);
    },
  );
}
