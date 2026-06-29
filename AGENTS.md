
# AGENTS.md — root pointer map

This file is a **thin index**, not documentation. Module-specific conventions
live in `<module>/AGENTS.md` (lazy-loaded by location); architectural and
operational knowledge lives in the READMEs and `docs/` listed below.

Follow the explicit `Read when…` instructions — they are directives, not
suggestions.

## What this repo is

DevDigest — local-first AI pull-request review. Five standalone packages
(no monorepo workspace, no shared lockfile; cross-package code via tsconfig
path aliases only):

| Folder           | Package                     | Role                                          | Port      |
|------------------|-----------------------------|-----------------------------------------------|-----------|
| `server/`        | `@devdigest/api`            | Fastify 5 + Drizzle/Postgres (pgvector)       | 3001      |
| `client/`        | `@devdigest/web`            | Next.js 15 studio                             | 3000      |
| `reviewer-core/` | `@devdigest/reviewer-core`  | Pure review engine (diff → prompt → LLM)      | —         |
| `e2e/`           | `@devdigest/e2e`            | Deterministic browser flows (agent-browser)   | —         |
| `mcp/`           | `@devdigest/mcp`            | Local stdio MCP adapter over the API          | — (stdio) |

Shared Zod contracts: `server/src/vendor/shared` (`@devdigest/shared`).

## Read-when map

**Read `README.md`** when you need the high-level architecture, what works on
day 1, the lesson roadmap (L01–L08), or `./scripts/dev.sh` boot semantics.

**Read `server/README.md`** when you touch anything under `server/src/` —
plugin/module/DI ordering, the API map by domain, env vars (`DATABASE_URL`,
`REPO_INTEL_ENABLED`, `EMBEDDINGS_ENABLED`, …), where secrets live
(`~/.devdigest/secrets.json`, mode `0600`), and the three non-obvious review
context rules (Repo Intel default-on, the shared `INJECTION_GUARD`, mandatory
grounding).

**Read `client/README.md`** when you touch anything under `client/src/` — the
App Router page map, TanStack Query hook layout (`src/lib/hooks/*` →
`src/lib/api.ts`), and the `g`-then-key shortcut chrome.

**Read `reviewer-core/README.md`** when you touch the review engine — the
`assemblePrompt → wrapUntrusted → LLM → structured → groundFindings` pipeline,
its public exports, and the optional prompt slots fed by later lessons
(`skills`, `memory`, `specs`, `callers`).

**Read `TESTING.md`** before adding **any** test, and before reasoning about
CI failures. It defines the per-package suite split, the **`*.it.test.ts`
filename convention** (DB-backed via testcontainers vs. hermetic), and why
`server/package.json` is `skip-worktree` (CI invokes `pnpm exec vitest run …`
directly, not committed `test:unit` / `test:integration` scripts).

**Read `e2e/README.md`** before changing browser flows or `e2e/specs/*.flow.json`.

**Read `docs/agent-prompts/`** when editing built-in reviewer prompts
(`general-reviewer.md`, `security-reviewer.md`, `performance-reviewer.md`) or
model defaults (`choosing-a-model.md`).

**Read `docs/`** when a topic doesn't fit in a single module — currently the
only sub-folder is `docs/agent-prompts/` (above); cross-module deep dives
land here as they get written.

**Read `specs/`** when you touch a contract or fixture shared across
packages. Module-owned specs live under `<module>/specs/`.

**Read `INSIGHTS.md`** before solving a non-obvious bug or making a "looks
obvious" decision — durable, repo-wide surprises that already bit us once.
Module-level surprises live in `<module>/INSIGHTS.md`.

## Non-obvious globals (don't re-derive)

These bite across modules; surfacing them here avoids repeated grep:

- **No workspace.** `server/`, `client/`, `reviewer-core/`, `e2e/`, `mcp/`
  each have their own `package.json` and lockfile. **Package managers differ**:
  `server/` and `client/` use **pnpm**; `reviewer-core/`, `e2e/`, and `mcp/`
  use **npm**. Don't `pnpm install` inside `reviewer-core/` or `mcp/`.
- **Cross-package imports go through tsconfig path aliases**, e.g. the server
  consumes `@devdigest/reviewer-core` → `../reviewer-core/src` as TypeScript
  source. Nothing is published; nothing emits JS for cross-package consumption.
- **Migrations are NOT applied on boot.** Run `cd server && pnpm db:migrate`
  manually after first clone (or after a schema change).
- **`server/package.json` is `git update-index --skip-worktree`.** A local
  variant diverges from the committed file; CI works around it by calling
  `pnpm exec vitest run …` directly. Don't try to "fix" this by committing
  local changes to `server/package.json` unless you know what you're doing.
- **Postgres is the only Dockerized piece.** API and web run on the host via
  `pnpm dev`. `docker compose down -v` wipes the DB volume.

## Session context

Before solving anything non-obvious, scan the relevant `INSIGHTS.md` files
(root + the module you're touching). Treat their contents as high-confidence
guidance unless evidence in the current code contradicts them — if it does,
update the entry, do not silently ignore it.

When you uncover a non-obvious finding mid-session, the
`engineering-insights` skill self-discovers and appends it to the correct
`INSIGHTS.md`. Do not skip it.

## Per-module conventions

Lazy-loaded automatically when you work in that directory:

- `server/AGENTS.md` — module shape, validation/error/DI conventions, ESM `.js` imports, embeddings gate, `*.it.test.ts` split, boot reaper.
- `client/AGENTS.md` — TanStack Query as the only fetch path, global error/toast policy, `_components/<Name>/` colocation, vendored UI/contracts, theme + hydration quirks.
- `reviewer-core/AGENTS.md` — pure engine (no I/O), `src/index.ts` as the public surface, grounding gate, structural INJECTION_GUARD, npm-not-pnpm, build = typecheck.
- `e2e/AGENTS.md` — JSON-only specs, deterministic locators (no `chat`), hermetic runner, "never `down -v`", read-only seeded fixtures, agent-browser is the framework.
- `mcp/AGENTS.md` — outbound-adapter boundary (no server internals), stdout = JSON-RPC only, `wrapUntrusted` rule, npm-not-pnpm, build = typecheck, internal layering.

Per-module surprises accumulate in `<module>/INSIGHTS.md` via the
`engineering-insights` skill (see *Session context* above).

## Project-local skills (`.claude/skills/`)

Auto-load by trigger description; nothing to invoke manually.

- `onion-architecture` — backend layering for `server/` + `reviewer-core/`: the `routes.ts` / `service.ts` / `repository.ts` triple, port placement in `@devdigest/shared`, `reviewer-core` purity invariants. Fires on backend edits, "where does this go" questions, and PR review of backend changes.
- `frontend-architecture` — folder structure and code organization for `client/` (React + Next.js App Router).
- `engineering-insights` — appends non-obvious findings to the right `INSIGHTS.md` (see *Session context* above).
- `pr-self-review` — local pre-PR gate; runs the current diff through relevant skills and blocks `gh pr create` / `git push` on at least one CRITICAL finding.
- `plan-verifier` — requirement-coverage checker; fires on "verify the plan", "did we cover all requirements", "requirement coverage", "check plan against code". Maps every R-ID + acceptance criterion in a `docs/plans/<feature>.md` to concrete evidence and emits a coverage matrix.
- `doc-writer` — documentation authoring skill; fires on "write docs for", "document this feature", "turn this plan into docs", "add a diagram", "where should this doc go". Selects the correct Diátaxis type, places the doc in the right repo location, and embeds Mermaid diagrams with captions.
