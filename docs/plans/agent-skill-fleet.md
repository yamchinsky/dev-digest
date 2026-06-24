# Development Plan: agent-skill-fleet

## Overview
Author four new Claude Code components in this repo's `.claude/` directory — two
subagents (`test-writer`, `architecture-reviewer`) and two skills
(`plan-verifier`, `doc-writer`) — each matching the existing house style exactly
and registered in the shared registries. The "product" is the **definition files
themselves** (markdown + YAML frontmatter), not TypeScript, so verification is
frontmatter/structure/registry correctness, not `tsc`/`vitest`.

## Requirements

| ID | Requirement | Acceptance criteria (measurable) |
|---|---|---|
| R1 | **Test Writer** subagent exists at `.claude/agents/test-writer.md`, WRITE-capable, generates client AND server tests. | File has valid YAML frontmatter (`name: test-writer`, router-style `description` with "Use proactively when…" + "Returns…", `tools` including `Read, Write, Edit, Bash, Grep, Glob, Skill`, `model`, `color`, preloaded `skills:`). Body has numbered sections covering: (a) client RTL+Vitest+jsdom path, (b) server Vitest unit + `*.it.test.ts` testcontainers path, (c) a test-PLAN-first step, (d) the over-mock prohibition ("never mock the DB; use real objects"), (e) Testing-Trophy ordering, (f) RTL query-priority + `userEvent.setup()`, (g) Fastify `app.inject()` + `close()` + the `.it.test.ts` filename rule, (h) "Hard rules", (i) a fixed Output contract, (j) Ukrainian-reply footer. Cites `../TESTING.md`, the `react-testing-library`/`typescript-expert`/backend skills, and the TEST WRITER source URLs. |
| R2 | **Architecture Reviewer** subagent exists at `.claude/agents/architecture-reviewer.md`, READ-ONLY, does macro-level architecture review distinct from `pr-self-review`. | Frontmatter `tools: Read, Grep, Glob, Bash` only (no `Write`/`Edit`), `name: architecture-reviewer`, router-style `description`, `model`, `color`, preloaded `skills:` (`onion-architecture`, `frontend-architecture`, `typescript-expert`). Body has numbered sections covering: (a) macro-vs-micro scope statement explicitly delegating line-level nits to `pr-self-review`, (b) the architecture smell catalog (Dependency-Rule violation, port leaking infra, fat controller, anemic domain, circular deps, god module, framework-in-domain), (c) an explicit "What NOT to flag" section, (d) 3-tier severity CRITICAL/WARNING/SUGGESTION with APPROVE/REQUEST-CHANGES verdict rule, (e) DETECT-and-EXPLAIN (never auto-refactor) stance, (f) read-only Bash constraint, (g) "Hard rules", (h) a fixed structured-findings Output contract, (i) Ukrainian-reply footer. Cites the ARCHITECTURE REVIEWER source URLs. |
| R3 | **Plan Verifier** skill exists at `.claude/skills/plan-verifier/SKILL.md`, requirement-coverage focused, read-only. | Frontmatter `name: plan-verifier`, trigger-style `description`, `allowed-tools` limited to read-only (`Read, Grep, Glob, Bash`). Body covers: (a) input = a `docs/plans/<feature>.md` + the implemented code, (b) a numbered traceability procedure mapping every Requirement ID + acceptance criterion to concrete evidence (file:line / test name / route / migration), (c) a coverage-matrix Output contract (Requirement → Status COVERED/PARTIAL/MISSING → Evidence), (d) explicit complementarity (coverage, NOT quality `pr-self-review` / NOT structure `architecture-reviewer`), (e) supporting skills used only as lenses, (f) read-only stance, (g) Ukrainian-reply footer. Registered in catalogs. |
| R4 | **Doc Writer** skill exists at `.claude/skills/doc-writer/SKILL.md` (+ supporting file), documents implemented functionality, converts plans to docs, produces docs WITH Mermaid diagrams, and knows WHERE docs land in this repo. | Frontmatter `name: doc-writer`, trigger-style `description`. Body covers: (a) Diátaxis 4-type selection (reference/how-to/explanation/tutorial) with "never mix types in one file", (b) a repo doc-placement table (root `README.md` / per-module `README.md`+`AGENTS.md`+`INSIGHTS.md` / `docs/` / `docs/plans/` / `docs/adr/NNNN-*.md` / module `specs/`) with kebab-case + scan-`docs/`-first rule, (c) Mermaid diagram-type→purpose map + "embed ```mermaid + 2–4 sentence caption", (d) "document only what's in the code / what NOT to document" anti-hallucination rules, (e) a fixed Output contract, (f) Ukrainian-reply footer. References the `mermaid-diagram` skill. A supporting `examples.md` or `references.md` exists. Registered in catalogs. |
| R5 | Model + tool posture is deliberate per component. | Test Writer `model: sonnet` (execution, writes code); Architecture Reviewer `model: opus` (heavy reasoning, read-only); Plan Verifier and Doc Writer are skills (run in main context, no own model field). Each posture is stated in the component's README/SKILL entry and matches its frontmatter. |
| R6 | Both new agents are registered in `.claude/agents/README.md`. | The "At a glance" table gains one row per new agent; each new agent gets a section with a **Based on:** block citing its sources; the file still parses as valid markdown. |
| R7 | Both new skills are registered in `.claude/skills/README.md` catalog table AND in the root `CLAUDE.md`/`AGENTS.md` "Project-local skills" list. | `.claude/skills/README.md` catalog gains one row per new skill; root `/Users/admin/dev-digest/CLAUDE.md` "Project-local skills (`.claude/skills/`)" section gains a bullet per new skill. |
| R8 | Each of the four components carries a "Based on (sources)" list mirroring the README convention, citing the provided URLs (no new web research). | Every component's registry/SKILL entry contains a **Based on:** block listing the exact source URLs assigned to it below. This is itself an acceptance criterion — a component with no source list fails. |

## Affected packages / modules
Only `.claude/` (agent + skill definition files and their two READMEs) and the
root `CLAUDE.md` (= `AGENTS.md`, skill registry). **No** product code in
`server/`, `client/`, `reviewer-core/`, `e2e/`, no `docs/agent-prompts/`, no
schema/migrations. New directories created: `.claude/skills/plan-verifier/`,
`.claude/skills/doc-writer/`.

## House-style facts every task must honor
- **Subagent frontmatter** (per `.claude/agents/{researcher,planner,implementer}.md`):
  `name`, router-style `description` (lead with "Use proactively when…", end with
  "Returns…"; may use YAML `>` block scalar), `tools` (allowlist; **omit `Write`/`Edit`
  to make read-only**), `model` (`sonnet`/`opus`), `color`, optional `skills:` list
  (preloads the FULL skill body — reliable + unconditional). Body = English markdown,
  numbered `## N. …` sections, a `## Hard rules` block, a fixed Output contract, and a
  `## Language` footer that ends "reply … in Ukrainian".
- **Skill frontmatter** (per `engineering-insights`/`pr-self-review`/`mermaid-diagram`):
  `name` + trigger-phrased `description`; optional `allowed-tools`. `SKILL.md` is the
  entry; supporting `examples.md`/`references.md` loaded on demand (progressive
  disclosure). `engineering-insights` is the model for a tightly-scoped procedural
  skill; `pr-self-review` is the model for a multi-step orchestrating workflow skill.
- **Agent README** (`.claude/agents/README.md`): "At a glance" table + one section per
  agent with a **Based on:** block + the "Adding a new agent" checklist (follow it).
- **Skill README** (`.claude/skills/README.md`): a "Catalog" table (lines 7–20) — one
  row per skill, columns `Skill | Scope | Description`.
- **Root skill list**: `/Users/admin/dev-digest/CLAUDE.md` → "Project-local skills
  (`.claude/skills/`)" bullet list.
- Subagents never get `AskUserQuestion`/`EnterPlanMode`; read-only = grant only
  `Read, Grep, Glob, Bash`.

## Tasks (parallel units)
Each task = one `implementer` instance, in the same shared working tree. Owned
paths are **disjoint** — no file appears in two tasks. The three shared registry
files (`.claude/agents/README.md`, `.claude/skills/README.md`, root `CLAUDE.md`)
are each owned by **exactly one** task (T5 and T6) to prevent collisions; those
registry tasks `Depends-on` the component tasks so they register real, finished
files. DAG is acyclic.

### T1 — Test Writer subagent · type: backend · covers: R1, R5 (Test Writer model), R8 (Test Writer sources)
- **Owned paths**: `.claude/agents/test-writer.md` (new file, sole owner)
- **Skills (mandatory)**: `react-testing-library`, `typescript-expert`,
  `fastify-best-practices`, `drizzle-orm-patterns`, `onion-architecture`. (Routing
  buckets: "UI tests" + "Backend integration tests" + "Backend unit tests".)
- **Task**: Write the subagent definition file modeling its frontmatter and body
  on `.claude/agents/researcher.md` + `implementer.md`. Frontmatter:
  `name: test-writer`; router `description` ("Use proactively when you need tests
  written for client React components or server Fastify/Drizzle code … Returns the
  new test files + a coverage summary."); `tools: Read, Write, Edit, Bash, Grep,
  Glob, Skill`; `model: sonnet`; `color:` (pick an unused one, e.g. `yellow`);
  `skills:` preload `react-testing-library`, `typescript-expert`,
  `fastify-best-practices`, `drizzle-orm-patterns`, `onion-architecture`.
  Numbered body sections to author (seeded from findings):
  1. **Scope & two test surfaces** — client (Next.js/React: RTL + Vitest + jsdom,
     `fetch` mocked in `client/src/test/setup.ts`, tests next to component as
     `*.test.tsx`) vs server (Fastify + Drizzle/Postgres: Vitest unit `*.test.ts`
     hermetic vs integration `*.it.test.ts` via testcontainers). Point at
     `../TESTING.md` for the suite split and the `*.it.test.ts` filename rule.
  2. **Test-PLAN first** — before writing, enumerate scenarios happy/edge/error;
     name tests "should X when Y"; apply a mutation mindset ("would this test ever
     go red?").
  3. **Testing Trophy ordering** — prefer integration > unit > e2e; "Write tests.
     Not too many. Mostly integration." Test behavior, not implementation; AAA;
     one logical assertion per test.
  4. **Never over-mock** — explicit "never mock the DB; use real objects"
     instruction; mock only at boundaries (network/external services). State the
     over-mock statistic as the rationale.
  5. **Client recipe (RTL)** — query priority `getByRole > getByLabelText >
     getByText > getByTestId`; never `container.querySelector`/CSS selectors;
     `getBy`/`queryBy`(absence)/`findBy`(async); `userEvent.setup()` not
     `fireEvent`; jest-dom matchers; wrap with `NextIntlClientProvider` when i18n
     is needed (cite `react-testing-library` + `client/CLAUDE.md` test rules).
  6. **Server recipe (Fastify + DB)** — `app.inject()` (no real HTTP) +
     `close()`/teardown; NEVER mock Postgres — testcontainers with a pinned image;
     transaction-rollback isolation; unique-value test-data factories; DB-backed
     file MUST end `.it.test.ts`; reach for `server/src/adapters/mocks.ts` for port
     fakes (cite `fastify-best-practices`, `drizzle-orm-patterns`,
     `onion-architecture` test split).
  7. **Run-to-green** — the right package-manager command per package
     (`client/` → `pnpm test` + `pnpm exec tsc --noEmit`; `server/` →
     `pnpm exec vitest run --exclude '**/*.it.test.ts'` then the `.it.test.ts`
     lane needs Docker; never `docker compose down -v`).
  8. **Hard rules** — only writes test files + minimal test fixtures; never edits
     product code to make a test pass; one test surface per file; respects
     `.it.test.ts` naming.
  9. **Output contract** — report: test files written, scenarios covered, scenarios
     deliberately skipped (with reason), commands run + green/red result.
  10. **Language** footer — report in English, address user in Ukrainian.
  Add a **Based on (sources)** block in-body (or note it must be mirrored into the
  README by T5) citing: https://arxiv.org/html/2602.00409v1 ·
  keelcode.dev/blog/ai-tests-safety-illusion ·
  kentcdodds.com/blog/the-testing-trophy-and-testing-classifications ·
  kentcdodds.com/blog/write-tests · kentcdodds.com/blog/testing-implementation-details ·
  martinfowler.com/articles/practical-test-pyramid.html ·
  testing-library.com/docs/queries/about ·
  kentcdodds.com/blog/common-mistakes-with-react-testing-library ·
  claritydev.net/blog/improving-react-testing-library-tests ·
  fastify.dev/docs/latest/Guides/Testing ·
  docker.com/blog/testcontainers-best-practices ·
  dominik.info/blog/mocking-the-database ·
  nikolamilovic.com/posts/integration-testing-node-postgres-vitest-testcontainers ·
  https://arxiv.org/abs/2506.02943 · https://arxiv.org/abs/2602.07900 ·
  qawolf.com/blog/how-to-write-an-effective-test-coverage-plan ·
  code.claude.com/docs/en/sub-agents.
- **Acceptance**: meets all of R1; `model: sonnet`; in-body **Based on** list
  contains the URLs above (R8).
- **Depends-on**: none.
- **Red flags**: do NOT duplicate `react-testing-library` content verbatim —
  *reference* the preloaded skill and `../TESTING.md` (house style: "reference,
  don't copy"). Keep `tools` an allowlist; `Write`/`Edit` ARE included (it writes
  tests). Pick a `color` not already used by researcher(cyan)/planner(purple)/
  implementer(green). Don't register in any README — T5 owns that.

### T2 — Architecture Reviewer subagent · type: backend · covers: R2, R5 (Architecture Reviewer model), R8 (Architecture Reviewer sources)
- **Owned paths**: `.claude/agents/architecture-reviewer.md` (new file, sole owner)
- **Skills (mandatory)**: `onion-architecture`, `frontend-architecture`,
  `typescript-expert`. (Backend modules + UI architecture buckets.)
- **Task**: Write the read-only subagent definition, frontmatter modeled on
  `researcher.md` (the read-only template). Frontmatter: `name:
  architecture-reviewer`; router `description` ("Use proactively when you need a
  macro-level architecture review of a backend or client change — layering,
  dependency direction, module boundaries, coupling/cohesion — complementing the
  line-level pr-self-review. Returns structured findings with a verdict. Does NOT
  write or auto-refactor."); `tools: Read, Grep, Glob, Bash` (READ-ONLY — no
  `Write`/`Edit`); `model: opus`; `color:` unused (e.g. `orange`); `skills:`
  preload `onion-architecture`, `frontend-architecture`, `typescript-expert`.
  Numbered body sections (seeded from findings):
  1. **Macro vs micro** — reviews system design, dependency direction, module
     boundaries, responsibility placement, coupling/cohesion. Explicitly states it
     does NOT do line-level nits, style, or per-line bugs — those are
     `pr-self-review`'s job (cross-reference `.claude/skills/pr-self-review/`).
  2. **Smell catalog to detect** — Dependency-Rule violation (inner imports
     outer), driven-port leaking infrastructure (SQL/HTTP in a repo interface),
     business logic in a route/controller (fat controller), anemic domain,
     circular dependencies, god module (high fan-in/out), scattered functionality,
     framework class in the domain. Ground each in `onion-architecture` (server +
     reviewer-core) and `frontend-architecture` (client) — map to this repo's
     rings/layers.
  3. **What NOT to flag** — no style nits (line-review's job); no theoretical risks
     not present in the diff; collapse a repeated pattern into ONE finding.
  4. **DETECT-and-EXPLAIN, not auto-refactor** — describe the violation and why it
     matters; recommend a fix direction (e.g. ArchUnitTS / fitness function) but
     never apply multi-file repairs. State the detection-strong / repair-weak
     rationale.
  5. **Severity & verdict** — 3 tiers CRITICAL / WARNING / SUGGESTION; APPROVE only
     when findings are SUGGESTION-or-none; REQUEST CHANGES on any WARNING+.
  6. **Read-only Bash** — inspection only (`git log/show/diff`, `rg`, `ls`); no
     mutation, no output redirection (mirror `researcher.md` §"Bash is READ-ONLY").
  7. **Frameworks referenced** — Dependency Rule (Clean Arch), Ports & Adapters
     (Cockburn), C4 model, fitness functions / ArchUnitTS as a recommendation only.
  8. **Hard rules** — never write/edit/refactor; one finding per distinct smell;
     every finding has file:line evidence + a verdict line.
  9. **Output contract** — structured findings (severity · rule · `path:line` ·
     why-it-matters · fix direction) grouped by severity, ending with an
     APPROVE / REQUEST CHANGES verdict.
  10. **Language** footer — Ukrainian.
  In-body **Based on (sources)** (also to be mirrored by T5):
  tech-stack.com/blog/the-architecture-review-process ·
  medium.com/netvise-software/software-architecture-and-code-review-882d779decf ·
  https://arxiv.org/abs/2303.18058 ·
  blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html ·
  martinfowler.com/bliki/AnemicDomainModel.html · journal.optivem.com ·
  https://arxiv.org/abs/2605.07001 · https://arxiv.org/abs/2406.17354 ·
  blog.cloudflare.com/ai-code-review · c4model.com ·
  github.com/LukasNiessen/ArchUnitTS · code.claude.com/docs/en/sub-agents.
- **Acceptance**: meets all of R2; `tools` has NO `Write`/`Edit`; `model: opus`;
  in-body **Based on** list present (R8).
- **Depends-on**: none.
- **Red flags**: READ-ONLY is the defining constraint — granting `Write`/`Edit`
  fails R2. Must not duplicate `pr-self-review` (line-level); it complements it.
  Pick an unused `color`. Don't touch any README — T5 owns it.

### T3 — Plan Verifier skill · type: backend · covers: R3, R5 (skill posture), R8 (Plan Verifier sources)
- **Owned paths**: `.claude/skills/plan-verifier/SKILL.md`,
  `.claude/skills/plan-verifier/examples.md` (new dir, sole owner of the whole dir)
- **Skills (mandatory)**: `typescript-expert` (as a supporting lens); models the
  procedural-skill shape on `engineering-insights` and the multi-step orchestration
  on `pr-self-review`.
- **Task**: Write the read-only verification skill. Frontmatter: `name:
  plan-verifier`; trigger-style `description` ("Use to verify that an implemented
  change satisfies every requirement and acceptance criterion of a Development
  Plan in `docs/plans/<feature>.md`. Trigger phrases: 'verify the plan', 'did we
  cover all requirements', 'requirement coverage', 'check plan against code'.
  Read-only; complements pr-self-review (quality) and architecture-reviewer
  (structure) — this one is COVERAGE."); `allowed-tools: Read, Grep, Glob, Bash`
  (read-only). Numbered body sections:
  1. **Inputs** — a plan file (`docs/plans/<feature>.md`) + the implemented code in
     the tree (and/or the diff). Parse the plan's Requirements table (IDs +
     acceptance criteria) and Tasks (Owned paths) as the checklist.
  2. **Traceability procedure** — for each Requirement ID and each measurable
     acceptance criterion, search the code for concrete evidence: `file:line`, a
     test name, a route, a migration, a schema field. Use `Grep`/`Glob`/read-only
     `Bash` (`git diff`, `rg`); never assert evidence you did not locate.
  3. **Status rubric** — COVERED (evidence found for the whole criterion) /
     PARTIAL (some sub-criteria met) / MISSING (no evidence). Distinguish "not
     implemented" from "could not locate".
  4. **Complementarity** — focus is requirement-coverage, NOT generic best
     practices (that's `pr-self-review`) and NOT layering/structure (that's
     `architecture-reviewer`). Use other repo skills only as supporting lenses to
     judge whether evidence truly satisfies a criterion.
  5. **Output contract** — a **coverage matrix**: one row per Requirement →
     Status → Evidence (`path:line` / test name / route / migration) → note;
     followed by an overall verdict (ALL COVERED / GAPS FOUND) and an explicit
     list of MISSING/PARTIAL items.
  6. **Read-only** stance — never edits; if a criterion is unmet, it reports the
     gap, does not fix it.
  7. **Language** footer — report English, address user in Ukrainian.
  `examples.md` — one worked coverage-matrix example against a small sample plan.
  In-body **Based on (sources)** block — derived from the repo's planner contract
  (`.claude/agents/planner.md` Requirements/Acceptance shape) + the traceability
  rationale (Plan-Verifier findings); cite code.claude.com/docs/en/skills for the
  skill mechanics. (No external web research required.)
- **Acceptance**: meets all of R3; read-only `allowed-tools`; coverage-matrix
  Output contract present; **Based on** block present (R8).
- **Depends-on**: none.
- **Red flags**: don't make it a quality/structure reviewer — scope creep into
  `pr-self-review`/`architecture-reviewer` violates R3. Read-only: no `Write`/`Edit`
  in `allowed-tools`. Don't register in any README — T6 owns that.

### T4 — Doc Writer skill · type: ui · covers: R4, R5 (skill posture), R8 (Doc Writer sources)
- **Owned paths**: `.claude/skills/doc-writer/SKILL.md`,
  `.claude/skills/doc-writer/references.md` (new dir, sole owner of the whole dir)
- **Skills (mandatory)**: `mermaid-diagram` (referenced, not preloaded — skills
  cannot preload other skills; reference it by name and point at
  `.claude/skills/mermaid-diagram/`). `frontend-architecture` as a supporting lens
  for docs about the client.
- **Task**: Write the documentation-authoring skill. Frontmatter: `name:
  doc-writer`; trigger-style `description` ("Use to document already-implemented
  functionality, convert an Implementation Plan into docs, or turn arbitrary input
  into a document with Mermaid diagrams. Knows where each doc type lands in this
  repo. Trigger phrases: 'write docs for', 'document this feature', 'turn this
  plan into docs', 'add a diagram', 'where should this doc go'."). Numbered body
  sections:
  1. **Diátaxis type selection** — reference (describe built functionality —
     neutral, mirrors code) / how-to (convert a plan into steps) / explanation
     (why/trade-offs) / tutorial; pick via the (action vs theory)×(learning vs
     applying) compass; NEVER mix two types in one file.
  2. **Repo doc placement** — a table mapping doc kind → exact location in THIS
     repo: orientation → the relevant `README.md` (root or module); detailed guide
     / cross-module deep dive → `docs/<topic>.md`; reviewer-prompt edits →
     `docs/agent-prompts/`; plans → `docs/plans/`; an immutable decision →
     `docs/adr/NNNN-title.md` (create the `adr/` convention if first); contract/
     fixture → module `specs/`; durable surprise → the right `INSIGHTS.md` (defer
     to `engineering-insights`). Rules: kebab-case filenames; scan `docs/` first to
     avoid duplicates; update docs in the same PR; prefer fresh+small over
     large+stale.
  3. **Mermaid integration** — diagram-type→purpose map (flowchart=process,
     sequenceDiagram=service/API interaction, erDiagram=DB schema,
     classDiagram=types, stateDiagram-v2=lifecycle/FSM, C4Context/C4Container=
     architecture); embed a ```mermaid``` fence in the `.md` + a 2–4 sentence
     caption; use `classDef`, not inline CSS. Reference the `mermaid-diagram` skill
     (`.claude/skills/mermaid-diagram/`) for syntax — don't re-teach it.
  4. **Document only what's in the code** — don't hallucinate APIs/params; one term
     per concept; explicit heading hierarchy; document the contract, not the
     implementation; what NOT to document (impl details obvious from code, FAQs,
     anything you can't keep current).
  5. **Output contract** — produce the doc file at the correct path with the chosen
     Diátaxis type, embedded Mermaid + caption where it clarifies, and a one-line
     note of WHERE it was placed and WHY.
  6. **Language** footer — Ukrainian.
  `references.md` — the Diátaxis/docs-as-code/Mermaid source list (= the
  **Based on** block, R8): diataxis.fr (+ /compass, /reference, /how-to-guides,
  /explanation) · google.github.io/styleguide/docguide/best_practices.html ·
  google.github.io/styleguide/docguide/philosophy.html ·
  martinfowler.com/bliki/ArchitectureDecisionRecord.html · adr.github.io/madr ·
  mermaid.js.org (intro, syntax/c4, syntax/flowchart) · c4model.com ·
  buildwithfern.com (how-to-write-llm-friendly-documentation) ·
  redocly.com/blog/optimizations-to-make-to-your-docs-for-llms · writethedocs.org ·
  code.claude.com/docs/en/skills.
- **Acceptance**: meets all of R4; repo doc-placement table present; Mermaid
  integration section present; supporting `references.md` exists with the URLs (R8).
- **Depends-on**: none.
- **Red flags**: don't re-teach Mermaid syntax — reference the existing skill. The
  doc-placement table MUST reflect THIS repo's actual layout (root/module READMEs,
  `docs/`, `docs/plans/`, `docs/agent-prompts/`, module `specs/`, `INSIGHTS.md`),
  not a generic one. Don't register in any README — T6 owns that.

### T5 — Agent registry · type: backend · covers: R6, R5 (agent models documented), R8 (agent sources in README)
- **Owned paths**: `.claude/agents/README.md` (sole owner)
- **Skills (mandatory)**: none specific (documentation edit); follow the README's
  own "Adding a new agent" checklist (lines ~134–145).
- **Task**: Register `test-writer` and `architecture-reviewer` in the agent README:
  add one row each to the "At a glance" table (Agent | Role | Model | Writes code?
  | Skills preloaded | Parallel — `test-writer`: sonnet / Yes / RTL+TS+backend / —;
  `architecture-reviewer`: opus / No / onion+frontend+TS / —); add a `## test-writer`
  and `## architecture-reviewer` section each with a one-paragraph role summary and
  a **Based on:** block citing that component's source URLs (mirror T1/T2 lists);
  optionally extend the "Shared design principles → sources" table. Do not alter
  existing rows.
- **Acceptance**: R6 met — both rows + both sections + both **Based on** blocks
  present; file is valid markdown; existing entries untouched.
- **Depends-on**: T1, T2 (register only after the real files exist, so the
  description/model/skills match).
- **Red flags**: this is the ONLY task that touches `.claude/agents/README.md` — no
  other task may. Model/tools/skills cited here MUST match T1/T2 frontmatter exactly
  (read those files first).

### T6 — Skill registry · type: ui · covers: R7, R8 (skill sources in catalog)
- **Owned paths**: `.claude/skills/README.md`, `/Users/admin/dev-digest/CLAUDE.md`
  (root `AGENTS.md` skill list) — both sole-owned by this task.
- **Skills (mandatory)**: none specific (documentation edit).
- **Task**: (a) Add one catalog row each for `plan-verifier` (Scope: Workflow) and
  `doc-writer` (Scope: Shared/Workflow) to the `.claude/skills/README.md` Catalog
  table, matching the existing `Skill | Scope | Description` columns and linking to
  each `SKILL.md`. (b) Add one bullet each to the root `CLAUDE.md` "Project-local
  skills (`.claude/skills/`)" list describing `plan-verifier` and `doc-writer` by
  trigger. Do not alter existing rows/bullets.
- **Acceptance**: R7 met — both catalog rows + both root-`CLAUDE.md` bullets
  present; existing entries untouched; both files valid markdown.
- **Depends-on**: T3, T4 (register only after the real `SKILL.md` files exist).
- **Red flags**: this is the ONLY task that touches `.claude/skills/README.md` and
  root `CLAUDE.md` — no other task may. The root `CLAUDE.md` is a project-instruction
  file: edit ONLY the "Project-local skills" list, leave everything else byte-identical.

## Sequencing & risks
- **Topological order / parallelism**: Wave 1 — **T1, T2, T3, T4 run fully in
  parallel** (four disjoint new files/dirs, zero shared paths). Wave 2 — **T5 and
  T6 run in parallel** with each other once their dependencies are done: T5 after
  {T1, T2}; T6 after {T3, T4}. T5 and T6 own disjoint files so they don't collide.
- **Collision control**: the three shared registry surfaces
  (`.claude/agents/README.md`; `.claude/skills/README.md`; root `CLAUDE.md`) are
  each owned by exactly one task (T5 owns the first; T6 owns the latter two). No
  component task (T1–T4) edits any README/registry — this is what keeps the shared
  tree conflict-free.
- **Decisions needing human confirmation**:
  - **`color` choices** for the two new agents — researcher=cyan, planner=purple,
    implementer=green are taken; T1/T2 should pick distinct unused colors
    (suggested: test-writer=`yellow`, architecture-reviewer=`orange`). Confirm if a
    palette is mandated.
  - **`.claude/agents/` is currently git-untracked** (`?? .claude/agents/`). The
    new agent files (and README edits) will be new/untracked too; whoever commits
    must `git add .claude/agents/` deliberately. Flag at PR time.
  - Whether the root `CLAUDE.md` skill list should be touched at all, or only the
    `.claude/skills/README.md` catalog — the task assumes BOTH per R7; confirm.
- **Migrations**: none — this plan touches no schema. (`pnpm db:generate` /
  `pnpm db:migrate` are irrelevant here.)

## Verification per task
This is a docs/definition deliverable — **no `tsc`/`vitest`**. The green
done-condition per task is: valid YAML frontmatter, house-style structure, required
sections present, registries updated, source URLs cited, and no path collisions.
Run from repo root `/Users/admin/dev-digest`.

- **T1**: `awk 'NR==1{if($0!="---")exit 1} /^---$/{c++} c==2{exit} END{if(c<2)exit 1}'
  .claude/agents/test-writer.md` (frontmatter delimiters present) **and** `grep -Eq
  '^name: test-writer$' .claude/agents/test-writer.md && grep -q 'model: sonnet'
  .claude/agents/test-writer.md && grep -q 'Write' .claude/agents/test-writer.md`
  (writes-capable) **and** `grep -qi 'never mock the database\|never mock the db'
  .claude/agents/test-writer.md && grep -q 'it.test.ts' .claude/agents/test-writer.md
  && grep -qi 'Ukrainian' .claude/agents/test-writer.md` (key sections) **and** the
  in-body **Based on** list contains the T1 URLs. Manual: numbered sections 1–10
  present; reads like `researcher.md`/`implementer.md`.
- **T2**: frontmatter present (same `awk` check) **and** `grep -Eq '^name:
  architecture-reviewer$' .claude/agents/architecture-reviewer.md && grep -q
  'model: opus' .claude/agents/architecture-reviewer.md` **and** read-only proven:
  `! grep -Eq '^tools:.*(Write|Edit)' .claude/agents/architecture-reviewer.md`
  (no Write/Edit on the tools line) **and** `grep -qi 'pr-self-review'
  .claude/agents/architecture-reviewer.md` (complementarity) `&& grep -q
  'REQUEST CHANGES' .claude/agents/architecture-reviewer.md && grep -qi 'Ukrainian'
  .claude/agents/architecture-reviewer.md`. Manual: smell catalog + "What NOT to
  flag" + 3-tier severity present; **Based on** list has the T2 URLs.
- **T3**: `test -f .claude/skills/plan-verifier/SKILL.md && test -f
  .claude/skills/plan-verifier/examples.md` **and** frontmatter `awk` check **and**
  `grep -Eq '^name: plan-verifier$' .claude/skills/plan-verifier/SKILL.md && grep
  -Eq '^allowed-tools:' .claude/skills/plan-verifier/SKILL.md && ! grep -Eq
  '^allowed-tools:.*(Write|Edit)' .claude/skills/plan-verifier/SKILL.md` (read-only)
  **and** `grep -qi 'coverage matrix\|COVERED' .claude/skills/plan-verifier/SKILL.md
  && grep -qi 'pr-self-review' .claude/skills/plan-verifier/SKILL.md`. Manual:
  traceability procedure + status rubric present; **Based on** block present.
- **T4**: `test -f .claude/skills/doc-writer/SKILL.md && test -f
  .claude/skills/doc-writer/references.md` **and** frontmatter `awk` check **and**
  `grep -Eq '^name: doc-writer$' .claude/skills/doc-writer/SKILL.md && grep -qi
  'diátaxis\|diataxis' .claude/skills/doc-writer/SKILL.md && grep -qi 'mermaid'
  .claude/skills/doc-writer/SKILL.md && grep -q 'docs/plans\|docs/adr\|specs'
  .claude/skills/doc-writer/SKILL.md` (repo placement table) **and**
  `references.md` contains the T4 URLs (`grep -q 'diataxis.fr'
  .claude/skills/doc-writer/references.md`).
- **T5**: `grep -q 'test-writer' .claude/agents/README.md && grep -q
  'architecture-reviewer' .claude/agents/README.md` (both registered) **and** both
  appear in the At-a-glance table region **and** each has a **Based on:** block
  (`grep -c 'Based on' .claude/agents/README.md` increased by 2). Manual: models
  shown (sonnet / opus) match T1/T2; existing rows unchanged (`git diff` shows only
  additions).
- **T6**: `grep -q 'plan-verifier' .claude/skills/README.md && grep -q 'doc-writer'
  .claude/skills/README.md` (catalog) **and** `grep -q 'plan-verifier'
  /Users/admin/dev-digest/CLAUDE.md && grep -q 'doc-writer'
  /Users/admin/dev-digest/CLAUDE.md` (root skill list). Manual: catalog columns
  intact; root `CLAUDE.md` diff limited to the "Project-local skills" list.

## Per-component summary (model · posture · skills · sections · output · sources)
| Component | Kind | Path | Model | Tools / posture | Preload / reference |
|---|---|---|---|---|---|
| Test Writer | subagent | `.claude/agents/test-writer.md` | `sonnet` | `Read, Write, Edit, Bash, Grep, Glob, Skill` (writes tests) | preload `react-testing-library`, `typescript-expert`, `fastify-best-practices`, `drizzle-orm-patterns`, `onion-architecture` |
| Architecture Reviewer | subagent | `.claude/agents/architecture-reviewer.md` | `opus` | `Read, Grep, Glob, Bash` (READ-ONLY) | preload `onion-architecture`, `frontend-architecture`, `typescript-expert`; cross-ref `pr-self-review` |
| Plan Verifier | skill | `.claude/skills/plan-verifier/SKILL.md` (+`examples.md`) | n/a (main ctx) | `allowed-tools: Read, Grep, Glob, Bash` (read-only) | reference `typescript-expert` as a lens; complements `pr-self-review` + `architecture-reviewer` |
| Doc Writer | skill | `.claude/skills/doc-writer/SKILL.md` (+`references.md`) | n/a (main ctx) | default (authoring) | reference `mermaid-diagram`; `frontend-architecture` as a lens |

Section seeds and the full per-component Output contracts and **Based on** source
lists are specified inline in T1–T4 above.
