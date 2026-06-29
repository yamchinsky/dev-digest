# `mcp/` — DevDigest local MCP server

A thin **stdio MCP adapter** that exposes DevDigest review capabilities as MCP
tools over standard input/output. It calls the already-running HTTP API at
`http://localhost:3001` and wraps the results into MCP-compatible structured
output. No server internals are imported; `server/` is untouched and no new
API endpoint was added.

Package: `@devdigest/mcp` · manager: **npm** · transport: **stdio**

## The 5 tools

| Tool | Kind | What it does |
|------|------|--------------|
| `list_agents` | read-only | Lists the configured review agents (id, name, description) so the model can pick a valid agent id for `run_agent_on_pr`. |
| `run_agent_on_pr` | mutating | Runs the chosen review agent on a pull request, waits for it to finish, and returns the ready findings summary. |
| `get_findings` | read-only | Returns a concise verdict and finding-count summary for the latest completed review of a pull request, without re-running it. |
| `get_conventions` | read-only | Returns the repository's approved coding conventions (the repo-conventions feature from L02). |
| `get_blast_radius` | read-only stub | Returns the PR impact map (blast radius); not yet implemented — returns a graceful stub. |

All tools declare `openWorldHint: false`; the four read-only tools carry
`readOnlyHint: true`. `run_agent_on_pr` blocks until the review run reaches a
terminal status (`done`, `failed`, or `cancelled`), emitting
`notifications/progress` along the way.

### Typical flow

```
list_agents           → pick an agentId
run_agent_on_pr       → review runs and findings return in one call
get_findings          → revisit a completed review without re-running
get_conventions       → inspect approved coding conventions for a repo
get_blast_radius      → (stub) "not yet implemented"
```

Address a PR by `repo` (`"owner/name"`) and `prNumber` (integer ≥ 1).

## Running standalone

First bring up the full stack (API on `:3001` + Postgres):

```sh
./scripts/dev.sh
```

Then, in a separate terminal, launch the MCP server:

```sh
# Convenience wrapper (installs deps if needed, then starts)
bash scripts/mcp.sh

# Or directly
cd mcp && npm run start
```

The MCP server is **launched on demand** — `scripts/dev.sh` does not start it
and has no reference to `mcp/`.

## Registering in an MCP client

### Project `.mcp.json` (Claude Code, opt-in)

The root `.mcp.json` registers the server for Claude Code. After the repo is
open in Claude Code, run:

```sh
claude mcp list    # should show "devdigest"
```

### MCP Inspector (development / debugging)

```sh
npx @modelcontextprotocol/inspector npx -y tsx mcp/src/index.ts
```

Open the Inspector URL shown in the terminal. Confirm exactly 5 tools appear
with their annotations, input/output schemas, and the `instructions` string.

### Manual JSON-RPC on stdio

```sh
cd mcp && npm run start
# Then pipe JSON-RPC messages via stdin
```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Base URL of the running DevDigest API. |
| `DEVDIGEST_MCP_REQUEST_TIMEOUT_MS` | `10000` | Per-HTTP-request `AbortController` timeout (ms). |
| `DEVDIGEST_MCP_POLL_INTERVAL_MS` | `3000` | Interval between polling calls when waiting for a review run to complete (ms). |
| `DEVDIGEST_MCP_RUN_TIMEOUT_MS` | `120000` | Hard timeout for `run_agent_on_pr` to wait for a terminal status before returning `isError: true` (ms). |

Set these in the shell before launching, or add them to `.mcp.json` under
the server's `env` key.

## Security notes

- All tool arguments are Zod-validated before any HTTP call is made.
- Every HTTP call to the API uses an `AbortController` timeout (see
  `DEVDIGEST_MCP_REQUEST_TIMEOUT_MS`).
- All text derived from PR bodies, commit messages, or repository content
  is passed through `wrapUntrusted` before being returned to the MCP client.
- No secrets are logged to stderr (logs are routing metadata only).
- `DEVDIGEST_API_URL` is the only env var that appears in `.mcp.json` — no
  tokens, no keys.

## Internal layout

```
mcp/
├── src/
│   ├── index.ts          # composition root: McpServer + StdioServerTransport
│   ├── config.ts         # env vars with defaults
│   ├── instructions.ts   # InitializeResult.instructions text
│   ├── schemas.ts        # Zod input/output schemas for all 5 tools
│   ├── format.ts         # pure summarizers + wrapUntrusted application
│   ├── types.ts          # shared internal types
│   ├── api/
│   │   └── client.ts     # sole HTTP adapter (all fetch calls live here)
│   └── tools/
│       ├── index.ts      # collects all 5 tool definitions
│       ├── list-agents.ts
│       ├── run-agent-on-pr.ts
│       ├── get-findings.ts
│       ├── get-conventions.ts
│       └── get-blast-radius.ts
├── test/
│   ├── setup.ts          # vitest setup (mock global fetch)
│   └── *.test.ts         # hermetic unit tests (no network, no DB)
├── package.json
└── tsconfig.json
```
