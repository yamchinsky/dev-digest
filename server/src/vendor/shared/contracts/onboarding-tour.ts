import { z } from 'zod';

// NOTE: the LLM-response decoder (TourLLMSchema) is intentionally NOT here —
// it is a server-internal adapter artifact and lives in
// `server/src/modules/onboarding-tours/helpers.ts`. This file holds only the
// domain contracts the client consumes.

/** Five-field sections object persisted in onboarding_tours.sections (jsonb).
 *  critical_paths and how_to_run_locally are structured arrays so the client
 *  can render per-item rows (with Open links / copy buttons) without parsing
 *  freeform markdown. */
export const OnboardingTourSections = z.object({
  architecture_overview: z.string(),
  critical_paths: z.array(z.object({ file: z.string(), why: z.string() })),
  how_to_run_locally: z.array(z.string()),
  first_tasks: z.string(),
});
export type OnboardingTourSections = z.infer<typeof OnboardingTourSections>;

/** One entry in the rank-ordered reading path. */
export const ReadingPathItem = z.object({
  file: z.string(),
  rank: z.number(),
  description: z.string(),
});
export type ReadingPathItem = z.infer<typeof ReadingPathItem>;

/** Full tour DTO — returned by GET and embedded in the POST success response. */
export const OnboardingTour = z.object({
  repo_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  sections: OnboardingTourSections,
  reading_path: z.array(ReadingPathItem),
  generated_at: z.string(), // ISO 8601
  files_indexed: z.number().int().nonnegative(),
  index_status_at_generation: z.enum(['full', 'partial', 'degraded', 'failed']),
});
export type OnboardingTour = z.infer<typeof OnboardingTour>;

/** Telemetry log included in the POST success response. */
export const GenerationLog = z.object({
  llm_calls: z.literal(1),
  model: z.string().min(1),
  tokens_used: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
});
export type GenerationLog = z.infer<typeof GenerationLog>;
