/**
 * MCP package configuration.
 *
 * All values come from environment variables with sensible defaults. No secrets
 * are stored or logged here — the DevDigest API is local-only (no-auth).
 */

function readMs(key: string, defaultMs: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

const config = Object.freeze({
  /** Base URL of the DevDigest HTTP API. */
  apiUrl: process.env['DEVDIGEST_API_URL'] ?? 'http://localhost:3001',
  /** Timeout for individual HTTP requests (ms). */
  httpTimeoutMs: readMs('DEVDIGEST_MCP_HTTP_TIMEOUT_MS', 15_000),
  /** Hard wall-clock timeout while waiting for a review run (ms). */
  reviewTimeoutMs: readMs('DEVDIGEST_MCP_REVIEW_TIMEOUT_MS', 180_000),
  /** Polling interval between run-status checks (ms). */
  pollIntervalMs: readMs('DEVDIGEST_MCP_POLL_INTERVAL_MS', 3_000),
});

export type Config = typeof config;
export default config;
