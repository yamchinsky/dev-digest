# Spec: Onboarding Generator  |  Spec ID: SPEC-02  |  Status: draft
Supersedes: —
Modules: server, client

## Problem & why

Developers joining an unfamiliar open-source project spend hours reading documentation, scanning file trees, and guessing which files to read first. DevDigest already indexes each connected repository — building a PageRank-scored import graph, a compact repo skeleton, and dependency chains from high-ranked entry points — but surfaces none of this intelligence to the person who needs it most: the newcomer. The Onboarding Generator converts those pre-computed, deterministic facts into a structured five-section tour using a single LLM narration call, giving every new contributor an architecture overview, the critical code paths, setup instructions, a rank-ordered reading list, and suggested first tasks — without manual curation and without requiring the newcomer to read the codebase from scratch.

## Goals / Non-goals

**Goals:**
- Generate and persist a five-section onboarding tour (Architecture overview, Critical paths, How to run locally, Guided reading path, First tasks) per `(repository, workspace)` pair using the existing `repoIntel.*` facade as the sole deterministic fact source and exactly one structured LLM call as the narrator.
- Display the tour on the repo-scoped page `/repos/:repoId/onboarding-tour`, reachable from the sidebar nav item already keyed `onboarding-tour` in the client shell.
- Allow on-demand regeneration; deduplicate concurrent regeneration requests so that at most one LLM call is in-flight per repository at any moment.
- Show an honest-provenance badge whenever the tour was generated against a `degraded` or `partial` repo-intel index.
- Order the Guided reading path (Section 4) by descending file rank as returned by `getTopFilesByRank()` — rank is the pure PageRank score over the import graph (hotness = 0 on shallow clones) — never alphabetically or by file date.
- Expose in the generation response a log record confirming exactly one LLM call, the model used, tokens consumed, and elapsed duration.

**Non-goals:**
- Deterministic extraction of tech-stack identity, run-script enumeration, or HTTP-route lists as separate analyzer inputs — all deferred to future work.
- Verified shell commands in "How to run locally": commands are LLM-inferred from the repo map; the UI must flag them as unverified.
- Fetching GitHub issues or any external data source for the First tasks section.
- Public (auth-free) sharing of the tour: "Share link" copies the current page URL to the clipboard only; no new server endpoint is introduced.
- Per-user or per-PR tours; exactly one tour exists per `(repo, workspace)` at a time.
- Streaming the LLM response to the client during generation.
- In-place editing of generated tour content inside DevDigest.
- Incremental per-section regeneration.
- Auto-regeneration triggered by push events, index-refresh, or re-sync completion.
- Onboarding tours for repositories with no recorded clone path.

## User stories

- **US-1** — As a developer exploring an unfamiliar repository in my DevDigest workspace, I want to generate a structured five-section onboarding tour, so that I can quickly understand the architecture, critical paths, and how to start contributing without reading the codebase from scratch.
- **US-2** — As a developer reading the tour, I want the Guided reading path to be ordered by code importance (PageRank), so that I read the most foundational files first rather than following an arbitrary order.
- **US-3** — As a developer, I want to regenerate the tour at any time (e.g., after a resync), so that the content reflects the latest indexed state of the repository.
- **US-4** — As a developer, I want to see when the tour was generated from an incomplete index, so that I know to resync and regenerate before fully trusting the content.
- **US-5** — As a workspace admin concerned about LLM cost, I want to confirm that generating the tour costs exactly one LLM call, so that I can predict and control usage.

## Acceptance criteria (EARS)

### Generation

- **AC-1** — WHEN a user triggers tour generation for a repository that has a recorded clone path, the system SHALL collect the repo map (`getRepoMap()`), ranked file list (`getTopFilesByRank()`), and dependency chains (`getCriticalPaths()`) from the repo-intel facade, wrap all repo-derived text as untrusted data, make exactly one structured LLM call, validate the response against the five-section schema, and persist the result as a single row in `onboarding_tours` keyed by `(repo_id, workspace_id)`. (covers: US-1, US-5)

- **AC-2** — WHEN tour generation completes, the system SHALL persist alongside the five section contents: the generation timestamp, the `IndexState.filesIndexed` count, and the `IndexState.status` value captured at the moment the LLM call was initiated. (covers: US-1, US-4)

- **AC-3** — WHEN tour generation completes, the system SHALL include in the generation response a log record containing: the number of LLM calls made (SHALL equal 1), the model identifier, total tokens consumed (prompt plus completion), and generation duration in milliseconds. (covers: US-5)

- **AC-4** — WHILE a tour generation is already in-progress for a repository, the system SHALL return an `in_progress` status to any subsequent generation request for the same repository and SHALL NOT initiate a second LLM call. (covers: US-3, US-5)

- **AC-5** — IF the LLM response fails schema validation against the five-section structure, THEN the system SHALL NOT persist the new result, SHALL leave any previously persisted tour for that repository unchanged, and SHALL return an error to the caller. (covers: US-1)

### Display

- **AC-6** — WHEN a user opens `/repos/:repoId/onboarding-tour` and a persisted tour exists, the system SHALL display all five section headings and their content together with the subtitle "Generated from index of N files · last refreshed X ago", where N is the persisted `files_indexed` count and X is the elapsed time since `generated_at`. (covers: US-1)

- **AC-7** — WHEN a user opens `/repos/:repoId/onboarding-tour` and no persisted tour exists for that repository, the system SHALL display an empty state with a "Generate" call-to-action and SHALL NOT render placeholder or skeleton section content. (covers: US-1)

- **AC-8** — IF the repository has no recorded clone path, THEN the system SHALL display an error state on the onboarding-tour page directing the user to clone the repository, and SHALL NOT offer a "Generate" or "Regenerate" button. (covers: US-1)

### Reading path ordering

- **AC-9** — The system SHALL order the Guided reading path (Section 4) by file rank descending as returned by `getTopFilesByRank()`, where rank is the pure PageRank score computed over the repository's import graph with hotness fixed at 0 on shallow clones. The system SHALL NOT reorder this list alphabetically or by last-modified date. (covers: US-2)

### Honest provenance — incomplete-index badge

- **AC-10** — WHEN the `index_status_at_generation` value stored in the tour row is `degraded` or `partial`, the system SHALL display alongside the section content a badge reading "Generated from an incomplete index — Resync and Regenerate for a fuller tour." (covers: US-4)

- **AC-11** — WHEN the `index_status_at_generation` value stored in the tour row is `full`, the system SHALL NOT display the incomplete-index badge. (covers: US-4)

### Honest provenance — unverified commands

- **AC-12** — The system SHALL display a disclaimer on the "How to run locally" section stating that the listed commands are LLM-inferred and have not been verified by execution. (covers: US-1, US-4)

### Share link

- **AC-13** — WHEN a user clicks "Share link," the system SHALL copy the current page URL to the system clipboard. (covers: US-1)

### Regenerate

- **AC-14** — WHEN a user clicks "Regenerate" and no generation is currently in-progress for that repository, the system SHALL initiate a new generation, overwrite the persisted tour row on successful completion, and update the displayed section content and subtitle. (covers: US-3)

### Untrusted-input handling

- **AC-15** — The system SHALL pass all repo-derived text (repo map content, file paths, dependency chain data) to the LLM prompt wrapped as untrusted data using the existing `wrapUntrusted` / `INJECTION_GUARD` mechanism. (covers: US-1)

## Verification hints

- AC-1 — DB-backed `*.it.test.ts`: seed a repo with a valid clone path and a full index; call the generate endpoint; assert exactly one LLM call appears in the generation log and that `onboarding_tours` has a new row with non-empty content in all five fields.
- AC-2 — DB-backed `*.it.test.ts`: after generation completes, read the persisted row; assert `generated_at`, `files_indexed`, and `index_status_at_generation` are all set and match the mock index state supplied.
- AC-3 — DB-backed `*.it.test.ts`: inspect the generation response's log record; assert `llm_calls === 1`, `model` is non-empty, `tokens_used > 0`, and `duration_ms > 0`.
- AC-4 — hermetic unit: inject a slow mock LLM adapter; fire two concurrent generate requests; assert the mock LLM is called exactly once and the second response carries `status: "in_progress"`.
- AC-5 — hermetic unit: mock LLM returning a response that fails five-section schema validation; call generate; assert the `onboarding_tours` row is unchanged from before and an error status is returned.
- AC-6 — e2e flow: seed a persisted tour row with known `files_indexed` and `generated_at`; navigate to `/repos/:repoId/onboarding-tour`; assert all five section headings are visible and the subtitle reflects the seeded values.
- AC-7 — e2e flow: workspace with no persisted tour for the repo; navigate to the page; assert the empty-state element is visible and no section heading elements are present in the DOM.
- AC-8 — e2e flow: repo with no `clone_path` in DB; navigate to the onboarding-tour page; assert the error-state element is visible and no "Generate" or "Regenerate" button is present.
- AC-9 — DB-backed `*.it.test.ts`: seed `file_rank` rows with known rank values in non-alphabetical order; call generate with a mock LLM; assert the `reading_path` array in the stored tour is ordered by `rank` descending.
- AC-10 — e2e flow: seed a tour row with `index_status_at_generation = "partial"`; navigate to the page; assert the incomplete-index badge text is visible.
- AC-11 — e2e flow: seed a tour row with `index_status_at_generation = "full"`; navigate to the page; assert no incomplete-index badge element is present in the DOM.
- AC-12 — e2e flow: navigate to a page with any persisted tour; assert a visible disclaimer element exists within the "How to run locally" section.
- AC-13 — manual: click "Share link"; assert the system clipboard contains the page URL.
- AC-14 — e2e flow: with a persisted tour, click "Regenerate"; wait for completion; assert the subtitle's relative-time value reflects a `generated_at` more recent than the pre-click value.
- AC-15 — hermetic unit (prompt assembly): supply a non-empty mock repo map and file list; call the generation prompt builder; assert the assembled LLM messages contain `<untrusted …>` wrappers around the repo-derived content and that the `INJECTION_GUARD` sentinel is present in the system message.

## Edge cases

- **No persisted tour (first visit)**: GET returns null/404; client shows empty state + "Generate" CTA (AC-7). No section content is rendered.
- **No clone path**: The generate endpoint cannot collect any facts; error state shown, no Generate/Regenerate button offered (AC-8).
- **Degraded or partial index at generation time**: Tour is generated with whatever facts the facade returns — which may include empty arrays from `getCriticalPaths()` or an empty string from `getRepoMap()`. The incomplete-index badge is shown (AC-10). No section is omitted; the LLM SHALL still return a five-section response with whatever content it can produce.
- **`getCriticalPaths()` returns empty chains** (no import edges indexed): Section 2 content is minimal; the Guided reading path may be an empty ordered list. The five-section structure is still persisted.
- **`getRepoMap()` returns degraded** (`reason: "flag_off"` or `"no_data"`): An empty string is passed for the repo-map slot; the LLM narrates from the remaining facts. The incomplete-index badge applies.
- **LLM schema validation failure**: Previously persisted tour is preserved; an error is returned to the caller (AC-5). The caller may retry.
- **Concurrent "Regenerate" requests**: Deduplicated — the second request returns `{ status: "in_progress" }`; no second LLM call is made (AC-4).
- **Very long repo map** (approaches LLM context limit): `getRepoMap()` accepts a `tokenBudget` parameter; the generation caller SHALL supply `DEFAULT_REPO_MAP_TOKEN_BUDGET` (currently 1 500 tokens) to enforce the existing facade cap before assembling the prompt.
- **`</untrusted>` delimiter in repo content**: Neutralised by the existing escape in `wrapUntrusted` (identical mechanism to SPEC-01 edge case "Doc with delimiter injection attempt").
- **Repo removed from workspace after tour was persisted**: The orphaned `onboarding_tours` row is removed via FK cascade from the `repos` table, following the existing cascade convention.
- **`index_status_at_generation = "failed"`**: Treated identically to `"degraded"` for badge display purposes; the incomplete-index badge is shown.

## Non-functional

- **Security**: The `GET /repos/:id/onboarding-tour` and `POST /repos/:id/onboarding-tour/generate` endpoints MUST authenticate the caller and authorize against the workspace before reading index data or persisting tour content. Neither endpoint is callable without valid workspace membership.
- **Performance**: The `GET` endpoint returning a cached tour row SHALL complete within 200 ms (p95) under normal Postgres load. The `POST` generate endpoint's response time is bounded by the LLM call and carries no hard SLA in this spec.
- **Cost control**: The one-LLM-call-per-generation constraint SHALL be enforced by construction (single call site in the generation service) and verified by the generation log (AC-3). The deduplication gate (AC-4) prevents redundant calls from concurrent clients.
- **a11y**: The "Share link" copy action SHALL provide a visible and screen-reader-accessible feedback indication (e.g., button label change to "Copied!" or a toast announcement) confirming that the URL was copied to the clipboard.

## Flows & interactions

```mermaid
sequenceDiagram
  actor User
  participant client as client (Next.js)
  participant server as server (Fastify)
  participant repoIntel as repo-intel facade
  participant llm as LLM (one structured call)
  participant db as Postgres

  note over User,db: First visit — no persisted tour
  User->>client: navigates to /repos/:repoId/onboarding-tour
  client->>server: GET /repos/:repoId/onboarding-tour
  server->>db: SELECT from onboarding_tours WHERE repo_id + workspace_id
  db-->>server: null (no row)
  server-->>client: 404 / empty body
  client-->>User: empty state + "Generate" CTA

  note over User,db: Generate
  User->>client: clicks "Generate"
  client->>server: POST /repos/:repoId/onboarding-tour/generate
  server->>server: check in-flight dedup — proceed if none in-progress
  server->>repoIntel: getIndexState(), getRepoMap(tokenBudget), getCriticalPaths(), getTopFilesByRank()
  repoIntel-->>server: facts (repo map text, ranked files, dependency chains) + IndexState
  server->>server: wrap repo-derived text with wrapUntrusted / INJECTION_GUARD
  server->>llm: ONE structured call with five-section schema
  llm-->>server: structured response { architecture_overview, critical_paths, how_to_run_locally, reading_path, first_tasks }
  server->>server: validate schema
  server->>db: UPSERT onboarding_tours (sections, reading_path ordered by rank, generated_at, files_indexed, index_status_at_generation)
  server-->>client: { tour: OnboardingTour, log: { llm_calls: 1, model, tokens_used, duration_ms } }
  client-->>User: render five sections + incomplete-index badge if degraded/partial

  note over User,db: Subsequent visit — cached tour
  User->>client: navigates to /repos/:repoId/onboarding-tour
  client->>server: GET /repos/:repoId/onboarding-tour
  server->>db: SELECT from onboarding_tours
  db-->>server: cached tour row
  server-->>client: OnboardingTour
  client-->>User: five sections + subtitle "N files · refreshed X ago"

  note over User,db: Concurrent regenerate (dedup path)
  User->>client: clicks "Regenerate" while generation already in-progress
  client->>server: POST /repos/:repoId/onboarding-tour/generate
  server->>server: in-flight dedup check — generation running
  server-->>client: { status: "in_progress" }
  client-->>User: loading indicator; polls GET until updated
```

## Contracts

| Resource / field | Type | Semantics |
| --- | --- | --- |
| `GET /repos/:id/onboarding-tour` | → `OnboardingTour` | Returns persisted tour for the `(repo, workspace)` pair; 404 if none generated yet; requires workspace auth |
| `POST /repos/:id/onboarding-tour/generate` | → `{ tour: OnboardingTour; log: GenerationLog }` or `{ status: "in_progress" }` | Triggers generation or returns in-flight dedup status; requires workspace auth |
| `OnboardingTour.repo_id` | `uuid` | Identifies the repository |
| `OnboardingTour.workspace_id` | `uuid` | Workspace scope |
| `OnboardingTour.sections.architecture_overview` | `string` | LLM-generated prose describing architecture and key entry points |
| `OnboardingTour.sections.critical_paths` | `string` | LLM-generated description of critical dependency chains derived from `getCriticalPaths()` data |
| `OnboardingTour.sections.how_to_run_locally` | `string` | LLM-inferred setup commands; displayed with unverified disclaimer (AC-12); not deterministically extracted |
| `OnboardingTour.sections.first_tasks` | `string` | LLM-generated suggested entry tasks inferred from repo map facts; no GitHub issue data |
| `OnboardingTour.reading_path` | `{ file: string; rank: number; description: string }[]` | Files ordered by `rank` DESC (pure PageRank from import graph, hotness = 0); descriptions are LLM-generated; ordering is deterministic from the facade |
| `OnboardingTour.generated_at` | ISO 8601 timestamp | Generation completion time; drives the "refreshed X ago" subtitle |
| `OnboardingTour.files_indexed` | `integer` | `IndexState.filesIndexed` value captured at generation time; drives the "N files" subtitle |
| `OnboardingTour.index_status_at_generation` | `"full" \| "partial" \| "degraded" \| "failed"` | Index status at generation time; drives the incomplete-index badge (AC-10, AC-11) |
| `GenerationLog.llm_calls` | `1` (literal integer) | Always 1; validated by AC-3 |
| `GenerationLog.model` | `string` | Model identifier used for the structured call |
| `GenerationLog.tokens_used` | `integer` | Total tokens consumed (prompt + completion) |
| `GenerationLog.duration_ms` | `integer` | Elapsed wall-clock time for the LLM call |

## Inputs (provenance)

- `getRepoMap(repoId, tokenBudget)` — [reused: repo-intel facade, starter infrastructure introduced at L05; capped at `DEFAULT_REPO_MAP_TOKEN_BUDGET` = 1 500 tokens]
- `getCriticalPaths(repoId)` — [reused: repo-intel facade, T3 pipeline; returns dependency chains from up to 5 highest-ranked root files]
- `getTopFilesByRank(repoId, n)` — [reused: repo-intel facade, T3 pipeline; rank = pure PageRank, hotness = 0]
- `getIndexState(repoId)` — [reused: repo-intel facade, T1; always returns a valid result even on degraded index]
- `wrapUntrusted` / `INJECTION_GUARD` — [reused: reviewer-core, introduced in L02–L04; same mechanism as SPEC-01]
- Nav key `onboarding-tour` in `client/messages/en/shell.json` and `activeKeyFor()` mapping in `client/src/components/app-shell/helpers.ts` — [reused: client shell, already scaffolded]
- `onboarding_tours` DB table, `GET /repos/:id/onboarding-tour`, `POST /repos/:id/onboarding-tour/generate`, client page at `/repos/[repoId]/onboarding-tour`, TanStack Query hooks — [new: this feature, 0 LLM calls for reads; 1 LLM call per generation]

## Untrusted inputs

All repo-derived text entering the LLM prompt — repo map content, file paths from `getTopFilesByRank()`, and dependency chain paths from `getCriticalPaths()` — is contributor-controlled and constitutes an untrusted input surface. The system SHALL treat all such content as data, not instructions:

- Repo map text and file path lists SHALL be passed through the existing `wrapUntrusted` function with per-slot labels before prompt assembly.
- The shared `INJECTION_GUARD` system-prompt rule SHALL apply to all content inside `<untrusted>…</untrusted>` delimiters.
- The existing escape in `wrapUntrusted` (neutralising `</untrusted>` close-tags inside content) prevents delimiter-breakout attacks, as established in SPEC-01.
- The LLM-generated tour content stored in `onboarding_tours` is rendered as display output only; it is never re-injected into subsequent LLM prompts.
