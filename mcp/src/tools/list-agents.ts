/**
 * Tool: list_agents
 *
 * Lists all configured review agents so the model can pick a valid agentId
 * for run_agent_on_pr. Optionally includes disabled agents.
 *
 * Read-only. Makes one API call: GET /agents.
 * All freeform agent description text is fenced via wrapUntrusted().
 *
 * ---
 * Schema casting note:
 * schemas.ts imports from 'zod' which the tsconfig path alias resolves to
 * the CJS type declarations (.d.cts). The SDK's ZodRawShapeCompat expects
 * ESM 'zod/v3' type declarations (.d.ts). Both point to the same runtime
 * code; the casts below bridge the TypeScript module-instance mismatch.
 *
 * The callback uses `args: unknown` (valid by contravariance — unknown
 * accepts any incoming type) and casts inside the body. The SDK validates
 * args against the schema before invoking the handler.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAgents, ApiError } from '../api/client.js';
import { wrapUntrusted } from '../format.js';
import { listAgentsInputShape, listAgentsOutputShape } from '../schemas.js';

// The shape the SDK will parse from input, mirroring the Zod schema.
type ListAgentsArgs = { includeDisabled: boolean };

export function registerListAgents(server: McpServer): void {
  server.registerTool(
    'list_agents',
    {
      title: 'List Review Agents',
      description:
        'Lists the configured review agents (id, name, description) so the model can pick a valid agent id for run_agent_on_pr.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      // Casts bridge the zod CJS/ESM module-instance type mismatch (same runtime).
      /* eslint-disable @typescript-eslint/no-explicit-any */
      inputSchema: listAgentsInputShape as unknown as Record<string, any>,
      outputSchema: listAgentsOutputShape as unknown as Record<string, any>,
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    // `unknown` is valid by contravariance; SDK validates before calling.
    async (args: unknown) => {
      const { includeDisabled } = args as ListAgentsArgs;
      try {
        const agents = await getAgents();

        // Filter disabled agents unless caller explicitly opts in.
        const filtered = includeDisabled
          ? agents
          : agents.filter((a) => a.enabled);

        const count = filtered.length;

        // Build a concise text mirror. Descriptions are freeform (untrusted).
        const agentLines = filtered
          .map(
            (a) =>
              `${a.name} (${a.id}) — ${wrapUntrusted('agent-description', a.description)}`,
          )
          .join('; ');

        const text =
          count > 0 ? `${count} agents: ${agentLines}` : '0 agents configured.';

        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: {
            agents: filtered.map((a) => ({
              id: a.id,
              name: a.name,
              description: a.description,
              provider: a.provider,
              model: a.model,
              enabled: a.enabled,
            })),
            count,
          },
        };
      } catch (err) {
        const message =
          err instanceof ApiError
            ? `DevDigest API error (${err.code}): ${err.message}`
            : `Failed to list agents: ${String(err)}`;
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );
}
