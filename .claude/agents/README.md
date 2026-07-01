# DevDigest agents (`.claude/agents/`)

Project-scoped [Claude Code subagents](https://code.claude.com/docs/en/sub-agents).
Each `*.md` file is one agent: YAML frontmatter (identity, tools, model, color,
preloaded skills) + an English Markdown body that is the agent's system prompt.
Claude Code discovers them automatically when you work in this repo; invoke with
`@<name>` or let the main session delegate by matching the `description`.

Together, `implementation-planner` and `implementer` close a disciplined
**Plan → Implement** loop, with `researcher` available to either as a read-only
lookup helper. The execution half of the SDD pipeline is run end-to-end by
the `impl` skill (`.claude/skills/impl/`, `/impl`) in the main session — it
owns branch setup, wave scheduling, the verify/review tail, and the PR gate.
`spec-creator` and `implementation-planner` are invoked **manually**,
upstream of `/impl`.

```
spec-creator (agent, manual — stop-and-return interview, devdigest-mcp
  grounding)  →  SPEC-NN (EARS ACs, Status: approved)
        ▼
implementation-planner (sonnet, manual invocation, read-only on code; caller
  states the execution mode up front; researcher ── lookups on demand)
        ▼
docs/plans/<feature>.md   (R-IDs trace to spec ACs via `Covers AC`)
        ▼
/impl (skill, main session):
  feature branch → N × implementer waves per DAG (sonnet, cap 3, shared tree)
                   │ or one single-agent pass (sequential steps)
  → plan-verifier (coverage FIRST, sonnet subagent; test evidence = DEFERRED)
  → gap-fix loop (≤2 iterations)
  → architecture-reviewer (sonnet) → arch-fix loop (≤3, to APPROVE)
  → test intents + DEFERRED rows → manual checklist  [test-writer DISABLED]
  → insight candidates aggregated once → spec Status: implemented
  → gh pr create  (PreToolUse hook fires pr-self-review on the whole diff)
```

## At a glance

| Agent | Role | Model | Writes code? | Skills preloaded | Parallel |
|---|---|---|---|---|---|
| `researcher` | Read-only lookup (codebase **or** web), strict structured report | `sonnet` | No | — | — |
| `spec-creator` | Writes the SDD feature spec (EARS ACs) BEFORE planning; grounds facts via devdigest-mcp tools; interviews via stop-and-return rounds across 6 dialogue categories | `sonnet` | Yes (only `SPEC-NN-*.md` + the specs-folder README index line) | — (reads `.claude/references/spec-creator/{template,ears}.md`) | — |
| `implementation-planner` | Validates given requirements (asks clarifying questions, recommends improvements; the caller states multi-agent vs single-agent up front — the gate is a fallback), then writes an Implementation Plan (`docs/plans/<feature>.md`) | `sonnet` | No (only the plan file) | — (on-demand via `Skill`: `postgresql-table-design` for new schema, `onion-architecture`/`frontend-architecture` for novel placement) | — |
| `implementer` | Builds **one** task of a plan; greens the existing tests | `sonnet` | Yes (its task's Owned paths) | `typescript-expert`, `security` core; loads its task's `Skills (mandatory)` list via `Skill` at start | Yes (file-scoped, shared tree) |
| `test-writer` | **DISABLED** (token economy; file is `test-writer.md.disabled` — rename back to `.md` to re-enable). Writes client RTL/Vitest tests and server Fastify/Drizzle tests against the plan's `## Test intents` + spec hints | `sonnet` | Yes (test files only) | `react-testing-library`, `typescript-expert`, `fastify-best-practices`, `drizzle-orm-patterns`, `onion-architecture` | — |
| `architecture-reviewer` | Macro-level architecture review (layering, dependency direction, module boundaries); returns structured findings + verdict | `sonnet` | No | `onion-architecture`, `frontend-architecture` | — |

Per-task skills come from `.claude/skills/pr-self-review/routing.md`: the
planner assigns them **by name** to each task; each implementer instance loads
exactly its task's list via the `Skill` tool before writing code. Preloading
everything was retired for context headroom — 127 KB of mostly-irrelevant
guidance diluted attention on the actual codebase evidence.

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

## `spec-creator`

The SDD specification author — the step **above** `implementation-planner`
(spec = what & why; plan = how & order). Given a feature idea plus designs /
links / screenshots, it grounds repo facts through the **devdigest-mcp**
tools (`get_conventions`, `get_blast_radius`, `list_agents`, `get_findings`;
Grep/Read fallback), critiques the inputs for gaps (corner cases,
cross-module risks, non-functionals, untrusted-input surfaces), and
interviews the user through **stop-and-return rounds** (≤4 Ukrainian
questions per round; `AskUserQuestion` is unavailable to subagents) across
six dialogue categories: problem/value, users/stories, scope/non-goals,
behavior/ACs, edge cases/failure modes, non-functional+provenance. It writes
`SPEC-NN-*.md` (structure from `.claude/references/spec-creator/template.md`,
EARS patterns from `ears.md`) into the right `specs/` folder plus the folder
README index line — its only permitted writes. Unclear → `[NEEDS
CLARIFICATION]`, never guessing; `Status: approved` requires zero open
clarifications; the later flip to `implemented` belongs to the `impl` skill.

**Based on:** EARS (Mavin et al., Rolls-Royce 2009); the clarification-gate
stop-and-return pattern from `implementation-planner`; formerly a project
skill — converted to an agent per the course lab (registry parity).

## `implementation-planner`

A read-only architect. It does **not** author specifications: requirements
arrive as input (from the request or a spec document); it validates them
against the codebase, returns clarifying questions when something is unclear,
and proposes improvements the user must confirm. The execution mode
(**multi-agent** — N parallel `implementer` instances, disjoint Owned paths,
DAG — vs **single-agent** — one pass, sequential steps) is stated by the
caller **up front**; when it is missing, the clarification gate fires as a
fallback — since `AskUserQuestion` is unavailable to subagents, the planner
stops and returns the questions as its final message for the orchestrator to
relay. For a spec with `Status: approved` and zero `[NEEDS CLARIFICATION]`
entries it does not re-open product questions — only findings where the code
contradicts the spec. It reads the codebase, can delegate heavy discovery to
`researcher`/`Explore` via the `Agent` tool, and emits an **Implementation
Plan** to `docs/plans/<feature>.md` — its single permitted write. The plan
carries requirement traceability IDs (traced to spec ACs via `Covers AC`),
per-task skills (assigned **by name** from
`.claude/skills/pr-self-review/routing.md`), measurable acceptance criteria,
red flags, a per-task verify command, a `## Test intents` section (consumed
by `impl` — never a generic "Tests" task), and — in
multi-agent mode — disjoint **Owned paths** per task plus a dependency
**DAG**. It never edits product code.

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
parallel instances — collisions are prevented purely by the
implementation-planner giving each task a **disjoint** set of Owned paths.
Only the universal core (`typescript-expert`, `security`) is preloaded; before
writing code the instance loads its task's **Skills (mandatory)** list via the
`Skill` tool — the list is named in the plan, so nothing is left to
conditional discovery, and the orchestrator verifies the report against it.
It honors the repo's house conventions, then **runs the touched package's
existing tests + typecheck to green**. Non-obvious findings are reported as
**Insight candidates** (never written to `INSIGHTS.md` directly — parallel
instances would collide; `impl` aggregates and writes once). It
self-reviews only the code it wrote; the full-diff review is left to
`pr-self-review`.

**Based on:**
- **Parallel coding instances + Owned paths** — disjoint file ownership (from
  the implementation-planner) and a forbidden-files list (lockfiles, migrations,
  root configs, others' contracts) to keep concurrent edits conflict-free.
  (Parallel-agents guidance.)
- **Named per-task skill loading** — the plan names each task's mandatory
  skills; the instance loads exactly that list at start. An explicit,
  report-verified list keeps the old preload-everything guarantee (nothing
  left to conditional discovery) at a fraction of the context cost.
  (Claude Code skills docs.)
- **Model tiers (Sonnet for implementation)** — focused execution on the cheaper
  tier. (Anthropic multi-agent system; community `wshobson/agents`.)
- **Self-verify to a green command** — a concrete done-condition (existing tests +
  typecheck) the agent runs until it passes. (Claude Code best practices.)
- **Fresh context for review** — review is not embedded in the implementer; it
  runs once over the whole diff via `pr-self-review`. (Claude Code best practices.)

## `test-writer`

> **Currently DISABLED** for token economy — the file is
> `test-writer.md.disabled`; rename back to `.md` to re-enable, and
> reinstate the parallel test-writer step in `.claude/skills/impl/SKILL.md`
> §3. While disabled, the plan's `## Test intents` land in the `/impl` run's
> manual checklist.

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
| Phases separated; planner read-only, implementer does the writing | `implementation-planner` vs `implementer` | Best practices; multi-agent blog |
| Single model tier: the whole fleet runs Sonnet (cost control); Opus is a per-invocation override for large plans | `model:` fields; Agent-tool `model` param | Multi-agent blog; `wshobson/agents` |
| Handoff via a written plan artifact (`docs/plans/<feature>.md`) | `implementation-planner` output | Best practices |
| Context diet: preload only the universal core; load the task's named skill list at start | `implementer` (`typescript-expert`+`security` core); `implementation-planner` (none — on-demand via `Skill`) | Skills docs; context-headroom rationale |
| Mandatory, non-skippable skill coverage | plan names each task's skills; implementer loads the exact list; `impl` verifies the report against it | Skills docs (explicit list beats conditional discovery) |
| Orchestration lives in the main session as a skill (`impl`) — `AskUserQuestion`, hooks, and the PR gate only work there | `impl` skill | Sub-agents docs (no `AskUserQuestion` in subagents) |
| File-scoped parallelism via disjoint Owned paths + forbidden files | `implementation-planner` tasks, `implementer` §1 | Parallel-agents guidance |
| Self-verify with an exact command run to green | `implementer` §4 | Best practices |
| Measurable acceptance criteria; dependencies as a DAG; requirement→task | `implementation-planner` plan template | Planning-agent guidance |
| Review in a fresh context, once over the whole diff | `pr-self-review` (orchestrator) | Best practices |
| Clarification gate: subagent returns questions instead of guessing (no `AskUserQuestion` in subagents) | `implementation-planner`, `researcher` | Sub-agents docs |
| Planner offloads heavy research to a separate context | `implementation-planner` `Agent` tool | Sub-agents docs |

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
3. Reference skills/conventions rather than copying them: preload only
   **universally-needed** skills via `skills:` (context headroom — don't
   preload everything; load task-specific skills by name via the `Skill`
   tool), and point to `.claude/skills/pr-self-review/routing.md` for the
   file→skill map.
4. Add a section to this README (role, frontmatter summary, and what it's based on
   + sources if any).
