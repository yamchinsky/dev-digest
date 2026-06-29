/**
 * run_agent_on_pr — the only mutating MCP tool.
 *
 * Flow:
 *   1. resolvePullId(repo, prNumber)                 → pullId (UUID)
 *   2. startReview(pullId, agentId)                  → captures run_id (fire-and-forget on server)
 *   3. Poll getRuns(pullId) every pollIntervalMs      → find run by run_id, await terminal status
 *      ↳ emit notifications/progress on each tick if progressToken is present
 *   4. On done   → getReviews, match run_id, wrap untrusted text, return structuredContent + text
 *   5. On failed / cancelled                         → isError:true with run.error
 *   6. On timeout (> reviewTimeoutMs)                → isError:true "check later with get_findings"
 *
 * Security:
 *   - All HTTP calls go through api/client.ts which attaches an AbortController timeout.
 *   - Untrusted text from the API (titles, rationales, file paths, summary) is wrapped
 *     via wrapUntrusted() before being returned to the LLM.
 *   - Never fabricates findings on timeout or error.
 *   - Never throws to the MCP protocol — all errors surface as content + isError:true.
 *
 * TypeScript note — schema casts at the registerTool call site:
 *   schemas.ts imports from 'zod' which the tsconfig paths alias resolves to the
 *   CTS (.d.cts) declarations.  The MCP SDK imports 'zod/v3' which — through the
 *   same paths alias — resolves to the ESM (.d.ts) declarations.  TypeScript tracks
 *   the module *kind* (ESM vs CJS) independently of structural compatibility, so the
 *   two Zod classes are seen as incompatible even though they are identical at
 *   runtime.  The `as unknown as ...` casts below are the minimal workaround.
 *   Callback parameters are annotated explicitly to restore type-safety.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runAgentOnPrInputShape, runAgentOnPrOutputShape } from '../schemas.js';
import {
  ApiError,
  resolvePullId,
  startReview,
  getRuns,
  getReviews,
} from '../api/client.js';
import {
  summarizeCounts,
  verdictLine,
  buildCounts,
  wrapUntrusted,
} from '../format.js';
import config from '../config.js';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/** Inferred input shape — kept in sync with runAgentOnPrInputShape manually. */
type RunAgentOnPrArgs = {
  repo: string;
  prNumber: number;
  agentId: string;
};

/**
 * Minimal structural view of the handler's extra parameter that captures every
 * property we actually access.  The full type is
 *   RequestHandlerExtra<ServerRequest, ServerNotification>
 * from @modelcontextprotocol/sdk/shared/protocol.js — that module is not part
 * of the SDK's public export map, so we use a structural subtype instead.
 */
interface HandlerExtra {
  _meta?: {
    progressToken?: string | number;
  };
  sendNotification: (notification: {
    method: 'notifications/progress';
    params: {
      progressToken: string | number;
      progress: number;
      total?: number;
      message?: string;
    };
  }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerRunAgentOnPr(server: McpServer): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      title: 'Run Agent on PR',
      description:
        'Runs the chosen review agent on a pull request, waits for it to finish, and returns the ready findings summary.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      // See module-level TS note for why the casts are necessary.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: runAgentOnPrInputShape as unknown as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      outputSchema: runAgentOnPrOutputShape as unknown as any,
    },
    async (args: RunAgentOnPrArgs, extra: HandlerExtra) => {
      const { repo, prNumber, agentId } = args;

      try {
        // ── Step 1: Resolve PR to internal UUID ───────────────────────────
        const pullId = await resolvePullId(repo, prNumber);

        // ── Step 2: Start the review (fire-and-forget on server side) ─────
        const resp = await startReview(pullId, agentId);

        // Capture run_id: prefer the run belonging to our agent, else first.
        const runTarget =
          resp.runs.find((r) => r.agent_id === agentId) ?? resp.runs[0];

        if (!runTarget) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Review started but no run was returned by the server. The agent may have been disabled or an internal error occurred.',
              },
            ],
            isError: true,
          };
        }

        const runId = runTarget.run_id;

        // ── Step 3: Poll until terminal or timeout ─────────────────────────
        const startTime = Date.now();
        let pollCount = 0;
        let lastStatus: string | null = null;

        // This loop exits via break (terminal) or an early return (timeout).
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // Real delay between polls — never busy-spin.
          await new Promise<void>((resolve) => setTimeout(resolve, config.pollIntervalMs));

          const elapsed = Date.now() - startTime;

          // Fetch the latest run list and locate our run.
          const runs = await getRuns(pullId);
          const run = runs.find((r) => r.run_id === runId);

          if (!run) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Run ${runId} disappeared from the run list. It may have been deleted before completing.`,
                },
              ],
              isError: true,
            };
          }

          pollCount++;
          lastStatus = run.status;
          const findingsCount = run.findings_count ?? 0;

          // Emit progress notification if the caller supplied a progress token.
          // progress MUST increase monotonically; we use pollCount (starts at 1).
          const progressToken = extra._meta?.progressToken;
          if (progressToken !== undefined) {
            const elapsedSec = Math.floor(elapsed / 1000);
            try {
              await extra.sendNotification({
                method: 'notifications/progress',
                params: {
                  progressToken,
                  progress: pollCount,
                  message: `running… ${elapsedSec}s elapsed (${findingsCount} findings so far)`,
                },
              });
            } catch {
              // Best-effort — notification failures must not abort the poll.
              console.error(
                `[run_agent_on_pr] progress notification failed (poll ${pollCount})`,
              );
            }
          }

          // Check for terminal status before testing timeout so that a run
          // completing just past the deadline still returns its result.
          if (run.status !== null && TERMINAL_STATUSES.has(run.status)) {
            break;
          }

          // Hard wall-clock timeout.
          if (elapsed >= config.reviewTimeoutMs) {
            const timeoutSec = Math.floor(config.reviewTimeoutMs / 1000);
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    `Review still running after ${timeoutSec}s. Check later with get_findings ` +
                    `(run ID: ${runId}).`,
                },
              ],
              structuredContent: {
                pullId,
                runId,
                status: 'timeout',
                verdict: null,
                score: null,
                grounding: null,
                counts: { total: 0, critical: 0, warning: 0, suggestion: 0 },
                summary: null,
                findings: [],
              },
              isError: true,
            };
          }
        }

        // ── Step 4a: failed / cancelled ────────────────────────────────────
        if (lastStatus === 'failed' || lastStatus === 'cancelled') {
          // Re-fetch to get the latest error message.
          const runs = await getRuns(pullId);
          const run = runs.find((r) => r.run_id === runId);
          const errorDetail = run?.error;

          const text =
            lastStatus === 'failed'
              ? `Review run failed${errorDetail ? `: ${errorDetail}` : '.'}`
              : `Review run was cancelled${errorDetail ? `: ${errorDetail}` : '.'}`;

          return {
            content: [{ type: 'text' as const, text }],
            structuredContent: {
              pullId,
              runId,
              status: lastStatus,
              verdict: null,
              score: null,
              grounding: null,
              counts: { total: 0, critical: 0, warning: 0, suggestion: 0 },
              summary: null,
              findings: [],
            },
            isError: true,
          };
        }

        // ── Step 4b: done — fetch reviews and match our run ────────────────
        const reviews = await getReviews(pullId);
        const review = reviews.find((r) => r.run_id === runId);

        if (!review) {
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Run ${runId} completed but no review record was found. ` +
                  'Try get_findings to check if it was saved.',
              },
            ],
            isError: true,
          };
        }

        const { findings } = review;
        const counts = buildCounts(findings);

        // Wrap all untrusted text before returning it to the LLM.
        const wrappedFindings = findings.map((f) => ({
          severity: f.severity,
          category: f.category,
          title: wrapUntrusted('title', f.title),
          file: wrapUntrusted('file', f.file),
          line: f.start_line,
          rationale: wrapUntrusted('rationale', f.rationale),
        }));

        const wrappedSummary =
          review.summary !== null && review.summary !== undefined
            ? wrapUntrusted('summary', review.summary)
            : null;

        const groundingText =
          review.grounding !== null && review.grounding !== undefined
            ? review.grounding
            : null;

        // Build the mirrored human-readable text summary.
        const textLines: string[] = [
          verdictLine(review.verdict ?? null, review.score ?? null),
          summarizeCounts(findings),
        ];
        if (groundingText) textLines.push(`Grounding: ${groundingText}`);
        if (wrappedSummary) textLines.push(`Summary: ${wrappedSummary}`);

        return {
          content: [{ type: 'text' as const, text: textLines.join('\n') }],
          structuredContent: {
            pullId,
            runId,
            status: 'done',
            verdict: review.verdict ?? null,
            score: review.score ?? null,
            grounding: groundingText,
            counts,
            summary: wrappedSummary,
            findings: wrappedFindings,
          },
        };
      } catch (err) {
        // Never propagate to the MCP protocol — surface as an actionable error.
        if (err instanceof ApiError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `API error (${err.code}): ${err.message}`,
              },
            ],
            isError: true,
          };
        }

        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Unexpected error while running review: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
