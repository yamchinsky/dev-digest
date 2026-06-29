/**
 * Tool: get_blast_radius
 *
 * Returns the PR impact map (blast radius) — which symbols changed, what calls
 * them downstream, which HTTP endpoints and cron jobs are affected, and prior
 * PRs that touched the same files.
 *
 * Flow:
 *   1. resolvePullId(repo, prNumber)  → pullId (UUID)
 *   2. getBlast(pullId)               → BlastRadius from GET /pulls/:id/blast
 *   3. Return structuredContent = the BlastRadius + mirrored TEXT summary.
 *
 * Security:
 *   - All untrusted text (symbol names, file paths, caller names, PR titles,
 *     index summary) is wrapped via wrapUntrusted() in the TEXT content.
 *   - structuredContent is returned raw so callers can act on typed data.
 *   - A degraded / partial / failed status is NOT an error — the server always
 *     returns a best-effort result; only ApiError / unexpected → isError:true.
 *
 * Read-only. Makes NO mutation.
 *
 * See list-agents.ts for the schema-casting and callback-args note.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getBlastRadiusInputShape, getBlastRadiusOutputShape } from '../schemas.js';
import { ApiError, resolvePullId, getBlast } from '../api/client.js';
import { wrapUntrusted } from '../format.js';

// Inferred input type mirroring getBlastRadiusInputShape.
type GetBlastRadiusArgs = { repo: string; prNumber: number };

export function registerGetBlastRadius(server: McpServer): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Get Blast Radius',
      description:
        'Returns the PR impact map: which symbols changed, what code calls them downstream, ' +
        'which HTTP endpoints and cron jobs are transitively affected, and prior PRs that ' +
        'touched the same files. Requires the repo-intel index to be populated.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      // Casts bridge the zod CJS/ESM module-instance type mismatch (same runtime).
      /* eslint-disable @typescript-eslint/no-explicit-any */
      inputSchema: getBlastRadiusInputShape as unknown as Record<string, any>,
      outputSchema: getBlastRadiusOutputShape as unknown as Record<string, any>,
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    async (args: unknown) => {
      const { repo, prNumber } = args as GetBlastRadiusArgs;

      try {
        // ── Step 1: Resolve PR to internal UUID ───────────────────────────
        const pullId = await resolvePullId(repo, prNumber);

        // ── Step 2: Fetch blast radius from the server ────────────────────
        const blast = await getBlast(pullId);

        // ── Step 3: Build human-readable TEXT summary ─────────────────────
        // All repo-derived text (symbol names, file paths, caller names,
        // PR titles, index summary) is wrapped via wrapUntrusted().
        const textLines: string[] = [];

        // Status / degraded note — safe server-controlled values.
        const statusNote =
          blast.status !== 'full' && blast.degraded_reason
            ? ` (index ${blast.status}: ${blast.degraded_reason})`
            : blast.status !== 'full'
              ? ` (index ${blast.status})`
              : '';

        textLines.push(
          `Blast radius for ${repo}#${prNumber}${statusNote}: ${wrapUntrusted('blast-summary', blast.summary)}`,
        );

        textLines.push(
          `Changed: ${blast.changed_symbols.length} symbol(s), ` +
            `downstream impacts: ${blast.downstream.length}, ` +
            `prior PRs: ${blast.prior_prs.length}`,
        );

        // Per-symbol downstream lines (up to first 10 to keep the text compact).
        for (const impact of blast.downstream.slice(0, 10)) {
          const sym = wrapUntrusted('symbol', impact.symbol);
          const callerCount = impact.callers.length;
          const endpointList =
            impact.endpoints_affected.length > 0
              ? `, endpoints: [${impact.endpoints_affected.join(', ')}]`
              : '';
          const cronList =
            impact.crons_affected.length > 0
              ? `, crons: [${impact.crons_affected.join(', ')}]`
              : '';
          textLines.push(`  ${sym} → ${callerCount} caller(s)${endpointList}${cronList}`);
        }

        if (blast.downstream.length > 10) {
          textLines.push(`  … and ${blast.downstream.length - 10} more downstream symbol(s)`);
        }

        // Prior PRs (up to 5).
        if (blast.prior_prs.length > 0) {
          const prLines = blast.prior_prs
            .slice(0, 5)
            .map((p) => `  #${p.number} ${wrapUntrusted('pr-title', p.title)}`);
          textLines.push('Prior PRs touching same files:');
          textLines.push(...prLines);
        }

        return {
          content: [{ type: 'text' as const, text: textLines.join('\n') }],
          structuredContent: blast,
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
            isError: true as const,
          };
        }

        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Unexpected error while fetching blast radius: ${message}`,
            },
          ],
          isError: true as const,
        };
      }
    },
  );
}
