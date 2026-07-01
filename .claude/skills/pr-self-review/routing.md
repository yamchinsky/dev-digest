# pr-self-review — Bucket → skills routing

Used by `SKILL.md` Step 3 (Classify files into buckets) and Step 5 (Dispatch
parallel Explore subagents). One file may fall into multiple buckets
(`security` and `zod` are cross-cutting). Empty buckets are skipped.

| Bucket | Path pattern | Skills to consult |
|---|---|---|
| **UI components / pages** | `client/src/**/*.tsx`, `client/src/app/**/*.ts` | `react-best-practices`, `next-best-practices`, `frontend-architecture`, `security`, `typescript-expert` |
| **UI logic / hooks / lib** | `client/src/lib/**/*.ts`, `client/src/_components/**/*.ts` (non-`.tsx`) | `react-best-practices`, `frontend-architecture`, `typescript-expert`, `zod` |
| **UI tests** | `client/**/*.test.tsx`, `client/**/*.test.ts` | `react-testing-library`, `react-best-practices` |
| **Backend modules / routes / services** | `server/src/modules/**/*.ts` (except `repository.ts`), `server/src/platform/**/*.ts`, `server/src/app.ts` | `onion-architecture`, `fastify-best-practices`, `zod`, `security`, `typescript-expert` |
| **Backend repositories / DB layer** | `server/src/db/**/*.ts`, `server/src/**/repository.ts` | `drizzle-orm-patterns`, `onion-architecture`, `postgresql-table-design` (only when `db/schema/`), `security` |
| **Backend integration tests** | `server/**/*.it.test.ts` | `drizzle-orm-patterns`, plus the `*.it.test.ts` filename convention from `../TESTING.md` |
| **Backend unit tests** | `server/**/*.test.ts` (non-`.it.`) | hermetic-only convention check (`src/adapters/mocks.ts`, no real network/keys) |
| **Review engine** | `reviewer-core/src/**/*.ts` | `onion-architecture` (pure engine, **no I/O**, no `process.env`), `typescript-expert`, `claude-api` (only when LLM provider touched) |
| **Shared contracts** | `server/src/vendor/shared/**/*.ts`, `client/src/vendor/shared/**/*.ts` (dual-vendored mirror) | `zod` + cross-bucket fixture-parity check |
| **E2E flows** | `e2e/**/*.flow.json`, `e2e/**/*.ts` | conventions from `e2e/CLAUDE.md` — JSON-only specs, deterministic locators (no `chat`), read-only seeded fixtures |
| **MCP adapter** | `mcp/src/**/*.ts` | `typescript-expert`, `zod`, `security`, plus conventions from `mcp/AGENTS.md` — outbound-adapter boundary (no server internals), stdout = JSON-RPC only, `wrapUntrusted` on third-party text |
| **DB schema / migrations** | `server/src/db/schema/**`, `server/src/db/migrations/**` | `drizzle-orm-patterns`, `postgresql-table-design`, paired-migration check |
| **Settings / CI** | `.claude/**`, `.github/workflows/**`, `*/package.json` | structural JSON/YAML check; LOW-severity only |
| **Docs / specs** | `*.md`, `specs/**` | skip; report `bucket: "docs", skipped: true` |
