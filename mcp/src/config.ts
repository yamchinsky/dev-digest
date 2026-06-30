/**
 * MCP package configuration.
 *
 * All values come from environment variables with sensible defaults, validated
 * with Zod so a malformed value (e.g. DEVDIGEST_MCP_HTTP_TIMEOUT_MS=abc) fails
 * fast at startup with a readable message instead of silently falling back to a
 * default. No secrets are stored or logged here — the DevDigest API is
 * local-only (no-auth).
 *
 * stdout is reserved for JSON-RPC framing, so validation errors go to stderr.
 */

import { z } from 'zod';

/** Optional positive-integer millisecond env var; '' or unset → default. */
const msVar = (defaultMs: number) =>
  z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().positive().default(defaultMs),
  );

const EnvSchema = z.object({
  /** Base URL of the DevDigest HTTP API. */
  DEVDIGEST_API_URL: z.string().url().default('http://localhost:3001'),
  /** Timeout for individual HTTP requests (ms). */
  DEVDIGEST_MCP_HTTP_TIMEOUT_MS: msVar(15_000),
  /** Hard wall-clock timeout while waiting for a review run (ms). */
  DEVDIGEST_MCP_REVIEW_TIMEOUT_MS: msVar(180_000),
  /** Polling interval between run-status checks (ms). */
  DEVDIGEST_MCP_POLL_INTERVAL_MS: msVar(3_000),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // stdout is owned by JSON-RPC — diagnostics MUST go to stderr.
  console.error(`Invalid DevDigest MCP configuration:\n${details}`);
  process.exit(1);
}

const config = Object.freeze({
  /** Base URL of the DevDigest HTTP API. */
  apiUrl: parsed.data.DEVDIGEST_API_URL,
  /** Timeout for individual HTTP requests (ms). */
  httpTimeoutMs: parsed.data.DEVDIGEST_MCP_HTTP_TIMEOUT_MS,
  /** Hard wall-clock timeout while waiting for a review run (ms). */
  reviewTimeoutMs: parsed.data.DEVDIGEST_MCP_REVIEW_TIMEOUT_MS,
  /** Polling interval between run-status checks (ms). */
  pollIntervalMs: parsed.data.DEVDIGEST_MCP_POLL_INTERVAL_MS,
});

export type Config = typeof config;
export default config;
