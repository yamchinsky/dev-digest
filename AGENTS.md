
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
packages, or a cross-module SDD feature spec (`SPEC-NN-*.md`, written by the
`spec-creator` agent). Module-owned specs live under `<module>/specs/`.

**Read `INSIGHTS.md`** before solving a non-obvious bug or making a "looks
obvious" decision — durable, repo-wide surprises that already bit us once.
Module-level surprises live in `<module>/INSIGHTS.md`.

**Run the matching eval before committing** when you edit any file under
`.claude/skills/`, `.claude/agents/`, or this `CLAUDE.md`. Skills and agent
definitions are probabilistic components — a text edit can silently break
behaviour without a type error or unit-test failure. See *Eval harness* below
for the change → command table.

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
- `pr-self-review` — local pre-PR gate; runs the current diff through relevant skills and blocks `gh pr create` on at least one CRITICAL finding (plain `git push` flows freely — the gate fires at PR-open time only).
- `impl` — SDD execution orchestrator; fires on "/impl", "імплементуй план", "run the plan", "виконай план". Executes a `docs/plans/<feature>.md` end-to-end in the main session: feature branch → implementer waves per the task DAG → plan-verifier coverage gate (first, via the `plan-verifier` agent) → architecture-reviewer + arch-fix loop (≤3 iterations, to APPROVE) → spec status flip → `gh pr create` (the pr-self-review hook fires there). Specs (`spec-creator`) and plans (`implementation-planner`) are authored manually upstream; the `test-writer` agent is currently disabled — test intents land in the run's manual checklist.
- `workflow-retro` — manual retrospective of a multi-agent run; fires on "workflow retro", "ретро прогону", "/workflow-retro". Deep mode reads subagent journals from disk (parent usage undercounts them), emits token/tool/duration/parallelism metrics + concrete recommendations, appends a trend row to `docs/retros/ledger.md`. Never hook-fired.
- `spec-creator`, `plan-verifier`, and `doc-writer` are **agents** (`.claude/agents/*.md`), not skills — one name, one home. `spec-creator`: SDD feature-spec author upstream of `implementation-planner`; grounds via devdigest-mcp, interviews via stop-and-return rounds, writes `SPEC-NN-*.md` only into `specs/` folders. `plan-verifier`: requirement-coverage matrix for a `docs/plans/<feature>.md` (spawned by `/impl` for its coverage gate, or directly via "verify the plan"). `doc-writer`: Diátaxis-typed docs with Mermaid diagrams; writes are docs-only.

## Eval harness (`evals/`)

Quality evals (`evals/`) verify that skill and agent definitions produce the
expected output. They catch silent regressions — a text edit that breaks
behaviour without type errors or unit-test failures. All commands run from the
`evals/` directory.

**Change → eval command (run before committing):**

| Changed path | Command |
|---|---|
| `.claude/skills/dependency-checker/**` | `pnpm vitest run skills/dependency-checker` |
| `.claude/skills/zod/**` | `pnpm vitest run skills/zod` |
| `.claude/agents/architecture-reviewer.md` | `pnpm vitest run agents/architecture-reviewer` |
| `.claude/agents/architecture-reviewer-lite.md` | `pnpm vitest run agents/architecture-reviewer-lite` |
| Any skill with a cases file | `pnpm eval:skills` |
| Any agent with a cases file | `pnpm eval:agents` |
| Full suite | `pnpm eval` |

**Check eval coverage:** `pnpm eval:quality <skill-name>` warns when a skill
has no matching `evals/skills/<name>/` directory.

**Rule: new skill or agent → eval cases in the same commit.** An unprotected
skill has no regression detector. Write at least one `*.cases.ts` alongside
any new `SKILL.md` or agent `.md`.

**CI runs the three eval tiers as three separate workflows** (not one file):
`.github/workflows/eval-quality.yml` (the zero-token static gate — the
BLOCKING one), `eval-content.yml` (skills + agents, LLM judge), and
`eval-workflow.yml` (systemic trace). LLM tiers stay non-required until
pass-rate history exists; only `eval-quality` is safe as a required check.

## Product eval pipeline — `pnpm verify:l06`

The L06 homework gate (agent Eval Pipeline + the Skill Editor benchmark) has a
one-command verifier: **`pnpm verify:l06`** (root) → `scripts/verify-l06.sh`.
It runs server + client typecheck, the reviewer-core build, the code-only
scoring unit tests (`eval/scoring.test.ts`, `skill-eval/scoring.test.ts`), the
server eval `*.it.test.ts` (self-skip without Docker), and the client eval
component tests. CI mirrors it in `.github/workflows/verify-l06.yml`.

**Run `pnpm verify:l06` before committing** any change under `server/src/**`,
`client/src/**`, or `reviewer-core/src/**` that touches the eval pipeline
(eval cases/runs, scoring, the agent Evals tab, the Skill Editor Evals
benchmark, the Eval Dashboard).

**Why the script lives in the ROOT `package.json`, not `server/`:** it spans
three packages (server + client + reviewer-core) and, more to the point,
`server/package.json` is `git update-index --skip-worktree` (see *Non-obvious
globals* above) — a committed change there diverges from the template and CI
sidesteps it entirely. `verify:l06` follows the shell-only `verify:l03`
precedent: root script, no per-package `package.json` edit.
