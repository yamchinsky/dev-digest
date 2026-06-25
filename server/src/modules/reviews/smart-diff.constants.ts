/**
 * Constants for the Smart Diff path classifier and composer.
 *
 * NO numeric or string literals should appear inline in smart-diff.ts —
 * every pattern set and threshold lives here.
 */

// ---------------------------------------------------------------------------
// Boilerplate detection
// ---------------------------------------------------------------------------

/**
 * Exact lockfile basenames (case-sensitive). These ALWAYS classify as
 * boilerplate regardless of their location in the tree.
 */
export const LOCKFILES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'Cargo.lock',
  'poetry.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
]);

/**
 * Path segments that indicate generated/artifact output directories.
 * A file is boilerplate if any segment of its POSIX path matches one of
 * these values (exact, case-insensitive comparison).
 */
export const GENERATED_DIRS: ReadonlySet<string> = new Set([
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  'node_modules',
  '__generated__',
  '__snapshots__',
]);

/**
 * File extensions and compound suffixes that indicate boilerplate files
 * (snapshots, source maps, minified bundles, binary assets).
 * Checked against the full filename (lowercased), not just the extension.
 */
export const BOILERPLATE_EXT: ReadonlyArray<string> = [
  '.snap',
  '.map',
  '.min.js',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.ico',
  '.woff2',
];

// ---------------------------------------------------------------------------
// Wiring detection
// ---------------------------------------------------------------------------

/**
 * Glob-like patterns for config-file basenames that indicate "wiring" files.
 * Checked via the WIRING_CONFIG_RE compiled pattern below.
 *
 * Covered patterns:
 *   tsconfig*.json
 *   package.json
 *   .eslintrc*
 *   eslint.config.*
 *   .prettierrc* / prettier.config.*
 *   *.config.{js,ts,mjs,cjs}
 *   Dockerfile
 *   docker-compose*.{yml,yaml}
 *   .env*
 *   *.yml / *.yaml
 */
export const WIRING_CONFIG_RE: RegExp =
  /^(tsconfig.*\.json|package\.json|\.eslintrc.*|eslint\.config\..+|\.prettierrc.*|prettier\.config\..+|.*\.config\.(js|ts|mjs|cjs)|Dockerfile|docker-compose.*\.(yml|yaml)|\.env.*|.*\.(yml|yaml))$/i;

/**
 * Path segments that classify a file as wiring (CI pipelines, DB migrations,
 * i18n messages).
 */
export const WIRING_DIRS: ReadonlySet<string> = new Set([
  '.github',
  'migrations',
  'messages',
]);

/**
 * Regex that matches test/spec file basenames.
 * Covers: *.test.*, *.spec.*, *.it.test.*
 */
export const TEST_RE: RegExp = /\.(test|spec|it\.test)\.[^.]+$/i;

/**
 * Test-related path segments (directory names) that also indicate wiring.
 */
export const TEST_DIRS: ReadonlySet<string> = new Set(['__tests__', 'e2e']);

/**
 * Barrel file basenames that classify as wiring (re-export surfaces rather
 * than core logic).
 */
export const BARREL: ReadonlySet<string> = new Set(['index.ts', 'index.tsx']);

/**
 * File extensions that indicate documentation (wiring, not core logic).
 */
export const DOC_EXT: ReadonlySet<string> = new Set(['.md', '.mdx']);

// ---------------------------------------------------------------------------
// Composer thresholds
// ---------------------------------------------------------------------------

/**
 * Total line change count (additions + deletions across ALL files) above
 * which the split suggestion is triggered (`too_big = true`).
 */
export const SPLIT_TOO_BIG_LINES = 500;
