# INSIGHTS — `mcp/`

Durable, surprising lessons that bite this module — things that *looked
obvious and weren't*. Append-only. New entries are added by the
`engineering-insights` skill. Read this file before solving a non-obvious
bug or making a "looks obvious" decision in `mcp/`.

## What Works
_None yet._

## What Doesn't Work
### Inlining `tsx src/index.ts` in `.mcp.json` breaks @devdigest path-alias resolution
_2026-06-30_ · `.mcp.json`, `scripts/mcp.sh`

The committed project `.mcp.json` must launch via a **relative** path to `scripts/mcp.sh` — Claude Code spawns project-scoped MCP servers with cwd = repo root, so an absolute path (`/Users/.../scripts/mcp.sh`) only works on the author's machine. Do NOT "simplify" the launcher to a bare `tsx src/index.ts`: tsx must run with cwd = `mcp/` to load `mcp/tsconfig.json` and resolve the `@devdigest/shared` and `@devdigest/reviewer-core` path aliases, so the script's `cd "$ROOT/mcp"` before `exec` is load-bearing (as is its on-demand `npm ci`/`npm install`). Keep the script; only make the path in `.mcp.json` relative.

## Codebase Patterns
_None yet._

## Tool & Library Notes
### MCP SDK's ZodRawShapeCompat rejects schemas built with the tsconfig path-alias'd `zod`
_2026-06-28_ · `mcp/src/tools/list-agents.ts`

The tsconfig alias `"zod": ["./node_modules/zod"]` causes TypeScript to resolve `import { z } from 'zod'` through the package.json `"types"` condition, which points at `./index.d.cts` (CJS declarations). The SDK's `zod-compat.d.ts` imports `from 'zod/v3'` which resolves (via the `"zod/*"` alias) to `./node_modules/zod/v3/index.d.ts` (ESM declarations). Both re-export the same runtime code but TypeScript treats them as separate module instances, making `ZodRawShapeCompat = Record<string, z3.ZodTypeAny>` structurally incompatible with our schema shapes. Fix: cast each schema shape with `as unknown as Record<string, any>` when passing to `server.registerTool()`, and use `args: unknown` (valid by contravariance) in the callback, casting to the concrete arg type inside the body where the SDK has already validated the input.

## Recurring Errors & Fixes
_None yet._

## Session Notes
_None yet._

## Open Questions
_None yet._
