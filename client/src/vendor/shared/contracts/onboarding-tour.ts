import { z } from 'zod';

/**
 * Five-section schema expected from the LLM's structured call.
 * Server-internal (used in `completeStructured`); included here so it can be
 * imported by the service without reaching into reviewer-core internals.
 *
 * NOTE: `rank` is NOT in the LLM schema — it is injected server-side from
 * getFileRank() after the LLM call. Do not add a `rank` field here or the
 * structured-output contract will expect the model to supply it.
 */
export const TourLLMSchema = z.object({
  architecture_overview: z.string().min(1),
  critical_paths: z.string().min(1),
  how_to_run_locally: z.string().min(1),
  reading_path: z.array(
    z.object({ file: z.string().min(1), description: z.string().min(1) }),
  ),
  first_tasks: z.string().min(1),
});
export type TourLLMSchema = z.infer<typeof TourLLMSchema>;

/** Four prose sections persisted in onboarding_tours.sections. */
export const OnboardingTourSections = z.object({
  architecture_overview: z.string(),
  critical_paths: z.string(),
  how_to_run_locally: z.string(),
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
