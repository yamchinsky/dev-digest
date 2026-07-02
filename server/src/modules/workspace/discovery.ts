import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { promises as fsPromises } from 'node:fs';

export type ContextDocCategory = 'specs' | 'docs' | 'insights';

const CATEGORY_SEGMENTS = new Set<string>(['specs', 'docs', 'insights']);

/**
 * Pure filesystem utility — no DB, no network. Discovers Markdown files whose
 * path contains a `specs`, `docs`, or `insights` directory segment.
 *
 * Designed to be side-effect-free and importable by multiple modules (agents,
 * skills, workspace service) without creating circular dependencies.
 *
 * @param repos Array of {repoId, clonePath} — null clonePath or missing
 *              directory is silently skipped (AC-2).
 */
export async function discoverContextDocs(
  repos: Array<{ repoId: string; clonePath: string | null }>,
): Promise<Array<{ repoId: string; relativePath: string; category: ContextDocCategory }>> {
  const results: Array<{ repoId: string; relativePath: string; category: ContextDocCategory }> =
    [];

  for (const repo of repos) {
    // AC-2: skip silently when clonePath is null or the directory does not exist on disk
    if (!repo.clonePath) continue;
    if (!existsSync(repo.clonePath)) continue;

    // Node 23's fs.promises.glob does not follow symlinks by default — intentional:
    // symlink traversal could escape the clone directory boundary. Do NOT add
    // `followSymlinks: true` here; the path-containment guard below is defense-in-depth.
    const relativePaths = fsPromises.glob('**/{specs,docs,insights}/**/*.md', {
      cwd: repo.clonePath,
    });

    const resolvedRoot = path.resolve(repo.clonePath);

    for await (const rel of relativePaths) {
      // Security guard: verify each resolved absolute path stays within clonePath.
      // Crafted filenames (e.g. those containing '..') could otherwise escape the
      // clone root. We drop any path that escapes rather than erroring.
      const resolved = path.resolve(repo.clonePath, rel);
      if (!resolved.startsWith(resolvedRoot + path.sep)) continue;

      // Derive category from the FIRST path segment that matches specs / docs / insights.
      // Glob guarantees one of these is present; find returns undefined only on a
      // crafted path that somehow passed the glob but has no matching segment.
      const category = rel.split('/').find((s): s is ContextDocCategory =>
        CATEGORY_SEGMENTS.has(s),
      );
      if (!category) continue;

      results.push({ repoId: repo.repoId, relativePath: rel, category });
    }
  }

  return results;
}
