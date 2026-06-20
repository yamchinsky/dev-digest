/**
 * Skill-import safety limits. Conservative on purpose — a skill is a small
 * markdown rules sheet, not an artifact bundle.
 */
export const MAX_SKILL_BODY_BYTES = 65_536; // 64 KB per skill (matches Zod's max)
export const MAX_ZIP_ENTRIES = 50;
export const MAX_ZIP_ENTRY_BYTES = 256 * 1024; // 256 KB per file inside the zip
export const MAX_ZIP_TOTAL_BYTES = 1024 * 1024; // 1 MB decompressed across all entries

/** Per-route body limit for `POST /skills/import/preview`. JSON-base64 of the
 *  max zip (≈1.36×) plus envelope; round up to a clean 2 MiB. */
export const IMPORT_PREVIEW_BODY_LIMIT = 2 * 1024 * 1024;

/** Initial version for a freshly-created skill. The companion table
 *  `skill_versions` snapshots immutable body history starting at 1. */
export const INITIAL_SKILL_VERSION = 1;
