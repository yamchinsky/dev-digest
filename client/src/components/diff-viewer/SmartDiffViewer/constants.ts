import type { Severity } from "@devdigest/shared";

/** Higher rank = more severe. Used to pick a file's most-severe finding for the
 *  aggregated per-file badge deep-link. */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};
