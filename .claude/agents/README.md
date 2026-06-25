# DevDigest agents (`.claude/agents/`)

Project-scoped [Claude Code subagents](https://code.claude.com/docs/en/sub-agents).
Each `*.md` file is one agent: YAML frontmatter (identity, tools, model, color,
preloaded skills) + an English Markdown body that is the agent's system prompt.
Claude Code discovers them automatically when you work in this repo; invoke with
`@<name>` or let the main session delegate by matching the `description`.

Together, `planner` and `implementer` close a disciplined **Plan → Implement**
loop, with `researcher` available to either as a read-only lookup helper.

```
researcher ──(read-only lookups, on demand)──┐
                                             ▼
planner  →  docs/plans/<feature>.md  →  N × implementer (parallel, shared tree)
  (opus, read-only on code)                 (sonnet, write code + green tests)
                                             ▼
                            orchestrator runs pr-self-review once on the whole diff
```

## At a glance

| Agent | Role | Model | Writes code? | Skills preloaded | Parallel |
|---|---|---|---|---|---|
| `researcher` | Read-only lookup (codebase **or** web), strict structured report | `sonnet` | No | — | — |
| `planner` | Turns a request into a structured Development Plan (`docs/plans/<feature>.md`) | `opus` | No (only the plan file) | all 12 | — |
| `implementer` | Builds **one** task of a plan; greens the existing tests | `sonnet` | Yes (its task's Owned paths) | all 12 | Yes (file-scoped, shared tree) |
| `test-writer` | Writes client RTL/Vitest tests and server Fastify/Drizzle tests; returns new test files + coverage summary | `sonnet` | Yes (test files only) | `react-testing-library`, `typescript-expert`, `fastify-best-practices`, `drizzle-orm-patterns`, `onion-architecture` | — |
| `architecture-reviewer` | Macro-level architecture review (layering, dependency direction, module boundaries); returns structured findings + verdict | `opus` | No | `onion-architecture`, `frontend-architecture`, `typescript-expert` | — |

"All 12" = `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`,
`postgresql-table-design`, `zod`, `security`, `frontend-architecture`,
`react-best-practices`, `next-best-practices`, `react-testing-library`,
`typescript-expert`, `engineering-insights` (see `.claude/skills/`).

---

## `researcher`

Read-only research agent with two modes — **Project** (codebase: `Grep`/`Glob`/
`Read`/read-only `Bash`, every finding carries a `path:line`) and **Internet**
(`WebSearch` → `WebFetch`, every claim carries a source URL). It interviews for
clarification when a request is ambiguous, never fabricates, always states a
confidence level, and never mutates anything. It is the **house-style template**
the other two agents follow: frontmatter + numbered sections + a fixed output
template, replies in Ukrainian.

**Based on:** the read-only "research/lookup" subagent pattern (isolate verbose,
exploratory work in a separate context that returns only a structured summary).
No external source — this is the repo's original agent and our style baseline.

## `planner`

A read-only architect. It reads the codebase, can delegate heavy discovery to
`researcher`/`Explore` via the `Agent` tool, and emits a **Development Plan** to
`docs/plans/<feature>.md` — its single permitted write. The plan carries
requirement IDs, disjoint **Owned paths** per task, per-task skills (assigned
from `.claude/skills/pr-self-review/routing.md`), a dependency **DAG**, measurable
acceptance criteria, red flags, and a per-task verify command. It never edits
product code.

**Based on:**
- **Phase separation / read-only planner** — the Explore → Plan → Implement split,
  where planning is its own read-only step before any edit. (Claude Code
  sub-agents docs; Anthropic multi-agent engineering write-up.)
- **Model tiers (Opus for planning)** — heavier reasoning for decomposition.
  (Anthropic multi-agent system; community `wshobson/agents`.)
- **Handoff via a written artifact** — a plan file the implementers (and the final
  review) read and check against, instead of passing prose. (Claude Code best
  practices.)
- **Decomposition discipline** — every requirement maps to a task, dependencies
  form a DAG, acceptance criteria are measurable. (Planning-agent guidance.)
- **Offload research to a fresh context** — delegate lookups so the planner's own
  context stays clean (mirrors the built-in Plan/Explore agents). (Sub-agents docs.)

## `implementer`

A coding agent that executes **one** task of a plan. It runs in the **same branch
and working tree it was launched in** (no worktree isolation), as one of several
parallel instances — collisions are prevented purely by the planner giving each
task a **disjoint** set of Owned paths. All implementation skills are **preloaded
via frontmatter**, so the relevant guidance is always in context (no chance of a
conditionally-invoked skill being silently skipped). It honors the repo's house
conventions, then **runs the touched package's existing tests + typecheck to
green**. It self-reviews only the code it wrote; the full-diff review is left to
`pr-self-review`.

**Based on:**
- **Parallel coding instances + Owned paths** — disjoint file ownership and a
  forbidden-files list (lockfiles, migrations, root configs, others' contracts)
  to keep concurrent edits conflict-free. (Parallel-agents guidance.)
- **Skill injection via `skills:` frontmatter** — preloading a skill injects its
  full body at start: reliable and unconditional, unlike a conditional Skill-tool
  call that "may silently skip." (Claude Code skills docs.)
- **Model tiers (Sonnet for implementation)** — focused execution on the cheaper
  tier. (Anthropic multi-agent system; community `wshobson/agents`.)
- **Self-verify to a green command** — a concrete done-condition (existing tests +
  typecheck) the agent runs until it passes. (Claude Code best practices.)
- **Fresh context for review** — review is not embedded in the implementer; it
  runs once over the whole diff via `pr-self-review`. (Claude Code best practices.)

## `test-writer`

A write-capable coding agent focused exclusively on authoring tests. It covers both
surfaces of the DevDigest monorepo: **client** (Next.js / React, RTL + Vitest +
jsdom, tests colocated next to the component as `*.test.tsx`) and **server**
(Fastify + Drizzle / Postgres, hermetic unit tests as `*.test.ts` and DB-backed
integration tests as `*.it.test.ts` via testcontainers). It plans scenarios before
writing (happy / edge / error paths with a mutation mindset), follows the Testing
Trophy ordering (integration > unit > e2e), and never mocks the DB — it uses a real
testcontainers Postgres for integration tests and port fakes from
`server/src/adapters/mocks.ts` for unit tests. It writes only test files and minimal
fixtures; it never edits product code to make a test pass.

**Based on:**
- https://arxiv.org/html/2602.00409v1
- https://keelcode.dev/blog/ai-tests-safety-illusion
- https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications
- https://kentcdodds.com/blog/write-tests
- https://kentcdodds.com/blog/testing-implementation-details
- https://martinfowler.com/articles/practical-test-pyramid.html
- https://testing-library.com/docs/queries/about
- https://kentcdodds.com/blog/common-mistakes-with-react-testing-library
- https://claritydev.net/blog/improving-react-testing-library-tests
- https://fastify.dev/docs/latest/Guides/Testing
- https://docker.com/blog/testcontainers-best-practices
- https://dominik.info/blog/mocking-the-database
- https://nikolamilovic.com/posts/integration-testing-node-postgres-vitest-testcontainers
- https://arxiv.org/abs/2506.02943
- https://arxiv.org/abs/2602.07900
- https://qawolf.com/blog/how-to-write-an-effective-test-coverage-plan
- https://code.claude.com/docs/en/sub-agents

## `architecture-reviewer`

A read-only structural analysis agent for the DevDigest repository. Its mandate is
**macro-level** review: layering, dependency direction, module boundaries, coupling,
and cohesion. It detects architectural smells — Dependency-Rule violations, driven
ports leaking infrastructure, fat controllers, anemic domains, circular dependencies,
god modules, scattered responsibilities, and framework classes in the domain — and
explains why each matters and what the fix direction is. It never writes or edits
files. It complements `pr-self-review` (line-level quality) rather than replacing
it: line-level nits are delegated to `pr-self-review`, while structural violations
are reported here with a binary APPROVE / REQUEST CHANGES verdict. The
`onion-architecture` and `frontend-architecture` preloaded skills supply the
concrete ring/layer vocabulary for this repo.

**Based on:**
- tech-stack.com/blog/the-architecture-review-process
- medium.com/netvise-software/software-architecture-and-code-review-882d779decf
- https://arxiv.org/abs/2303.18058
- blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
- martinfowler.com/bliki/AnemicDomainModel.html
- journal.optivem.com
- https://arxiv.org/abs/2605.07001
- https://arxiv.org/abs/2406.17354
- blog.cloudflare.com/ai-code-review
- c4model.com
- github.com/LukasNiessen/ArchUnitTS
- code.claude.com/docs/en/sub-agents

---

## Shared design principles → sources

| Principle | Where it shows up | Source |
|---|---|---|
| `description` is a router ("Use proactively when… Returns…"), not a job title | all three descriptions | Sub-agents docs |
| Phases separated; planner read-only, implementer does the writing | `planner` vs `implementer` | Best practices; multi-agent blog |
| Model tiers: Opus plans, Sonnet implements | `model:` fields | Multi-agent blog; `wshobson/agents` |
| Handoff via a written plan artifact (`docs/plans/<feature>.md`) | `planner` output | Best practices |
| Preload always-needed skills in `skills:`; full body injected at start | both `planner`/`implementer` | Skills docs |
| Mandatory, non-skippable skill coverage for the implementer | `implementer` preloads all 12 | Skills docs (avoids conditional-call skip) |
| File-scoped parallelism via disjoint Owned paths + forbidden files | `planner` tasks, `implementer` §1 | Parallel-agents guidance |
| Self-verify with an exact command run to green | `implementer` §4 | Best practices |
| Measurable acceptance criteria; dependencies as a DAG; requirement→task | `planner` plan template | Planning-agent guidance |
| Review in a fresh context, once over the whole diff | `pr-self-review` (orchestrator) | Best practices |
| Planner offloads heavy research to a separate context | `planner` `Agent` tool | Sub-agents docs |

## Sources

Official (Anthropic / Claude Code):
- Create custom subagents — https://code.claude.com/docs/en/sub-agents
- Extend Claude with skills — https://code.claude.com/docs/en/skills
- Orchestrate teams of Claude Code sessions — https://code.claude.com/docs/en/agent-teams
- How we built our multi-agent research system — https://www.anthropic.com/engineering/multi-agent-research-system

Community (conventions, cross-checked against the above):
- `wshobson/agents` (model-tier convention) — https://github.com/wshobson/agents
- Build a Claude Code custom subagent (step-by-step) — https://www.digitalapplied.com/blog/build-claude-code-custom-subagent-step-by-step-2026
- Deterministic multi-agent orchestration — https://alexop.dev/posts/claude-code-workflows-deterministic-orchestration/
- Multi-agent orchestration for Claude Code — https://shipyard.build/blog/claude-code-multi-agent/

---

## Adding a new agent

1. Create `.claude/agents/<name>.md` with frontmatter (`name`, `description`,
   `tools`, `model`, `color`; optional `skills`, `isolation`, etc.) and an English
   system-prompt body — match the structure of the existing three (numbered
   sections, Hard rules, a fixed output contract).
2. Write the `description` as a router: lead with the trigger ("Use proactively
   when…") and state what it **Returns**.
3. Reference skills/conventions rather than copying them: preload always-needed
   skills via `skills:`, and point to `.claude/skills/pr-self-review/routing.md`
   for the file→skill map.
4. Add a section to this README (role, frontmatter summary, and what it's based on
   + sources if any).
