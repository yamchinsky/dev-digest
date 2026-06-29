/**
 * Composition root — DevDigest MCP server.
 *
 * Responsibilities:
 *   1. Construct McpServer with capabilities + instructions.
 *   2. Register all 5 tools.
 *   3. Connect a StdioServerTransport.
 *   4. Emit a single diagnostic line to stderr (never stdout).
 *   5. Clean up on client disconnect or SIGINT/SIGTERM.
 *
 * stdout rule: stdout is reserved for JSON-RPC. Every diagnostic/log goes to
 * stderr via console.error. A single stray console.log would corrupt the
 * protocol framing.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { INSTRUCTIONS } from './instructions.js';
import config from './config.js';
import { registerAllTools } from './tools/index.js';

// Read the package version at startup for the server info block.
// We import the JSON statically so tsx resolves it without a filesystem read.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const pkg: { version: string } = require('../package.json') as { version: string };

async function main(): Promise<void> {
  // ── 1. Create the MCP server ─────────────────────────────────────────────
  const server = new McpServer(
    {
      name: '@devdigest/mcp',
      version: pkg.version,
    },
    {
      capabilities: {
        tools: { listChanged: true },
      },
      instructions: INSTRUCTIONS,
    },
  );

  // ── 2. Register all 5 tools ───────────────────────────────────────────────
  registerAllTools(server);

  // ── 3. Wire stdio transport ───────────────────────────────────────────────
  const transport = new StdioServerTransport();

  // ── 4. Clean shutdown on client disconnect ────────────────────────────────
  // StdioServerTransport fires onclose when stdin closes (client gone).
  transport.onclose = () => {
    // Graceful: close then exit. server.close() unregisters handlers.
    server.close().finally(() => process.exit(0));
  };

  // ── 5. OS signals ─────────────────────────────────────────────────────────
  // Allow the process to shut down cleanly when the shell sends Ctrl-C or
  // when a process manager (Docker, launchctl, …) sends SIGTERM.
  const shutdown = (): void => {
    server.close().finally(() => process.exit(0));
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  // ── 6. Connect ────────────────────────────────────────────────────────────
  await server.connect(transport);

  // Diagnostic only — always to stderr, never stdout.
  console.error(
    `devdigest-mcp ready on stdio (API: ${config.apiUrl})`,
  );
}

main().catch((err: unknown) => {
  // Fatal startup error — surface to stderr and exit non-zero.
  console.error('[devdigest-mcp] fatal startup error:', err);
  process.exit(1);
});
