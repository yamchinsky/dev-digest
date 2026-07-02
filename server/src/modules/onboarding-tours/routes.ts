import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { OnboardingTour, GenerationLog } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { OnboardingTourService } from './service.js';

/**
 * onboarding-tours module.
 *
 *   GET  /repos/:id/onboarding-tour
 *        → 200 OnboardingTour | 404 (no tour or repo not found)
 *
 *   POST /repos/:id/onboarding-tour/generate
 *        → 200 { tour: OnboardingTour, log: GenerationLog }
 *             | { status: "in_progress" }
 *        Per-route rate limit: 3 calls/minute (cost-control backstop).
 */

const GenerateResponse = z.union([
  z.object({ tour: OnboardingTour, log: GenerationLog }),
  z.object({ status: z.literal('in_progress') }),
]);

export default async function onboardingToursRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new OnboardingTourService(container);

  // ---- GET: fetch the persisted tour (or 404 when not yet generated) --------
  app.get(
    '/repos/:id/onboarding-tour',
    { schema: { params: IdParams, response: { 200: OnboardingTour } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const tour = await service.getTour(workspaceId, req.params.id);
      if (!tour) throw new NotFoundError('No onboarding tour found for this repository');
      return tour;
    },
  );

  // ---- POST: generate (or return in-progress status if already running) -----
  // Per-route rate limit: max 3 calls per minute per client — cheap cost
  // backstop consistent with the /pulls/:id/review precedent. Complements (does
  // not replace) the in-flight Set dedup which prevents concurrent calls.
  app.post(
    '/repos/:id/onboarding-tour/generate',
    {
      schema: { params: IdParams, response: { 200: GenerateResponse } },
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.generateTour(workspaceId, req.params.id);
    },
  );
}
