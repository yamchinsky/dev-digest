/**
 * Smart Diff — pure classifier and composer.
 *
 * Two exported functions, zero I/O, zero side effects:
 *   - `classifyPath(path): SmartDiffRole`
 *   - `composeSmartDiff(prFiles, findings): SmartDiff`
 *
 * All string/numeric literals live in smart-diff.constants.ts.
 */

import type { SmartDiff, SmartDiffFile, SmartDiffRole } from '@devdigest/shared';
import {
  BARREL,
  BOILERPLATE_EXT,
  DOC_EXT,
  GENERATED_DIRS,
  LOCKFILES,
  SPLIT_TOO_BIG_LINES,
  TEST_DIRS,
  TEST_RE,
  WIRING_CONFIG_RE,
  WIRING_DIRS,
} from './smart-diff.constants.js';

// ---------------------------------------------------------------------------
// classifyPath
// ---------------------------------------------------------------------------

/**
 * Classify a POSIX file path into one of the three Smart Diff roles.
 *
 * Precedence (highest to lowest):
 *   1. boilerplate — lockfiles, generated dirs, binary/map extensions
 *   2. wiring      — config files, CI dirs, tests, barrels, docs
 *   3. core        — everything else
 */
export function classifyPath(path: string): SmartDiffRole {
  const segments = path.split('/');
  const basename = segments[segments.length - 1] ?? '';
  const lowerBasename = basename.toLowerCase();

  // ---- Boilerplate (checked first per precedence) ----

  // 1a. Exact lockfile basenames (case-sensitive, as filenames in the wild)
  if (LOCKFILES.has(basename)) {
    return 'boilerplate';
  }

  // 1b. Any path segment matches a generated/artifact directory
  const lowerSegments = segments.map((s) => s.toLowerCase());
  for (const seg of lowerSegments) {
    if (GENERATED_DIRS.has(seg)) {
      return 'boilerplate';
    }
  }

  // 1c. Extension or compound suffix matches boilerplate patterns
  for (const ext of BOILERPLATE_EXT) {
    if (lowerBasename.endsWith(ext)) {
      return 'boilerplate';
    }
  }

  // ---- Wiring ----

  // 2a. Basename matches a known wiring config pattern
  if (WIRING_CONFIG_RE.test(basename)) {
    return 'wiring';
  }

  // 2b. Any path segment is a wiring directory
  for (const seg of lowerSegments) {
    if (WIRING_DIRS.has(seg)) {
      return 'wiring';
    }
  }

  // 2c. Basename matches a test/spec file pattern
  if (TEST_RE.test(basename)) {
    return 'wiring';
  }

  // 2d. Any path segment is a test-related directory
  for (const seg of lowerSegments) {
    if (TEST_DIRS.has(seg)) {
      return 'wiring';
    }
  }

  // 2e. Barrel file (index.ts / index.tsx — exact, case-sensitive)
  if (BARREL.has(basename)) {
    return 'wiring';
  }

  // 2f. Documentation extension
  const dotIdx = lowerBasename.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = lowerBasename.slice(dotIdx);
    if (DOC_EXT.has(ext)) {
      return 'wiring';
    }
  }

  // ---- Core — everything else ----
  return 'core';
}

// ---------------------------------------------------------------------------
// composeSmartDiff
// ---------------------------------------------------------------------------

/** Input shape for a single changed file from the PR. */
export interface PrFileInput {
  path: string;
  additions: number;
  deletions: number;
}

/** Input shape for a single finding (only the fields we need). */
export interface FindingInput {
  file: string;
  start_line: number;
  end_line?: number | null;
}

/**
 * Compose the `SmartDiff` contract from PR files and review findings.
 *
 * - Groups files by role (core → wiring → boilerplate); empty groups omitted.
 * - Within each group, files sorted by descending (additions + deletions),
 *   tie-broken by path (ascending).
 * - `finding_lines` = sorted, deduped start-lines of findings whose `file`
 *   equals the file's `path`.
 * - `split_suggestion.proposed_splits` emitted only when `too_big` AND there
 *   are ≥2 distinct top-level directories among core files; otherwise `[]`.
 */
export function composeSmartDiff(
  prFiles: PrFileInput[],
  findings: FindingInput[],
): SmartDiff {
  // Build a lookup: path → sorted+deduped start-lines
  const findingsByPath = new Map<string, Set<number>>();
  for (const finding of findings) {
    const existing = findingsByPath.get(finding.file);
    if (existing) {
      existing.add(finding.start_line);
    } else {
      findingsByPath.set(finding.file, new Set([finding.start_line]));
    }
  }

  // Bucket files by role
  const buckets: Record<SmartDiffRole, SmartDiffFile[]> = {
    core: [],
    wiring: [],
    boilerplate: [],
  };

  for (const f of prFiles) {
    const role = classifyPath(f.path);
    const rawLines = findingsByPath.get(f.path);
    const finding_lines = rawLines
      ? [...rawLines].sort((a, b) => a - b)
      : [];

    buckets[role].push({
      path: f.path,
      pseudocode_summary: null,
      additions: f.additions,
      deletions: f.deletions,
      finding_lines,
    });
  }

  // Sort each bucket by descending total lines, tie-break by path ascending
  const sortFiles = (files: SmartDiffFile[]) =>
    files.sort((a, b) => {
      const diff = b.additions + b.deletions - (a.additions + a.deletions);
      if (diff !== 0) return diff;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });

  const orderedRoles: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];
  const groups = orderedRoles
    .filter((role) => buckets[role].length > 0)
    .map((role) => ({ role, files: sortFiles(buckets[role]) }));

  // Compute split suggestion
  const total_lines = prFiles.reduce(
    (sum, f) => sum + f.additions + f.deletions,
    0,
  );
  const too_big = total_lines > SPLIT_TOO_BIG_LINES;

  let proposed_splits: Array<{ name: string; files: string[] }> = [];

  if (too_big) {
    // Group core files by their top-level path segment
    const topDirMap = new Map<string, { files: string[]; totalLines: number }>();
    for (const f of buckets.core) {
      const topDir = f.path.split('/')[0] ?? f.path;
      const entry = topDirMap.get(topDir);
      if (entry) {
        entry.files.push(f.path);
        entry.totalLines += f.additions + f.deletions;
      } else {
        topDirMap.set(topDir, {
          files: [f.path],
          totalLines: f.additions + f.deletions,
        });
      }
    }

    if (topDirMap.size >= 2) {
      // Sort proposed splits by descending summed lines
      proposed_splits = [...topDirMap.entries()]
        .sort((a, b) => b[1].totalLines - a[1].totalLines)
        .map(([name, { files }]) => ({ name, files }));
    }
  }

  return {
    groups,
    split_suggestion: {
      too_big,
      total_lines,
      proposed_splits,
    },
  };
}
