# AGENTS.md — `mcp/` conventions

Module-scoped rules for `@devdigest/mcp` — the local stdio MCP adapter that
calls the DevDigest HTTP API. **The 5-tool surface, run instructions, env
vars, and client registration live in `README.md`** — this file holds the
"how we write adapter code here" conventions.

## Read when…

**Read `README.md`** before reasoning about the tool surface, the env knobs,
or how to register the server in Claude Code / MCP Inspector.

**Read `INSIGHTS.md`** before solving a non-obvious bug — durable, surprising
lessons that bit this module.

**Read `../TESTING.md`** before adding **any** test in this package.

**Read `../AGENTS.md`** for repo-wide globals (no workspace, mixed
pnpm/npm, …) that apply here too.

**Read `src/api/client.ts`** before adding a new HTTP call to the API —
`client.ts` is the sole place network I/O lives; all resolvers and fetch
helpers belong there.

## Outbound-adapter boundary (non-negotiable)

`mcp/` is an **outbound HTTP client** of the DevDigest API, not a plugin of
the server. It sits outside the `server/` onion entirely. Consequently:

- **Never import from `server/src/**`** — no routes, no services, no
  repositories, no Drizzle, no `Container`, no `db/` schema, no Fastify.
- **Never import `drizzle-orm`, `postgres`, `fastify`, or `@octokit/*`** in
  this package.
- The only cross-package imports allowed are:
  - `@devdigest/shared` — DTO types and Zod contracts (via tsconfig path alias
    to `../server/src/vendor/shared`).
  - `@devdigest/reviewer-core/prompt.js` — the `wrapUntrusted` export only
    (subpath import avoids pulling the `openai` SDK at runtime).

This boundary is what lets the MCP layer remain lightweight, deployable
independently, and testable without a DB.

## The server is untouched

No API endpoint was added for the MCP layer. Every call goes through existing
`/agents`, `/repos`, `/pulls`, `/reviews`, `/conventions` endpoints. If a
future tool needs data the API doesn't expose, the **server** gets a new
endpoint first — the MCP layer never works around a missing endpoint by
reading the DB directly.

## stdout = JSON-RPC only

The `@modelcontextprotocol/sdk` `StdioServerTransport` writes all MCP
protocol frames to **stdout**. A single stray `console.log(...)` corrupts
the JSON-RPC framing and breaks the client. Rule: **all diagnostic output goes
to stderr** (`console.error(...)`). Never call `console.log` in this package.

## `wrapUntrusted` on all PR/repo-derived text

Any text that originates from a pull request body, commit message, file path,
repository description, or finding rationale must pass through `wrapUntrusted`
before it is returned in a tool response. `format.ts` is the single place
`wrapUntrusted` is applied — summarizers call it there, tools call
`format.ts`, nothing else calls `wrapUntrusted` directly.

Import as:

```ts
import { wrapUntrusted } from '@devdigest/reviewer-core/prompt.js';
```

The `.js` suffix is required for ESM resolution in this package (see below).

## Package manager: npm (not pnpm)

This package uses **npm** and commits `package-lock.json`. Don't `pnpm install`
here — that creates a divergent lock file. The repo-wide note in
`../AGENTS.md` also applies.

## Build is a typecheck — no JS emit

`npm run typecheck` (and `npm run build`) runs `tsc --noEmit`. Consumers
launch the package via `tsx` over the TypeScript source directly. Don't add a
`dist/` emit step.

## ESM `.js` suffix on relative imports

The package is `"type": "module"`. All relative internal imports must use the
`.js` extension even though the source files are `.ts`:

```ts
import { apiClient } from './api/client.js';  // correct
import { apiClient } from './api/client';      // wrong — breaks tsx ESM
```

Cross-package imports (`@devdigest/shared`, `@devdigest/reviewer-core/*`) use
the alias name with no extension — that is resolved by tsconfig paths.

## Internal layering

The package follows the same onion-clean layering as the rest of the repo:

| Layer | Path | What it does |
|-------|------|--------------|
| Composition root | `src/index.ts` | Bootstraps `McpServer`, registers tools, connects `StdioServerTransport`, handles shutdown on stdin close. |
| Use cases (tools) | `src/tools/*.ts` | One file per tool: validate input → call client → summarize → return structured output. |
| Infrastructure adapter | `src/api/client.ts` | Sole HTTP caller. `request()` with `AbortController` timeout + `ApiErrorBody` normalization. All endpoint helpers live here. |
| Pure core | `src/schemas.ts`, `src/format.ts`, `src/config.ts`, `src/instructions.ts` | Zod schemas, summarizers + `wrapUntrusted` application, env vars, instructions string. No I/O. |

Tools import from `format.ts` and `api/client.ts`; they do not import each
other. `index.ts` imports from `tools/index.ts` only.

## Error discipline

- Execution errors return `{ content, isError: true }` with an actionable
  message — never throw a protocol-level error from a tool handler.
- `get_blast_radius` returns `{ implemented: false, message }` with
  `isError: false` — it is not an error, it is a documented stub.
- Unknown repo or PR → `isError: true` with a message telling the caller
  which repos / PRs exist (so the next call can succeed without guessing).

## Tests: hermetic vitest (no `.it.` tier)

Tests live in `mcp/test/*.test.ts` and use vitest with a mocked global
`fetch` (set up in `test/setup.ts`). No Docker, no real network, no DB.
All files end in `.test.ts` — there is no `.it.test.ts` integration tier for
this package. Run with `npm test`.

## How to grow this file

- **New convention?** → add a section here.
- **One-off surprise / "looked obvious and wasn't"?** → append an entry to
  `INSIGHTS.md`.
- **Topic outgrowing this file?** → promote to `docs/<topic>.md` and link it
  from the `Read … when …` block above.
