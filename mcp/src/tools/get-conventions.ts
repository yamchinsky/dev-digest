/**
 * Tool: get_conventions
 *
 * Returns the repository's approved coding conventions (L02 repo-conventions
 * feature). Defaults to status=approved.
 *
 * Read-only. API calls: resolveRepoId → getConventions.
 * Rule and description fields are freeform API text and are wrapped via
 * wrapUntrusted() in the text mirror.
 *
 * See list-agents.ts for the schema-casting and callback-args note.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveRepoId, getConventions, ApiError } from '../api/client.js';
import { wrapUntrusted } from '../format.js';
import { getConventionsInputShape, getConventionsOutputShape } from '../schemas.js';

// The shape the SDK will parse from input, mirroring the Zod schema.
type GetConventionsArgs = {
  repo: string;
  status: 'approved' | 'pending' | 'rejected';
};

export function registerGetConventions(server: McpServer): void {
  server.registerTool(
    'get_conventions',
    {
      title: 'Get Repository Conventions',
      description:
        "Returns the repository's approved coding conventions (the repo-conventions feature from L02).",
      annotations: { readOnlyHint: true, openWorldHint: false },
      // Casts bridge the zod CJS/ESM module-instance type mismatch (same runtime).
      /* eslint-disable @typescript-eslint/no-explicit-any */
      inputSchema: getConventionsInputShape as unknown as Record<string, any>,
      outputSchema: getConventionsOutputShape as unknown as Record<string, any>,
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    // `unknown` is valid by contravariance; SDK validates before calling.
    async (args: unknown) => {
      const { repo, status } = args as GetConventionsArgs;
      try {
        const repoId = await resolveRepoId(repo);
        const rows = await getConventions(repoId, status);
        const count = rows.length;

        // Build text mirror. Rule and description are freeform — wrap each.
        const lines = rows.map((c) => {
          const descPart =
            c.description !== null
              ? ` — ${wrapUntrusted('convention-description', c.description)}`
              : '';
          return `[${c.category}] ${wrapUntrusted('convention-rule', c.rule)}${descPart}`;
        });

        const text =
          count > 0
            ? `${count} ${status} conventions for ${repo}:\n${lines.join('\n')}`
            : `No ${status} conventions found for ${repo}.`;

        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: {
            repoId,
            conventions: rows.map((c) => ({
              category: c.category,
              rule: c.rule,
              description: c.description,
              confidence: c.confidence,
            })),
            count,
          },
        };
      } catch (err) {
        const message =
          err instanceof ApiError
            ? `DevDigest API error (${err.code}): ${err.message}`
            : `Failed to get conventions for ${repo}: ${String(err)}`;
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );
}
