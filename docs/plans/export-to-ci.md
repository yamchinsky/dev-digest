# Implementation Plan: export-to-ci

**Spec:** SPEC-05 (`specs/SPEC-05-2026-07-export-to-ci.md`)

## Overview

DevDigest agents are tuned in the studio but have no automated path into CI. This feature adds a 4-step Export Wizard that serialises an agent's live config into a GitHub Actions workflow bundle, commits it to a target repository via a PR, and ingests CI run results back into the studio through a client-initiated GitHub artifact pull.

## Execution mode: multi-agent

Parallel task waves with disjoint owned paths. Wave 1 lands the shared foundation (contracts, DB schema, port extension); Wave 2 lands three parallel work streams (server CI module, client wizard + CI tab, client CI Runs page); Wave 3 wires the module into the server registry. Each task is one `implementer` instance.

## Requirements

| ID | Covers AC | Requirement | Acceptance criteria (measurable) |
|---|---|---|---|
| R1 | AC-1, AC-2, AC-3 | Export Wizard — Target step: GHA enables Continue; non-GHA targets render as disabled "coming soon"; blank repo field blocks navigation | `ExportWizard.test.tsx`: GHA target enables Continue; non-GHA targets show "coming soon" and Continue disabled; blank repo field blocks Continue |
| R2 | AC-4, AC-5, AC-6 | Export Wizard — Preview step: server returns `CiExport` with all five file types; workflow file rendered in editable textarea; manifest YAML serialises `AgentManifest` fields from the agent's live config | `ExportWizard.test.tsx`: all file paths appear; workflow is in editable `<textarea>`; DB-backed `*.it.test.ts`: manifest YAML matches seeded agent fields |
| R3 | AC-7, AC-8 | Export Wizard — Configure step: trigger checkboxes with `opened`/`synchronize` pre-checked and non-deselectable; `post_as` selector maps to `DEVDIGEST_POST_AS` env var in workflow, NOT manifest | `ExportWizard.test.tsx`: checkbox states correct; `DEVDIGEST_POST_AS` appears in workflow, absent from manifest YAML |
| R4 | AC-9, AC-10, AC-11, AC-12, AC-13 | Export Wizard — Install step: `POST /agents/:id/export-ci` commits files atomically, opens/reuses PR, persists `ci_installations`; `action='files'` returns zip without DB write; GitHub errors return HTTP 502 | DB-backed `*.it.test.ts` with mock GitHub adapter: PR URL returned; single `ci_installations` row; idempotent re-export; zip returned; 502 on GitHub error |
| R5 | AC-14, AC-15, AC-16, AC-17 | Generated workflow security constraints: minimal permissions; secret via `${{ secrets.OPENROUTER_API_KEY }}`; fork guard `if:` condition; no `issue_comment` trigger | Hermetic `workflow.test.ts`: parse YAML; assert permission block; assert Secrets expression; assert fork guard; assert no `issue_comment` |
| R6 | AC-18, AC-19 | Agent manifest fidelity: same `AgentManifest` Zod schema used for generation and validation; runner exits 1 on invalid manifest | Hermetic `manifest.test.ts`: round-trip passes `AgentManifest.safeParse`; agent-runner `manifest.test.ts`: missing `model` causes `RunnerError` |
| R7 | AC-20, AC-21, AC-22 | CI Runs page `/ci-runs`: lists all `ci_runs` rows with required columns; empty state; filter re-queries `GET /ci-runs` with params | `CiRunsPage.test.tsx`: columns render; empty state renders; filter change updates query params |
| R8 | AC-23, AC-24, AC-25, AC-26 | CI Runs ingest: `POST /ci-runs/sync` pulls artifacts from GitHub for each installation; skips invalid artifacts; partial commit on rate-limit; auto-poll at 60s | DB-backed `*.it.test.ts`; `CiRunsPage.test.tsx`: `refetchInterval` <= 60 000 ms |
| R9 | AC-27, AC-28, AC-29, AC-30 | Agent CI tab: shows installations per agent; empty state + Export button; `ci_fail_on` PATCH updates agent and next manifest; CI-run history sub-list | `CiTab.test.tsx`; DB-backed `*.it.test.ts` for `ci_fail_on` round-trip |
| R10 | AC-31, AC-32 | Untrusted-input boundary in agent-runner: PR diff and description flow through `wrapUntrusted`/`INJECTION_GUARD`; `.devdigest/**` + workflow file stripped from diff | Hermetic `run.test.ts` and `diff.test.ts` (already exist) — verify unchanged invariant |
| R11 | AC-33 | `ci_runs` additive migration: adds `agent`, `duration_s`, `github_run_id`, `critical`, `warning`, `suggestion` columns | DB-backed `*.it.test.ts`: migrations run on fresh testcontainer; all six columns present; ingest fixture populates them |
| R12 | AC-34 | `GitHubClient` port extended with workflow-run listing + artifact download; `OctokitGitHubClient` implements them; CI sync service never imports Octokit directly | `*.it.test.ts` / grep: no `@octokit` import in `server/src/modules/ci/` |

### Open recommendations

None — all scope, mode, and design decisions were confirmed in the invocation prompt.

## Affected packages / modules

- `server/` — new `modules/ci/` module (routes, service, repository, constants); `db/schema/ci.ts` + new migration; `vendor/shared/adapters.ts` (`GitHubClient` port extension); `adapters/github/octokit.ts` (port impl); `modules/index.ts` (registration); `platform/container.ts` (no change needed — `github()` already exposes the full `GitHubClient` interface; any new method on the interface is automatically available)
- `client/` — new `app/ci-runs/` page; new `app/agents/[id]/_components/AgentEditor/_components/CiTab/`; `lib/hooks/ci.ts`; `vendor/ui/nav.ts` (add ci-runs entry); `vendor/shared/contracts/eval-ci.ts` (mirror sync — adds `AgentManifest` and missing fields)
- `server/src/vendor/shared/` + `client/src/vendor/shared/` — dual-vendored mirror: `eval-ci.ts` and `adapters.ts` must be kept in sync (both directions) whenever the port or contracts change

---

## Tasks (parallel units)

Each task = one `implementer` instance, running in the same shared working tree.
Owned paths across tasks MUST be disjoint — no file appears in two tasks.
Dependencies form a DAG (no cycles).

---

### T1 — Shared foundation: contracts + DB schema + port extension · type: backend · covers: R11, R12

- **Owned paths**:
  - `server/src/db/schema/ci.ts`
  - `server/src/vendor/shared/adapters.ts`
  - `server/src/vendor/shared/contracts/eval-ci.ts`
  - `client/src/vendor/shared/adapters.ts`
  - `client/src/vendor/shared/contracts/eval-ci.ts`
  - `server/src/adapters/github/octokit.ts`
  - `server/src/db/migrations/<next-migration>.sql` (new file — run `pnpm db:generate` inside `server/`)

- **Skills (mandatory)**: `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, `onion-architecture`

- **Task**:

  1. **DB schema** — extend `ciRuns` in `server/src/db/schema/ci.ts` with six new nullable columns (all `AC-33`): `agent text`, `duration_s double precision`, `github_run_id text`, `critical integer`, `warning integer`, `suggestion integer`. Use Drizzle column helpers: `text('agent')`, `doublePrecision('duration_s')`, `text('github_run_id')`, `integer('critical')` etc., all `.notNull()` omitted (nullable by default).

  2. **Migration** — run `pnpm db:generate` from `server/` to produce the additive migration SQL; commit the generated file. The migration must be purely additive (`ALTER TABLE ci_runs ADD COLUMN …`). Do NOT apply it (`pnpm db:migrate` is manual).

  3. **`CiRun` contract** — add `github_run_id`, `critical`, `warning`, `suggestion` to the `CiRun` Zod object in `server/src/vendor/shared/contracts/eval-ci.ts` (all `z.string()/z.number().int()` `.nullish()`). These fields are already present in `CiResultArtifact`; propagate them to `CiRun` so the GET response carries them without a join. `agent` and `duration_s` are already in `CiRun` — verify they are present and no-op if so.

  4. **`GitHubClient` port** — add two new method signatures to the `GitHubClient` interface in `server/src/vendor/shared/adapters.ts` (`AC-34`):
     ```ts
     listWorkflowRuns(repo: RepoRef, workflowFile: string): Promise<WorkflowRun[]>;
     downloadArtifact(repo: RepoRef, runId: string, artifactName: string): Promise<string>;
     ```
     Add the `WorkflowRun` shape (inline or as an interface export in the same file):
     ```ts
     export interface WorkflowRun {
       id: string;
       status: string;
       conclusion: string | null;
       html_url: string;
       created_at: string;
     }
     ```

  5. **`OctokitGitHubClient` impl** — implement `listWorkflowRuns` and `downloadArtifact` in `server/src/adapters/github/octokit.ts`. Use `this.octokit.rest.actions.listWorkflowRuns` and `this.octokit.rest.actions.listArtifactsForRepo` + `this.octokit.rest.actions.downloadArtifact` (returns a redirect to a zip; follow with `fetch` and unzip the JSON inside). Wrap both in `withRetry` / `withTimeout(_, TIMEOUT)` like all other methods.

  6. **Dual-vendor mirror** — copy the updated `eval-ci.ts` and `adapters.ts` from `server/src/vendor/shared/` to `client/src/vendor/shared/` exactly. The client mirror does not import `Provider`/`CiFailOn`/`WorkflowRun` from `knowledge.js` — import them from wherever the client mirror's `knowledge.ts` exposes them (verify first with a quick grep). The client mirror's `adapters.ts` does not expose `GitHubClient` to client components — it is vendored for type-only use; keep the full interface mirrored so `@devdigest/shared` resolves cleanly.

- **Acceptance** (R11, R12):
  - `server/src/db/schema/ci.ts` has all six new columns.
  - A new migration file exists under `server/src/db/migrations/`.
  - `GitHubClient` interface has `listWorkflowRuns` and `downloadArtifact`.
  - `OctokitGitHubClient` passes TypeScript with no errors (`cd server && pnpm tsc --noEmit`).
  - `CiRun` Zod shape has `github_run_id`, `critical`, `warning`, `suggestion` fields.
  - `client/src/vendor/shared/contracts/eval-ci.ts` and `adapters.ts` mirror server versions.

- **Depends-on**: none

- **Red flags**:
  - The client mirror import path uses `.js` extensions in the server but NOT in the client (client `AGENTS.md`: "no `.js` suffix"). Check existing client `eval-ci.ts` import style and match it.
  - `pnpm db:generate` must run from `server/` directory, not root. Never run `pnpm db:migrate` — it is manual.
  - `downloadArtifact` returns a zip archive (GitHub redirects to a signed S3 URL). The Octokit method returns a redirect; follow it with `fetch`, buffer the response, unzip (Node's built-in `zlib` or a tiny unzip) and parse the JSON inside. This is non-trivial — plan for a helper function `unzipFirstJson(buffer: Buffer): string`.
  - The new `WorkflowRun` type must also be added to `server/src/vendor/shared/index.ts` export barrel and its client mirror.

---

### T2 — Server CI module · type: backend · covers: R2, R4, R5, R6, R8

- **Owned paths**:
  - `server/src/modules/ci/routes.ts` (new)
  - `server/src/modules/ci/service.ts` (new)
  - `server/src/modules/ci/repository.ts` (new)
  - `server/src/modules/ci/constants.ts` (new)
  - `server/src/modules/ci/generators/manifest.ts` (new)
  - `server/src/modules/ci/generators/workflow.ts` (new)
  - `server/src/modules/ci/generators/workflow.test.ts` (new)
  - `server/src/modules/ci/generators/manifest.test.ts` (new)
  - `server/src/modules/ci/ci.it.test.ts` (new)

- **Skills (mandatory)**: `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security`

- **Task**:

  **`constants.ts`** — export:
  - `CI_BRANCH = 'devdigest/ci'`
  - `RUNNER_WORKFLOW_FILE = 'devdigest-review.yml'`
  - `MANIFEST_DIR = '.devdigest/agents'`
  - `SKILLS_DIR = '.devdigest/skills'`
  - `RUNNER_PATH = '.devdigest/runner/index.js'`
  - `MEMORY_PATH = '.devdigest/memory.jsonl'`
  - `RESULT_ARTIFACT_NAME = 'devdigest-result'`

  **`generators/manifest.ts`** — `generateManifestYaml(agent: Agent, skills: AgentSkillLink[]): string`. Import `yaml` (already in `agent-runner/package.json`; verify it's also in `server/package.json` or add it). Serialise to `AgentManifest` shape: `{ name, provider, model, system_prompt, skills: [slugs], strategy, ci_fail_on }`. Do NOT include `post_as`. Use `AgentManifest.parse(...)` to validate the object before serialising to YAML with `yaml.stringify(...)` (AC-18 round-trip test).

  **`generators/workflow.ts`** — `generateWorkflowYaml(opts: { triggers: string[], postAs: string, base?: string }): string`. Produces a YAML string with:
  - `on: pull_request: types: [<triggers>]` — never `issue_comment` (AC-17)
  - `permissions: contents: read, pull-requests: write` and nothing else (AC-14)
  - `jobs.review.if: github.event.pull_request.head.repo.full_name == github.repository` (AC-16)
  - `env: OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}` and `DEVDIGEST_POST_AS: <postAs>` (AC-15, AC-8)
  - `steps: - run: node .devdigest/runner/index.js` (no marketplace action reference; AC-14 note)

  **`generators/workflow.test.ts`** — hermetic Vitest test (AC-14..17): call `generateWorkflowYaml`; parse result with `yaml.parse`; assert `permissions` block exact; assert `OPENROUTER_API_KEY` value is the Secrets expression; assert fork-guard `if:` present; assert no `issue_comment` key anywhere.

  **`generators/manifest.test.ts`** — hermetic Vitest test (AC-18): build a known `AgentManifest` object, call `generateManifestYaml`, re-parse through `AgentManifest.safeParse`, assert no errors and fields match.

  **`repository.ts`** — Drizzle-only. Methods:
  - `upsertInstallation(agentId, repo, targetType)`: upsert by `(agent_id, repo, target_type)` conflict key — uses Drizzle `onConflictDoUpdate`
  - `getInstallationsByAgent(agentId)`: list all for agent
  - `getInstallationsByWorkspace(workspaceId)`: join through `agents` on `workspace_id`
  - `insertCiRun(data: InsertCiRun)`: insert one row; use `github_run_id` as dedup key with `onConflictDoNothing` on `(ci_installation_id, github_run_id)` unique constraint (add that constraint in the migration — coordinate with T1 to include it, or add via a second ALTER in the same migration)
  - `getCiRuns(filters: { workspaceId, agentId?, repo?, status?, since? })`: filtered list via Drizzle query builder; join `ci_installations` → `agents` to apply `workspace_id` scope

  **`service.ts`** — `CiService(container: Container)`. Methods:

  `generateBundle(agentId, workspaceId, input: CiExportInput): Promise<CiFile[]>`:
  - Load agent + linked enabled skills from `container.agentsRepo`
  - Assert agent belongs to `workspaceId` (workspace scope — AC security)
  - Call `generateManifestYaml` → `CiFile` with `editable: false`, path `.devdigest/agents/<slug>.yaml`
  - For each enabled skill: `CiFile` with skill markdown content (read from `skills` table), path `.devdigest/skills/<slug>.md`, `editable: false`
  - Empty memory: `CiFile` with `contents: ''`, path `.devdigest/memory.jsonl`, `editable: false`
  - Runner bundle: read `agent-runner/dist/index.js` from the filesystem (absolute path resolved at startup via `path.resolve(__dirname, '../../../../../agent-runner/dist/index.js')` — provide as a constant, degrade gracefully if file is missing with a descriptive `ConfigError`); `CiFile` with `editable: false`, path `.devdigest/runner/index.js`
  - Workflow: call `generateWorkflowYaml({ triggers: input.triggers, postAs: input.post_as, base: input.base })` → `CiFile` with `editable: true`, path `.github/workflows/devdigest-review.yml`
  - Return the ordered array of `CiFile`

  `exportCi(agentId, workspaceId, input: CiExportInput, userFiles?: CiFile[]): Promise<CiExport>`:
  - Generate bundle (or use `userFiles` if provided — the preview step may have edited the workflow)
  - If `input.action === 'files'`: return `{ installation: null, files, pr_url: null }` — no DB write, no GitHub call (AC-12)
  - If `input.action === 'open_pr'`:
    - Get `container.github()` adapter
    - Parse `input.repo` into `{ owner, name }` (split on `/`)
    - Call `commitFiles(repo, { branch: CI_BRANCH, base: input.base, message: 'chore: add DevDigest CI review', files })` (AC-9) — wrap in try/catch; on error throw `ExternalServiceError` (becomes 502 at route, AC-13)
    - Call `findOpenPr(repo, CI_BRANCH)` — if null, call `openPullRequest(repo, { title: 'Add DevDigest CI review', head: CI_BRANCH, base: input.base })` (AC-10/11)
    - Upsert `ci_installations` record (AC-10 idempotent)
    - Return `{ installation, files, pr_url }`

  `syncCiRuns(workspaceId): Promise<{ synced: number }>`:
  - Load all `ci_installations` for the workspace
  - For each installation: call `github.listWorkflowRuns(repo, RUNNER_WORKFLOW_FILE)` — collect completed runs
  - For each completed run not already in `ci_runs` (check `github_run_id`): call `github.downloadArtifact(repo, runId, RESULT_ARTIFACT_NAME)` → parse JSON → `CiResultArtifact.safeParse` — on validation failure log and skip (AC-25); on success `insertCiRun(...)` populating all AC-33 fields
  - If GitHub throws rate-limit/transient error: commit already-ingested rows, re-throw as `ExternalServiceError` (502, AC-26)

  `getCiRuns(workspaceId, filters): Promise<CiRun[]>`: delegate to repository, return mapped DTOs.

  `getInstallations(agentId, workspaceId): Promise<CiInstallation[]>`: workspace-scoped installation list.

  **`routes.ts`** — Fastify plugin. Register all routes under `{ prefix: '' }`:
  - `POST /agents/:id/export-ci` — body: `CiExportInput`; response: `CiExport`; calls `getContext`, then `service.exportCi`
  - `GET /agents/:id/ci-installations` — response: `z.array(CiInstallation)`; calls `service.getInstallations`
  - `GET /ci-runs` — querystring: `{ agent_id?, repo?, status?, since? }` (all optional strings); response: `z.array(CiRun)`; calls `service.getCiRuns`
  - `POST /ci-runs/sync` — body: `z.object({}).passthrough()`; response: `z.object({ synced: z.number() })`; calls `service.syncCiRuns`
  - All routes: `const { workspaceId } = await getContext(app.container, req)` at top of each handler
  - Register response schemas via `serializerCompiler` per repo INSIGHTS requirement
  - All routes are workspace-scoped (AC security note)

  **`ci.it.test.ts`** — DB-backed integration tests (testcontainers). Cover AC-9/10 (commitFiles + openPullRequest called; installation row created), AC-11 (findOpenPr returns URL → no second PR), AC-12 (action=files → zip binary, no installation row), AC-13 (commitFiles throws → 502, no installation row), AC-23/25/26 (sync: valid artifact → ci_runs row; invalid artifact → skip; rate-limit → 502 + partial commit), AC-29 (`PATCH /agents/:id` `ci_fail_on` + manifest round-trip). Use `MockGitHubClient` from `server/src/adapters/mocks.ts` (add `listWorkflowRuns`/`downloadArtifact` to the mock — coordinate with T1 via the interface, T2 adds the mock impl).

- **Acceptance** (R2, R4, R5, R6, R8):
  - Hermetic `workflow.test.ts` passes (permissions, Secrets expr, fork guard, no issue_comment)
  - Hermetic `manifest.test.ts` round-trip passes
  - DB-backed `ci.it.test.ts` passes (all AC listed above)
  - `cd server && pnpm tsc --noEmit` green
  - No direct `@octokit` or `Octokit` import anywhere in `server/src/modules/ci/`

- **Depends-on**: T1 (needs new `ciRuns` schema columns + `GitHubClient` port methods before compiling)

- **Red flags**:
  - The `agent-runner/dist/index.js` bundle does NOT exist yet (no `dist/` directory was found). The service must handle a missing bundle gracefully (`ConfigError` with a clear message: "agent-runner bundle not found; run `npm run build` in agent-runner/"). Do NOT silently generate an empty file — the CI workflow will fail at runtime with no bundle.
  - `pnpm db:generate` produces a SQL migration using Drizzle's naming convention; do not hand-write the SQL. Run it in T1, then T2's repository can import the updated schema.
  - The deduplication unique constraint `(ci_installation_id, github_run_id)` on `ci_runs` must be added to the Drizzle schema in T1 (via `.uniqueIndex(...)` on the table def) so `onConflictDoNothing` in T2's repository works correctly. The migration produced by T1 must include this.
  - `ExternalServiceError` from `platform/errors.ts` maps to HTTP 502 in the global error handler — verify this is the correct error class before using it (grep `errors.ts`).
  - When `findOpenPr` returns an existing URL for `action=open_pr`, the service must NOT call `openPullRequest` again (AC-11) but still upsert `ci_installations` to stay idempotent.
  - `CiExport` contract returns `installation: CiInstallation` — for `action='files'` the spec says no DB write and no installation is returned; `pr_url` is nullable. The contract as defined in `eval-ci.ts` has `installation: CiInstallation` (non-nullable). For the `files` path, the route should return `200` with `installation: null` — update the response schema to `installation: CiInstallation.nullable()` or define a separate response type. Verify and resolve before coding.
  - Rate-limit detection: GitHub returns HTTP 403 or 429 with `X-RateLimit-Remaining: 0`; the Octokit wrapper in `withRetry` may already handle retries. The sync service must NOT retry indefinitely — catch after `withRetry` exhausts and treat as `ExternalServiceError`.

---

### T3 — Client: Export Wizard + CI tab in AgentEditor · type: ui · covers: R1, R2, R3, R4, R9

- **Owned paths**:
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.tsx` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.test.tsx` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/index.ts` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/ExportWizard.tsx` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/ExportWizard.test.tsx` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`
  - `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`
  - `client/src/lib/hooks/ci.ts` (new)

- **Skills (mandatory)**: `react-best-practices`, `frontend-architecture`, `next-best-practices`, `zod`

- **Task**:

  **`client/src/lib/hooks/ci.ts`** — TanStack Query hooks for all CI endpoints:
  - `useCiInstallations(agentId)` → `GET /agents/:id/ci-installations`
  - `useExportCi()` → mutation `POST /agents/:id/export-ci`, returns `CiExport`
  - `useCiRuns(filters)` → `GET /ci-runs` with optional `{ agent_id?, repo?, status?, since? }` query params; `refetchInterval: 60_000` when on `/ci-runs` page (pass as option), `refetchOnWindowFocus: false` (per client defaults)
  - `useSyncCiRuns()` → mutation `POST /ci-runs/sync`
  - Add re-exports from `client/src/lib/hooks/index.ts`

  **`ExportWizard.tsx`** — 4-step wizard using `ExportWizardSteps` from `client/src/vendor/ui`. Steps: Target → Preview → Configure → Install.

  - *Step 1 — Target*: Render four target options (GHA, CircleCI, Jenkins, Generic CLI). GHA: enabled, radio-selectable. Others: disabled with "coming soon" badge (AC-2). Show target repo input (`owner/name` format) when GHA selected. Continue button enabled only when GHA selected AND repo non-empty AND valid `owner/name` format (AC-1, AC-3).

  - *Step 2 — Preview*: On mount call `useExportCi()` with `action: 'preview'`... wait — the spec says the Preview step calls the server to generate files. Re-reading: AC-4 says "the server SHALL return a `CiExport` preview payload" when the wizard advances to Preview. The endpoint is `POST /agents/:id/export-ci` with the repo/triggers/post_as. The client should call this on entry to Step 2 to get the file list for display. Use a `useQuery` (not mutation) pattern with `queryFn` calling the export endpoint with `action: 'files'` to get the preview — or call the mutation on step advance. Use a dedicated preview query (`useCiPreview(agentId, input, enabled)`) that fires when entering step 2. Display each `CiFile` with path and a preview of contents. The workflow file (`editable: true`) renders in a `<textarea>` that the user can edit (controlled state). Non-editable files render as `<pre>` code blocks (AC-5).

  - *Step 3 — Configure*: Trigger checkboxes: `opened` (checked, disabled), `synchronize` (checked, disabled), `reopened` (unchecked, enabled) (AC-7). `post_as` radio/select: "GitHub review" (default), "PR comment", "None (exit code only)" (AC-8).

  - *Step 4 — Install*: Two actions:
    - "Open a PR with these files": call `useExportCi()` mutation with `action: 'open_pr'` and the (possibly edited) files in the body. On success show PR URL link (AC-9, AC-10).
    - "Copy files as a zip": call `useExportCi()` mutation with `action: 'files'`, receive the zip binary, trigger browser download (AC-12).
    - Show note: "Add `OPENROUTER_API_KEY` to the repo's Actions secrets before the workflow runs." (non-functional UX note per spec).

  **`ExportWizard.test.tsx`** — component tests (jsdom/vitest). Cover AC-1/2/3 (target step), AC-4/5 (preview step mocked), AC-7/8 (configure step), AC-6 implicitly via manifest content in preview.

  **`CiTab.tsx`** — AgentEditor tab component.
  - Use `useCiInstallations(agent.id)` to get installation list.
  - If no installations: empty state + "Export to CI" button that opens `ExportWizard` (AC-28).
  - If installations present: list each with installed date, target type badge, link to export PR URL (from `installedAt` + `targetType` + `repo`) (AC-27).
  - Below: `useCiRuns({ agent_id: agent.id })` sub-list — compact table with same columns as CI Runs page (AC-30).
  - `ci_fail_on` selector: reads from `agent.ci_fail_on`; on change calls `PATCH /agents/:id` with new value (existing `useUpdateAgent` mutation from `hooks/agents.ts` — use it, do not duplicate) (AC-29).
  - "Export to CI" button: `aria-label="Export to CI"`, keyboard-operable (AC a11y note).

  **`CiTab.test.tsx`** — component tests. Cover AC-27/28 (installation list and empty state), AC-30 (CI run history sub-list mocked).

  **`AgentEditor.tsx`** — add `CiTab` to the `tab === 'ci'` branch.

  **`constants.ts`** — add `{ key: 'ci', labelKey: 'editor.tabs.ci', icon: 'Cpu' }` entry to `TABS` array.

- **Acceptance** (R1, R2, R3, R4, R9):
  - `ExportWizard.test.tsx` passes: GHA enables Continue; non-GHA disabled; blank repo blocks Continue; preview shows files and editable textarea; configure checkboxes correct; `DEVDIGEST_POST_AS` in workflow / absent from manifest
  - `CiTab.test.tsx` passes: installations list; empty state + button; CI-run history sub-list
  - `cd client && pnpm tsc --noEmit` green

- **Depends-on**: T1 (needs updated `eval-ci.ts` client mirror with `AgentManifest` etc.)

- **Red flags**:
  - The `ExportWizardSteps` UI primitive is in `client/src/vendor/ui` — verify it exists and its props before building the wizard. If it only provides a step indicator, the wizard content panels are coded locally in `ExportWizard.tsx`.
  - The `i18n` namespace `ci.json` is already complete with all strings — use `useTranslations('ci')` and reference existing keys (`exportWizard.*`, `ciTab.*`). Do not add new keys without checking `ci.json` first.
  - For the preview step, calling `POST /agents/:id/export-ci` with `action: 'files'` will trigger the bundle generation on the server — the `agent-runner/dist/index.js` must exist. The service should degrade gracefully (see T2 red flag) so the preview can still return the other files even without the bundle, with a placeholder `CiFile` contents of `// bundle not built yet`.
  - `PATCH /agents/:id` already exists in `hooks/agents.ts` (`useUpdateAgent`). Use it for `ci_fail_on` update — do not add a separate mutation.
  - The `useCiRuns` hook must not have `refetchInterval` hardcoded — pass it as an option so the CI tab can use it without auto-polling (auto-poll is a CI Runs page concern only).
  - `agents` i18n namespace needs a `editor.tabs.ci` key in `client/messages/en/agents.json` — add it.

---

### T4 — Client: CI Runs page · type: ui · covers: R7, R8

- **Owned paths**:
  - `client/src/app/ci-runs/page.tsx` (new)
  - `client/src/app/ci-runs/_components/CiRunsPage/CiRunsPage.tsx` (new)
  - `client/src/app/ci-runs/_components/CiRunsPage/CiRunsPage.test.tsx` (new)
  - `client/src/app/ci-runs/_components/CiRunsPage/index.ts` (new)
  - `client/src/vendor/ui/nav.ts`

- **Skills (mandatory)**: `react-best-practices`, `frontend-architecture`, `next-best-practices`

- **Task**:

  **`client/src/vendor/ui/nav.ts`** — add a `ci-runs` entry to the `NAV` array (in the `WORKSPACE` section or a new `CI` section — match the visual grouping in the i18n `shell.json`):
  ```ts
  { key: 'ci-runs', label: 'CI Runs', icon: 'GitBranch', href: '/ci-runs', gKey: 'r' }
  ```
  (Verify `GitBranch` or another suitable icon name exists in `IconName`; if not, use `Cpu` or `Activity`.)

  **`client/src/app/ci-runs/page.tsx`** — thin Next.js App Router page component. Server component or client component as appropriate (page-level metadata: `<title>CI Runs</title>`). Renders `<CiRunsPage />`.

  **`CiRunsPage.tsx`** — full page component:
  - State: `filters = { since: '7d', agent_id: undefined, repo: undefined, status: undefined }`
  - Use `useCiRuns(filters)` with `refetchInterval: 60_000` and `refetchOnWindowFocus: false` (AC-24 auto-poll).
  - Use `useSyncCiRuns()` mutation for the "Sync" button (AC-23).
  - Filter controls: time window select ("Last 7 days"), agent select, repo input, status select — on change update `filters` → hook re-queries (AC-22). Use `useTranslations('ci').runs.filters.*` for labels.
  - Table columns: timestamp, PR number, repository (link to GitHub PR), agent name, status badge, findings count (`findings_count`), cost (`cost_usd`), link to GitHub Actions job (`github_url`) (AC-20). Status badge: text label + accessible text (not colour-only) per a11y note.
  - Empty state: `useTranslations('ci').runs.emptyTitle` + `emptyBody` (AC-21).
  - "Sync" button: fires `useSyncCiRuns()`; shows "Refreshing…" while pending (AC-23).
  - Auto-poll "auto-refresh on" indicator (AC-24).

  **`CiRunsPage.test.tsx`** — component tests. Cover AC-20 (columns render with mocked data), AC-21 (empty state), AC-22 (filter change updates query param), AC-24 (`refetchInterval` ≤ 60 000 ms asserted on the hook call).

- **Acceptance** (R7, R8):
  - `CiRunsPage.test.tsx` passes: all AC-20/21/22/24 cases
  - `/ci-runs` nav item appears in `nav.ts`
  - `cd client && pnpm tsc --noEmit` green

- **Depends-on**: T1 (client mirror with `CiRun` updated contract), T3 (needs `useCiRuns`, `useSyncCiRuns` from `hooks/ci.ts`)

- **Red flags**:
  - T3 owns `client/src/lib/hooks/ci.ts`; T4 is a consumer only. The hooks must be available before T4 can compile — T4 depends on T3 for the hooks file. If running truly in parallel, mock the hooks in T4's tests and verify the import resolves before compiling.
  - `client/src/vendor/ui/nav.ts` is owned by T4, not T3 — T3 does not add the nav entry. The CI tab lives in the agent editor which is already in the nav via the `agents` entry.
  - The CI Runs page is NOT under `/repos/:repoId` — it is a top-level route `/ci-runs` (cross-repo). The nav `href` must be `/ci-runs`, not scoped to a repo.
  - `activeKeyFor` in `client/src/components/app-shell/helpers.ts` already returns `"ci-runs"` for paths starting with `/ci-runs` — no change needed there.

---

### T5 — Server module registry · type: backend · covers: (integration gate)

- **Owned paths**:
  - `server/src/modules/index.ts`

- **Skills (mandatory)**: `onion-architecture`, `fastify-best-practices`

- **Task**: Add `import ci from './ci/routes.js'` and `ci` entry to the `modules` record in `server/src/modules/index.ts`. This is a two-line change after all other tasks are complete. Verify the import path matches the file produced by T2.

- **Acceptance**:
  - `server/src/modules/index.ts` imports and registers the `ci` module
  - `cd server && pnpm tsc --noEmit` green after T1 + T2 land

- **Depends-on**: T1, T2 (module file must exist before the import compiles)

- **Red flags**:
  - Import must use `.js` extension per server ESM convention: `import ci from './ci/routes.js'`
  - The `eval` module import used an alias (`eval_`) because `eval` is a reserved word — `ci` has no such conflict

---

## Test intents

What must be tested — statements, not tasks. The `impl` skill consumes this section for the manual checklist while `test-writer` is disabled.

- R1 → surface: client (component test) → `ExportWizard.test.tsx`: GHA target enables Continue; non-GHA targets disabled with "coming soon"; blank repo field prevents Continue navigation
- R2 → surface: client (component test) + server-it → `ExportWizard.test.tsx`: all five file types present in preview, workflow in editable textarea; `ci.it.test.ts`: manifest YAML fields match seeded agent
- R3 → surface: client (component test) → `ExportWizard.test.tsx`: `opened`/`synchronize` checked+disabled; `reopened` optional; `DEVDIGEST_POST_AS` in workflow yaml; `post_as` absent from manifest YAML
- R4 → surface: server-it → `ci.it.test.ts`: open_pr path creates installation + PR URL; idempotent re-export; files path → zip + no installation row; GitHub error → 502 + no installation row
- R5 → surface: server-unit → `workflow.test.ts`: permissions exact; Secrets expression for API key; fork guard present; no `issue_comment`
- R6 → surface: server-unit → `manifest.test.ts`: round-trip safeParse; agent-runner `manifest.test.ts`: missing `model` → RunnerError (already exists in agent-runner; verify it covers the AC)
- R7 → surface: client (component test) → `CiRunsPage.test.tsx`: all columns render; empty state; filter change updates query params
- R8 → surface: server-it + client (component test) → `ci.it.test.ts`: sync creates ci_runs row; invalid artifact skipped; rate-limit → 502 + partial commit; `CiRunsPage.test.tsx`: refetchInterval ≤ 60 000 ms
- R9 → surface: client (component test) + server-it → `CiTab.test.tsx`: installation list; empty state + button; CI-run history; `ci.it.test.ts`: ci_fail_on PATCH + manifest round-trip (AC-29)
- R10 → surface: server-unit (agent-runner) → `run.test.ts` + `diff.test.ts` already exist; verify they cover AC-31/32 without change (these are in-scope for verification, not new test writing)
- R11 → surface: server-it → `ci.it.test.ts`: run migrations on fresh testcontainer; assert six new columns; ingest fixture populates them
- R12 → surface: server-it + manual → `ci.it.test.ts`: grep assertion: no `@octokit` import in `server/src/modules/ci/`; mock `GitHubClient` covers listWorkflowRuns/downloadArtifact

---

## Sequencing & risks

### Task DAG topological order

**Wave 1 (no dependencies):**
- T1 — Shared foundation (contracts + DB schema + port extension)

**Wave 2 (depends on T1 only, run in parallel):**
- T2 — Server CI module (depends on T1)
- T3 — Client wizard + CI tab (depends on T1)
- T4 — Client CI Runs page (depends on T1; also imports hooks from T3 — if T3 and T4 run truly in parallel, T4's test mocks the hooks; production import resolves after T3 lands)

**Wave 3 (depends on T1 + T2):**
- T5 — Module registry (depends on T1 + T2)

### Parallel opportunities

T2, T3, and T4 can all start as soon as T1 is committed. T3 and T4 share no owned files. T2 and T3 share no owned files. T2 and T4 share no owned files. T5 is a single two-line commit that gates on T2.

### Decisions needing human confirmation

- The `CiExport` Zod schema has `installation: CiInstallation` (non-nullable). For `action='files'` the spec says no installation is persisted and the response shape should allow a null installation. The implementer in T2 must update this field to `CiInstallation.nullable()` in the contract (server + client mirror). This is a contract change — flag for review.
- The `agent-runner/dist/index.js` bundle does not yet exist. The export bundle cannot embed it until `npm run build` is run in `agent-runner/`. Decide whether the build step is: (a) a pre-requisite that the developer must run manually before the CI module is tested, (b) checked into the repo as a binary, or (c) generated at export time by the server. The current spec implies (b) or (a) — the plan assumes (a): the developer runs `npm run build` in `agent-runner/`, producing `dist/index.js`, before testing the export endpoint. The CI module degrades gracefully when the file is absent.
- The deduplication unique constraint on `(ci_installation_id, github_run_id)` in `ci_runs` is needed for idempotent sync. T1 must add this to the Drizzle schema and the generated migration. Confirm with T1 implementer.

### Migrations

The migration produced by `pnpm db:generate` in `server/` (during T1) must be committed alongside the schema change. After all tasks complete, the developer must run `pnpm db:migrate` manually (never on boot). The migration is purely additive and safe to apply to an existing `ci_runs` table.

---

## Verification per task/step

**T1:**
```bash
# Server typecheck
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/server && pnpm tsc --noEmit
# Client typecheck
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/client && pnpm tsc --noEmit
```
Green condition: no TypeScript errors in server or client after schema + contracts + adapter changes.

**T2:**
```bash
# Run hermetic unit tests (workflow + manifest generators)
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/server && pnpm exec vitest run src/modules/ci/generators/
# Run DB-backed integration tests (requires Docker)
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/server && pnpm exec vitest run src/modules/ci/ci.it.test.ts
# Server typecheck
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/server && pnpm tsc --noEmit
```
Green condition: all hermetic + integration tests pass; typecheck clean; no `@octokit` import in `server/src/modules/ci/`.

**T3:**
```bash
# Run component tests
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/client && pnpm exec vitest run src/app/agents/\[id\]/_components/AgentEditor/_components/CiTab/
# Client typecheck
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/client && pnpm tsc --noEmit
```
Green condition: `ExportWizard.test.tsx` and `CiTab.test.tsx` pass; typecheck clean.

**T4:**
```bash
# Run component tests
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/client && pnpm exec vitest run src/app/ci-runs/
# Client typecheck
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/client && pnpm tsc --noEmit
```
Green condition: `CiRunsPage.test.tsx` passes; typecheck clean; nav entry present in `nav.ts`.

**T5:**
```bash
# Server typecheck (catches bad import)
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/server && pnpm tsc --noEmit
```
Green condition: no TypeScript error on the new import in `modules/index.ts`; server starts (`pnpm dev` in `server/`).

**Cross-task gate (run after all tasks):**
```bash
# Full server typecheck + existing tests
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/server && pnpm tsc --noEmit
# Full client typecheck
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/client && pnpm tsc --noEmit
# agent-runner typecheck (AC-18/19 — runner invariants unchanged)
cd /Users/admin/emdash/worktrees/dev-digest/emdash/export-to-ci-6doag/agent-runner && npm run typecheck
```
