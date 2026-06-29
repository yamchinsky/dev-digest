/**
 * Tool: get_findings
 *
 * Returns a concise verdict and finding-count summary for the latest
 * completed review of a pull request, without re-running it.
 *
 * Read-only. API calls: resolveRepoId → getPulls → getReviews.
 * Structured output is typed data. Text mirror contains only safe
 * facts (verdict enum, numeric score/counts) — no freeform text.
 *
 * See list-agents.ts for the schema-casting and callback-args note.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolvePullId, getReviews, ApiError } from '../api/client.js';
import { buildCounts, summarizeCounts, verdictLine } from '../format.js';
import { getFindingsInputShape, getFindingsOutputShape } from '../schemas.js';

// The shape the SDK will parse from input, mirroring the Zod schema.
type GetFindingsArgs = { repo: string; prNumber: number; agentId?: string };

export function registerGetFindings(server: McpServer): void {
  server.registerTool(
    'get_findings',
    {
      title: 'Get Findings Summary',
      description:
        'Returns a concise verdict and finding-count summary for the latest completed review of a pull request, without re-running it.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      // Casts bridge the zod CJS/ESM module-instance type mismatch (same runtime).
      /* eslint-disable @typescript-eslint/no-explicit-any */
      inputSchema: getFindingsInputShape as unknown as Record<string, any>,
      outputSchema: getFindingsOutputShape as unknown as Record<string, any>,
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    // `unknown` is valid by contravariance; SDK validates before calling.
    async (args: unknown) => {
      const { repo, prNumber, agentId } = args as GetFindingsArgs;
      try {
        const pullId = await resolvePullId(repo, prNumber);
        const reviews = await getReviews(pullId);

        // Only 'review' kind records carry findings + verdict.
        let candidates = reviews.filter((r) => r.kind === 'review');

        // Optionally narrow to the requested agent.
        if (agentId !== undefined) {
          candidates = candidates.filter((r) => r.agent_id === agentId);
        }

        if (candidates.length === 0) {
          const agentHint = agentId ? ` for agent ${agentId}` : '';
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `No completed review for ${repo}#${prNumber}${agentHint}; ` +
                  'run run_agent_on_pr first.',
              },
            ],
            isError: true,
          };
        }

        // Sort newest first and take the most recent.
        const latest = [...candidates].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0]!;

        const counts = buildCounts(latest.findings);
        const countSummary = summarizeCounts(latest.findings);
        const vLine = verdictLine(latest.verdict, latest.score);

        // Text mirror: verdict + score + counts. All values are safe enums /
        // numbers — no freeform agent text in the text content.
        const text = `Review for ${repo}#${prNumber}: ${vLine}. ${countSummary}.`;

        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: {
            pullId,
            reviewId: latest.id,
            agentName: latest.agent_name ?? null,
            verdict: latest.verdict,
            score: latest.score,
            grounding: latest.grounding ?? null,
            counts,
            summary: latest.summary,
            reviewedAt: latest.created_at,
          },
        };
      } catch (err) {
        const message =
          err instanceof ApiError
            ? `DevDigest API error (${err.code}): ${err.message}`
            : `Failed to get findings for ${repo}#${prNumber}: ${String(err)}`;
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );
}
