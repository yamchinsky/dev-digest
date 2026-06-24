import type { UnifiedDiff } from '@devdigest/shared';

/**
 * Format a UnifiedDiff into a compact file+hunk-header string suitable for the
 * intent LLM call (R2). Only paths and reconstructed `@@ … @@` headers are
 * emitted — NO added/removed/context line bodies, NO `diff.raw`. This keeps
 * the token cost of the intent call minimal (the "cheap" call) while giving
 * the LLM enough structure to infer scope.
 *
 * Example output:
 *
 *   src/auth/login.ts
 *   @@ -12,8 +12,14 @@
 *   @@ -45,3 +51,3 @@
 *
 *   src/auth/logout.ts
 *   @@ -1,5 +1,5 @@
 */
export function formatChangedFilesWithHunkHeaders(diff: UnifiedDiff): string {
  const parts: string[] = [];
  for (const file of diff.files) {
    const lines: string[] = [file.path];
    for (const hunk of file.hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    }
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}
