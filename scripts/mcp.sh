#!/usr/bin/env bash
#
# DevDigest MCP stdio server — on-demand launcher.
#
# Usage:
#   bash scripts/mcp.sh
#   DEVDIGEST_API_URL=http://localhost:3001 bash scripts/mcp.sh
#
# Environment:
#   DEVDIGEST_API_URL   Base URL of the DevDigest API (default: http://localhost:3001)
#
# Notes:
#   • stdout is RESERVED for JSON-RPC framing. All diagnostics go to stderr.
#   • If mcp/node_modules is missing, npm ci is run first (fallback: npm install).
#   • The server must run with cwd = mcp/ so that tsx picks up mcp/tsconfig.json
#     and resolves the @devdigest/shared / @devdigest/reviewer-core path aliases.
#   • This script is NOT invoked by scripts/dev.sh; it is standalone / on-demand.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Apply default for DEVDIGEST_API_URL only if the caller has not set it.
: "${DEVDIGEST_API_URL:=http://localhost:3001}"
export DEVDIGEST_API_URL

# All output goes to stderr — stdout is owned by JSON-RPC.
log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*" >&2; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }

# Cleanup runs only on pre-exec failures; after exec the shell is gone.
cleanup() {
  :
}
trap cleanup EXIT INT TERM

# ── Install dependencies if mcp/node_modules is missing ─────────────────────
if [ ! -d "$ROOT/mcp/node_modules" ]; then
  log "mcp/node_modules not found — running npm ci"
  if (cd "$ROOT/mcp" && npm ci 2>&1 >&2); then
    log "npm ci succeeded"
  else
    warn "npm ci failed — falling back to npm install"
    (cd "$ROOT/mcp" && npm install 2>&1 >&2)
  fi
fi

# ── Launch ───────────────────────────────────────────────────────────────────
# CRITICAL: cd into mcp/ BEFORE exec so that tsx loads mcp/tsconfig.json and
# the tsconfig path aliases (@devdigest/shared, @devdigest/reviewer-core) resolve.
log "starting devdigest-mcp (API: ${DEVDIGEST_API_URL})"
cd "$ROOT/mcp"
exec npx tsx src/index.ts
