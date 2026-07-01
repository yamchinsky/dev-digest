# Spec: Project Context Folder  |  Spec ID: SPEC-01  |  Status: approved
Supersedes: —
Modules: server, client, shared

## Problem & why

Markdown specs, docs, and architectural notes that live inside a repository today are invisible to review agents. Agents flag defects against generic best practices and never against the team's own written contracts — invariants like "the `api/` module must not import `db/` directly" exist only in human-readable specs that no machine reads. Reviewers who know the codebase spend extra cycles on findings the agent missed, and the agent wastes cycles on "violations" the spec already permits. Connecting a repository's existing markdown library to the reviewer that operates on it shifts review from generic linting to enforcement of the project's own agreements.

## Goals / Non-goals

**Goals:**
- Discover all `.md` files under `specs/`, `docs/`, or `insights/` subtrees in any connected repository's on-disk clone and surface them as a browsable, filterable library (the Project Context page).
- Allow manual attachment of discovered docs to a review agent (ordered list, persisted) or to a skill (flat list, inherited by any agent using that skill).
- Inject the contents of all attached docs into the existing `## Project context` untrusted prompt slot at run time, using the existing `wrapUntrusted`/`INJECTION_GUARD` mechanism already wired in the prompt-assembly layer.
- Record in the run trace which document paths were injected and expose the aggregate token estimate in the editor UI.
- Zero new LLM calls introduced by this feature.

**Non-goals:**
- Automatic selection of relevant specs for a specific PR (flash-selector) — deferred to a future feature.
- Chunking, embedding, or semantic indexing of discovered documents.
- User-configurable discovery root folders (roots are fixed: `specs/`, `docs/`, `insights/`).
- Fetching documents from URLs, GitHub raw API, or any source other than the workspace's existing on-disk clones.
- Enforcing a hard token ceiling for the injected context block (token count is displayed for the user's awareness, not enforced by the system).
- Editing document content inside DevDigest (preview only; edits happen in the repository).

## User stories

- **US-1** — As a workspace admin, I want to browse all markdown files discovered from every connected repo's clone in one Project Context library page, so I can see what project context material exists and understand which agents are using each document.
- **US-2** — As an agent author, I want to select and order discovered docs in the agent's Context tab, so that every run of that agent injects those docs (in the order I chose) into the `## Project context` prompt block.
- **US-3** — As a skill author, I want to attach discovered docs to a skill, so that any agent using that skill automatically inherits those docs as project context without needing per-agent configuration.
- **US-4** — As a PR reviewer, I want the run trace to show which documents were injected and their aggregate token cost, so I can verify the reviewer had the right context and audit why it made specific findings.
- **US-5** — As a workspace admin, I want to see how many agents use a given document, so I can understand the blast radius of retiring or changing a spec file.

## Acceptance criteria (EARS)

### Discovery

- **AC-1** — WHEN a repository has a recorded clone path that exists on disk, the system SHALL scan it recursively for all `.md` files whose path contains a `specs`, `docs`, or `insights` directory segment (glob `**/{specs,docs,insights}/**/*.md`) and return the resulting list of relative paths, each annotated with a category derived from the first matching directory segment (`specs` / `docs` / `insights`). (covers: US-1)
- **AC-2** — WHEN a repository has no recorded clone path or the path does not exist on disk, the system SHALL return an empty discovery list for that repository without raising an error. (covers: US-1)
- **AC-3** — The system SHALL perform discovery using only deterministic file-system reads; it SHALL make zero LLM calls during discovery. (covers: US-1)

### Project Context page

- **AC-4** — WHEN a user opens the Project Context page, the system SHALL display all docs discovered from repositories in the workspace, each showing its relative path, badge category (specs / docs / insights), and the count of agents in the workspace that currently attach it. (covers: US-1, US-5)
- **AC-5** — WHEN a user selects a doc in the Project Context list, the system SHALL render its full markdown content in the Preview pane without requiring navigation away from the page. (covers: US-1)
- **AC-6** — IF the workspace has no connected repositories with a valid clone path, the system SHALL render an empty-state message on the Project Context page rather than an error state. (covers: US-1)

### Agent attachment (Context tab)

- **AC-7** — WHEN a user opens the Context tab in the agent editor, the system SHALL display all workspace-level discovered docs, showing for each: a drag handle (for currently attached docs), a checkbox indicating the attached state, the doc's relative path, its category badge (specs / docs / insights), and a Preview control that renders the doc's content inline. (covers: US-2)
- **AC-8** — WHEN a user checks or unchecks a doc in the agent Context tab, the system SHALL immediately persist the change (attachment added or removed) and update the "N of M attached" count display. (covers: US-2)
- **AC-9** — WHEN a user drags an attached doc to a new position in the agent Context tab, the system SHALL persist the new order; docs with a lower order position SHALL appear earlier in the assembled `## Project context` block at run time. (covers: US-2)
- **AC-10** — The system SHALL display at the bottom of the agent Context tab the estimated total token size (characters divided by 4, rounded up) of all currently attached docs, along with a label identifying the target prompt slot (`## Project context`). (covers: US-2)

### Skill attachment (Context section)

- **AC-11** — WHEN a user opens the Context section in the skill editor, the system SHALL display all workspace-level discovered docs with a checkbox per doc showing the attached state and a filter input that narrows the list by relative path. (covers: US-3)
- **AC-12** — WHEN a user checks or unchecks a doc in the skill Context section, the system SHALL immediately persist the change. (covers: US-3)
- **AC-13** — The system SHALL display a "SERIALIZES AS" preview in the skill Context section showing the `## Project context` prompt-slot label and the list of attached relative paths; the preview is a UI hint of how the docs appear within that single shared slot — skill-inherited docs SHALL NOT introduce a separate prompt section. (covers: US-3)

### Run-time injection

- **AC-14** — WHEN a run starts for an agent, the system SHALL collect all doc paths attached to the agent (in the agent's defined order) followed by all doc paths attached to each skill linked to the agent (in skill-link order), read each file from the current PR's repository clone, and pass the resulting file contents as the `specs` array to the prompt-assembly function. (covers: US-2, US-3)
- **AC-15** — The system SHALL wrap each injected document's content as untrusted data using the existing delimiter-and-guard mechanism and inject the resulting block into the existing `## Project context` prompt slot; no new prompt slots SHALL be introduced. (covers: US-2, US-3)
- **AC-16** — IF a doc path that is attached to the agent or a linked skill does not resolve to an existing file in the PR's repo clone at run time, THEN the system SHALL skip that path without failing the run, SHALL log a `warn` entry to the run's event log (visible in the trace log section), and SHALL NOT include the path in `specs_read`. (covers: US-2, US-3)
- **AC-17** — The system SHALL introduce zero new LLM calls during project context collection and injection; all file reads at run time are deterministic I/O operations. (covers: US-2, US-3, US-4)
- **AC-20** — IF a request to replace an agent's or a skill's context-doc attachment list contains a path that is not present in the workspace's currently discovered doc set, THEN the system SHALL reject the entire request with a validation error (HTTP 400) and SHALL NOT persist any changes. (covers: US-2, US-3)

### Trace

- **AC-18** — WHEN a run completes, the system SHALL populate the `specs_read` field of the persisted run trace with the relative paths of every document successfully read and injected, in injection order. (covers: US-4)
- **AC-19** — WHEN the run trace drawer is open for a run whose `specs_read` is non-empty, the system SHALL display those paths in the Configuration section of the trace. (covers: US-4)

## Verification hints

- AC-1 — hermetic unit: create a temp directory with `.md` files at various depths under `specs/`, `docs/`, and `insights/`; call the discovery function; assert the returned list of relative paths and categories matches the expected set.
- AC-2 — hermetic unit: call discovery with a path that does not exist on disk; assert it returns an empty array and does not throw.
- AC-3 — hermetic unit: spy on the LLM adapter; run discovery; assert zero invocations.
- AC-4 — e2e flow: open Project Context page with a workspace that has a seeded clone; assert docs appear with path, category badge, and agent-count chip.
- AC-5 — e2e flow: click a doc row in Project Context; assert Preview pane renders the doc's markdown content.
- AC-6 — e2e flow: workspace with no clones; assert empty-state element visible, no error boundary triggered.
- AC-7 — e2e flow: open agent editor → Context tab; assert each doc row shows drag handle (if attached), checkbox, relative path, category badge, and Preview control.
- AC-8 — e2e flow: toggle a doc's checkbox; assert the "N of M attached" chip updates immediately and the server's GET /agents/:id/context-docs echoes the new list.
- AC-9 — e2e flow: drag an attached doc to a new position; assert GET /agents/:id/context-docs returns the new order.
- AC-10 — e2e flow: attach docs totalling a known byte count; assert the token estimate label reflects characters÷4.
- AC-11 — e2e flow: open skill editor → Context section; assert all workspace docs listed with checkboxes and filter input visible.
- AC-12 — e2e flow: toggle a doc's checkbox in skill Context; assert GET /skills/:id/context-docs echoes the update.
- AC-13 — manual: attach a doc to a skill; assert the "SERIALIZES AS" preview block shows the correct prompt-slot label and path.
- AC-14 — DB-backed `*.it.test.ts`: seed a repo clone with a known `.md` file, create an agent with that path attached, trigger a run; assert the `specs` argument passed to prompt assembly contains the expected file content.
- AC-15 — hermetic unit (prompt assembly): assert that the assembled user message contains the doc content wrapped in `<untrusted source="spec-0">…</untrusted>` inside the `## Project context` heading when `specs` is non-empty.
- AC-16 — DB-backed `*.it.test.ts`: agent has a path attached that is absent from the clone; assert the run completes, `specs_read` is empty, and the run log contains a warning entry for the missing path.
- AC-17 — DB-backed `*.it.test.ts`: spy on the LLM adapter; run with context docs; assert the LLM call count equals that of an equivalent run without context docs.
- AC-18 — DB-backed `*.it.test.ts`: after a run with injected docs, read the persisted trace; assert `specs_read` contains the expected relative paths in injection order.
- AC-19 — manual or e2e: open the trace drawer for a completed run with non-empty `specs_read`; assert the paths are visible in the Configuration section.
- AC-20 — DB-backed `*.it.test.ts`: PUT an attachment list containing a path outside the discovered set (e.g., `../../etc/passwd`); assert HTTP 400 and that the previously persisted attachment list is unchanged.

## Edge cases

- **No clone**: Repository has never been cloned (no clone path recorded) → discovery returns empty list (AC-2); run executes with `specs = []`; `specs_read = []`.
- **Clone path deleted after recording**: The clone path is in the DB but no longer exists on disk → discovery returns empty list (AC-2); attached paths resolve to nothing at run time (AC-16).
- **Empty `.md` file** (0 bytes): The file exists on disk but is empty → the system SHALL skip it silently at run time (no log entry, no empty untrusted block) and SHALL omit it from `specs_read`.
- **Very large doc**: A single `.md` file is large enough to saturate the model's context window → no enforced cap (Non-goal); the token estimate in the editor warns the user. A run against a model with insufficient context will fail with a truncation/oversize error from the LLM, which surfaces as a run failure.
- **Doc with delimiter injection attempt**: A `.md` file contains `</untrusted>` to break the wrapping delimiter → the existing escape in the untrusted-wrapping function already neutralises this (replaces `</untrusted>` with `<\/untrusted>` in content before wrapping).
- **Path traversal at the attachment API**: A caller submits a path not in the workspace's discovered set (e.g., `../../etc/passwd`) → rejected with HTTP 400 and no partial persistence, per AC-20 (whitelist validation against the discovered set).
- **Concurrent attachment edits**: Two browser sessions modify the same agent's context-docs list simultaneously → last-write-wins (no advisory lock), consistent with the existing skill-attachment pattern.
- **Skill doc absent from current repo's clone**: A skill attaches `specs/api-contract.md` but the PR being reviewed belongs to a repo that has no such file in its clone → AC-16 applies; the path is skipped at run time; `specs_read` omits it; the run continues with the remaining docs.
- **Combined agent + skill docs**: When both the agent and one or more linked skills have docs attached, the assembled `## Project context` block follows the normative merge order of AC-14 — agent docs first (in the agent's defined order), then skill docs in skill-link order. A doc attached both directly and via a skill is injected once, at its first (agent-level) position.
- **Agent-count badge on "Used by N agents"**: The count is scoped to the current workspace; docs used by agents in other workspaces do not contribute.

## Non-functional

- **Security**: The endpoint that reads and returns a doc's file content MUST authenticate the caller and authorize against the workspace before reading any file from disk. The discovery function MUST NOT follow symlinks outside the clone root (no symlink traversal beyond the repository's clone directory). Attachment endpoints MUST validate that submitted paths exist in the workspace's discovered set (whitelist) to prevent reads of arbitrary file paths.
- **Performance**: The discovery scan for a single repository SHOULD complete within 2 seconds for repositories containing up to 10,000 files total. The discovery result MAY be cached per-repository (cache invalidated on re-clone or on an explicit refresh action by the user) to avoid redundant full scans on every page load.
- **a11y**: The drag-and-drop reorder in the agent Context tab MUST be keyboard-accessible, consistent with the pattern used by the existing Skills tab (`@dnd-kit/core` with keyboard sensor).

## Flows & interactions

```mermaid
sequenceDiagram
  actor User
  participant client as client (browser)
  participant server as server
  participant disk as repo clone (disk)

  note over User,disk: Browse — Project Context page
  User->>client: opens Project Context page
  client->>server: GET /workspace/context-docs
  server->>disk: scan each repo clone for **/{specs,docs,insights}/**/*.md
  disk-->>server: relative paths
  server->>server: count agent-attachments per path
  server-->>client: [{path, category, agent_count}] per repo
  client-->>User: file list with badges and agent-count chips

  User->>client: selects a doc
  client->>server: GET /workspace/context-docs/preview (path + repoId)
  server->>disk: read file content
  disk-->>server: raw markdown
  server-->>client: {content}
  client-->>User: Preview pane renders markdown

  note over User,disk: Attach doc to agent
  User->>client: Context tab → checks a doc
  client->>server: PUT /agents/:id/context-docs {paths, order}
  server->>server: validate paths against discovered set; persist
  server-->>client: 200
  client-->>User: "N of M attached" chip + token estimate update

  note over User,disk: Run-time injection
  participant rc as reviewer-core (prompt assembly)
  User->>client: triggers run
  client->>server: POST /pulls/:id/runs
  server->>server: load agent → collect agent doc paths + skill doc paths
  server->>disk: read each file from PR's repo clone
  disk-->>server: file contents (missing paths skipped + warn in run log, AC-16)
  server->>rc: assemblePrompt({ specs: [content, …] })
  rc-->>server: assembled messages with ## Project context block
  server->>server: call LLM (unchanged path)
  server->>server: persist trace (specs_read = [path, …])
  server-->>client: run trace via SSE
```

## Contracts

| Resource / field | Type | Semantics |
|---|---|---|
| `GET /workspace/context-docs` | → `ContextDoc[]` | All docs discovered from all repos in the workspace; no request body |
| `GET /repos/:repoId/context-docs` | → `ContextDoc[]` | Docs discovered from a single repo's clone only |
| `GET /workspace/context-docs/preview` | query `path`, `repoId` → `{ content: string }` | Raw markdown content of one doc; `path` must be in the workspace's discovered set; requires workspace auth |
| `GET /agents/:id/context-docs` | → `AgentContextDoc[]` | Ordered list of paths attached to the agent |
| `PUT /agents/:id/context-docs` | body `{ items: { path: string; repo_id: string }[] }` → 200 | Replaces the agent's full ordered attachment list; array position implies order; server rejects paths not in the discovered set |
| `GET /skills/:id/context-docs` | → `SkillContextDoc[]` | Unordered list of paths attached to the skill |
| `PUT /skills/:id/context-docs` | body `{ items: { path: string; repo_id: string }[] }` → 200 | Replaces the skill's full attachment list; server rejects paths not in the discovered set |
| `ContextDoc` | `{ repo_id: string; relative_path: string; category: "specs" \| "docs" \| "insights"; agent_count: number }` | One discovered doc entry; `agent_count` is workspace-scoped |
| `AgentContextDoc` | `{ agent_id: string; repo_id: string; relative_path: string; order: number }` | One ordered attachment row for an agent; `order` is 0-based integer |
| `SkillContextDoc` | `{ skill_id: string; repo_id: string; relative_path: string }` | One attachment row for a skill; no ordering |
| `RunTrace.specs_read` | `string[]` (existing field) | Relative paths of docs successfully injected in this run; already defined in the shared trace contract |
| `NAV` Project Context entry | workspace-level nav item, no `:repoId` in href | Sits alongside Memory and Agents in the global nav section |

## Inputs (provenance)

- `## Project context` prompt slot, `wrapUntrusted`, and `INJECTION_GUARD` — [reused: prompt-assembly layer, introduced in L02–L04]
- `specs_read: string[]` trace field — [reused: shared run-trace contract]
- `clone_path` per-repository field — [reused: repos module]
- Join-table pattern for ordered agent attachments (agentId FK, skillId FK, order integer) — [reused: existing `agentSkills` join-table]
- Drag-reorder UI tab with checkbox list, filter input, and "N of M" count chip — [reused: existing SkillsTab component pattern]
- Run-trace Configuration section rendering `specs_read` chips — [reused: existing TraceBody component; already renders the field when non-empty]
- Discovery scan, file-read at run time, new DB attachment tables, new API routes, Project Context page, Context tab in AgentEditor, Context section in SkillEditor, new TanStack Query hooks — [new: this feature, 0 LLM calls]

## Untrusted inputs

Discovered `.md` files are repository content — author-controlled text, a potential injection surface (contributors can write anything in a spec file). All doc content is treated as data, not instructions:

- Each document's content is passed through the existing untrusted-wrapping function with a per-doc label before being assembled into the prompt.
- The shared `INJECTION_GUARD` system prompt rule applies to all content inside `<untrusted>…</untrusted>` delimiters.
- The existing escape in the wrapping function (neutralising `</untrusted>` close-tags found inside content) already prevents delimiter-breakout attacks.
