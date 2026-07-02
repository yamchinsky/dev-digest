import { z } from 'zod';

/**
 * Five-section schema expected from the LLM's structured call.
 *
 * Module-internal adapter decoder (LLM response → typed result) — deliberately
 * NOT in `@devdigest/shared`: the client never parses LLM output, and the
 * domain DTO the client consumes is `OnboardingTour` (which stays shared).
 * Moved here from the shared contracts after architecture review.
 *
 * NOTE: `rank` is NOT in the LLM schema — it is injected server-side from
 * getFileRank() after the LLM call. Do not add a `rank` field here or the
 * structured-output contract will expect the model to supply it.
 *
 * description is intentionally NOT min(1): providers' constrained decoding
 * ignores minLength, and models leave "" for unfamiliar (vendored/generated)
 * files — a hard min fails the whole response; the service falls back to ''.
 */
export const TourLLMSchema = z.object({
  architecture_overview: z.string().min(1),
  // Array of the 4-8 most important files with a one-line reason each.
  // Not min(1) on `why`: providers' constrained decoding ignores minLength and
  // models leave "" for unfamiliar files — a hard min fails the whole response.
  critical_paths: z.array(z.object({ file: z.string().min(1), why: z.string() })),
  // Ordered shell commands — each entry is one executable line (may carry a
  // trailing `# comment`). Array form lets the UI render numbered rows with
  // per-row copy buttons rather than a freeform markdown block.
  how_to_run_locally: z.array(z.string().min(1)),
  reading_path: z.array(
    z.object({ file: z.string().min(1), description: z.string() }),
  ),
  first_tasks: z.string().min(1),
});
export type TourLLMSchema = z.infer<typeof TourLLMSchema>;
