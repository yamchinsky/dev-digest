/**
 * Tool registry — collects all 5 MCP tool registrar functions and exposes a
 * single `registerAllTools(server)` call used by the composition root.
 *
 * Import order is intentional (read-only tools first, mutating last) but has
 * no runtime effect; MCP does not preserve registration order in `tools/list`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerListAgents } from './list-agents.js';
import { registerGetFindings } from './get-findings.js';
import { registerGetConventions } from './get-conventions.js';
import { registerGetBlastRadius } from './get-blast-radius.js';
import { registerRunAgentOnPr } from './run-agent-on-pr.js';

/**
 * Registers all 5 DevDigest tools on the given McpServer instance.
 *
 * Call this once, before `server.connect(transport)`.
 */
export function registerAllTools(server: McpServer): void {
  registerListAgents(server);
  registerGetFindings(server);
  registerGetConventions(server);
  registerGetBlastRadius(server);
  registerRunAgentOnPr(server);
}
