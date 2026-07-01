# Implementation Plan: project-context

**Spec:** SPEC-01 (`specs/SPEC-01-2026-07-project-context-folder.md`)

## Overview

Discover Markdown files (under `specs/`, `docs/`, `insights/` directory segments) in connected repository clones and surface them as a browsable Project Context library. Users attach discovered docs to agents (ordered) or skills (unordered); at run time the contents are injected into the existing `## Project context` prompt slot via `wrapUntrusted`/`INJECTION_GUARD`, and the paths are recorded in `specs_read` on the run trace.

## Execution mode: multi-agent

Ten parallel `implementer` instances across four dependency waves.

## Requirements

| ID | Covers AC | Requirement | Acceptance criteria (measurable) |
|---|---|---|---|
| R1 | AC-1, AC-2, AC-3 | Discover `.md` files whose path contains a `specs`, `docs`, or `insights` directory segment in every repo clone in the workspace | Discovery returns `{ relative_path, category }[]`; returns empty array — no throw — when clone path is null or does not exist on disk; zero LLM calls during discovery |
| R2 | AC-4, AC-5, AC-6 | Project Context library page shows all workspace docs with category badge, agent-count chip, and inline Preview pane | Docs list renders relative path + category badge + agent_count chip; selecting a row renders file markdown in Preview; empty-state message renders when no repos have a valid clone path; no error boundary triggered |
| R3 | AC-7, AC-8, AC-9, AC-10 | Agent Context tab: ordered checkbox list of all workspace docs, drag-to-reorder for attached docs, persisted state, and token estimate | Each row shows drag handle (attached only), checkbox, relative path, category badge, Preview control; checkbox toggle persists immediately; drag reorder persists new order; footer shows ⌈chars÷4⌉ token estimate with `## Project context` slot label |
| R4 | AC-11, AC-12, AC-13 | Skill Context section: flat checkbox list with path filter, persisted state, and "SERIALIZES AS" prompt hint | All workspace docs listed with checkboxes and a filter input; toggle persists; "SERIALIZES AS" block shows the `## Project context` heading and the list of attached relative paths |
| R5 | AC-14, AC-15, AC-16, AC-17 | At run time collect attached docs from clone disk, wrap each as untrusted, inject into `## Project context`; skip missing or empty files gracefully | Contents passed as `specs[]`; each wrapped in `<untrusted source="spec-N">…</untrusted>`; missing path logged as `warn` in run log and absent from `specs_read`; 0-byte files skipped silently (no log, no block); zero new LLM calls |
| R6 | AC-18, AC-19 | Persist injected doc paths in `specs_read` and display them in the trace drawer | `specs_read` in the persisted trace contains relative paths in injection order; `TraceBody` already renders this field — no client change needed for AC-19 once R6 (server) is done |
| R7 | AC-20 | Reject attachment lists with paths outside the workspace's currently discovered set | PUT `/agents/:id/context-docs` and PUT `/skills/:id/context-docs` return HTTP 400 when any submitted `(repo_id, path)` pair is absent from the discovered set; no partial persistence |

### Descoped ACs

None — all 20 ACs are covered above.

### Open recommendations

None — approved spec, fast-path rules applied.

## Affected packages / modules

- **server** — new `workspace/discovery.ts`, `workspace/service.ts`, `workspace/repository.ts`; extend `workspace/routes.ts`, `agents/routes.ts`, `agents/service.ts`, `agents/repository.ts`, `skills/routes.ts`, `skills/service.ts`, `skills/repository.ts`, `reviews/run-executor.ts`; new DB tables in `db/schema/agents.ts` and `db/schema/skills.ts` + generated migration
- **shared (dual-vendored)** — new `contracts/context-docs.ts` in both `server/src/vendor/shared` and `client/src/vendor/shared`, exported from both barrels
- **client** — new `/context-docs` page; new `AgentEditor/ContextTab`; extended `SkillEditor`; new hooks file; extended nav; new i18n namespace `contextDocs.json`

---

## Tasks (parallel units)

Each task = one `implementer` instance, running in the same shared working tree.
Owned paths across tasks are disjoint — no file appears in two tasks.

---

### T1 — DB Schema · type: backend · covers: R1, R3, R4, R5, R7

- **Owned paths**:
  - `server/src/db/schema/agents.ts`
  - `server/src/db/schema/skills.ts`
  - `server/src/db/migrations/<timestamp>_context_docs.sql` (generated)
- **Skills (mandatory)**: `drizzle-orm-patterns`, `postgresql-table-design`
- **Task**: Add two Drizzle join tables.

  **In `schema/agents.ts`** (follow the `agentSkills` pattern at lines 51–63; add `repos` import for FK):
  ```ts
  export const agentContextDocs = pgTable(
    'agent_context_docs',
    {
      agentId: uuid('agent_id')
        .notNull()
        .references(() => agents.id, { onDelete: 'cascade' }),
      repoId: uuid('repo_id')
        .notNull()
        .references(() => repos.id, { onDelete: 'cascade' }),
      relativePath: text('relative_path').notNull(),
      order: integer('order').notNull().default(0),
    },
    (t) => ({
      pk: primaryKey({ columns: [t.agentId, t.repoId, t.relativePath] }),
      agentIdx: index('agent_context_docs_agent_idx').on(t.agentId),
      repoPathIdx: index('agent_context_docs_repo_path_idx').on(t.repoId, t.relativePath),
    }),
  );
  ```

  **In `schema/skills.ts`** (add `repos` import for FK):
  ```ts
  export const skillContextDocs = pgTable(
    'skill_context_docs',
    {
      skillId: uuid('skill_id')
        .notNull()
        .references(() => skills.id, { onDelete: 'cascade' }),
      repoId: uuid('repo_id')
        .notNull()
        .references(() => repos.id, { onDelete: 'cascade' }),
      relativePath: text('relative_path').notNull(),
    },
    (t) => ({
      pk: primaryKey({ columns: [t.skillId, t.repoId, t.relativePath] }),
      skillIdx: index('skill_context_docs_skill_idx').on(t.skillId),
    }),
  );
  ```

  The `db/schema.ts` barrel already exports `./schema/agents` and `./schema/skills` — no barrel edit needed.

  Run `cd server && pnpm db:generate` to emit the migration SQL. Commit the generated `.sql` file. **Do NOT run `pnpm db:migrate`** (manual human step).

- **Acceptance**: `cd server && pnpm tsc --noEmit` passes; the generated migration SQL file is committed.
- **Depends-on**: none
- **Red flags**: PK is 3-column `(agentId, repoId, relativePath)` — wider than the 2-column `agentSkills` PK; don't omit `repoId`. The `repoPathIdx` on `(repoId, relativePath)` is required to make agent-count aggregation queries non-sequential. `pnpm db:migrate` is a human step, never run automatically.

---

### T2 — Shared Contracts · type: backend · covers: R1, R2, R3, R4, R5, R6, R7

- **Owned paths**:
  - `server/src/vendor/shared/contracts/context-docs.ts` (new)
  - `server/src/vendor/shared/index.ts`
  - `client/src/vendor/shared/contracts/context-docs.ts` (new — identical mirror)
  - `client/src/vendor/shared/index.ts`
- **Skills (mandatory)**: `zod`, `typescript-expert`
- **Task**: Create a new shared contract file and export it from both barrels.

  **`contracts/context-docs.ts`** (identical in both server and client vendor trees):
  ```ts
  import { z } from 'zod';

  export const ContextDocCategory = z.enum(['specs', 'docs', 'insights']);
  export type ContextDocCategory = z.infer<typeof ContextDocCategory>;

  export const ContextDoc = z.object({
    repo_id: z.string().uuid(),
    relative_path: z.string(),
    category: ContextDocCategory,
    agent_count: z.number().int().nonnegative(),
  });
  export type ContextDoc = z.infer<typeof ContextDoc>;

  export const AgentContextDoc = z.object({
    agent_id: z.string().uuid(),
    repo_id: z.string().uuid(),
    relative_path: z.string(),
    order: z.number().int().nonnegative(),
  });
  export type AgentContextDoc = z.infer<typeof AgentContextDoc>;

  export const SkillContextDoc = z.object({
    skill_id: z.string().uuid(),
    repo_id: z.string().uuid(),
    relative_path: z.string(),
  });
  export type SkillContextDoc = z.infer<typeof SkillContextDoc>;

  export const PutContextDocsBody = z.object({
    items: z.array(
      z.object({ path: z.string().min(1), repo_id: z.string().uuid() }),
    ),
  });
  export type PutContextDocsBody = z.infer<typeof PutContextDocsBody>;
  ```

  In `server/src/vendor/shared/index.ts`: append `export * from './contracts/context-docs.js';`
  In `client/src/vendor/shared/index.ts`: append `export * from './contracts/context-docs.js';`

- **Acceptance**: `cd server && pnpm tsc --noEmit` and `cd client && pnpm tsc --noEmit` both pass.
- **Depends-on**: none
- **Red flags**: The file must be **byte-for-byte identical** in both vendor trees — copy-paste, do not diverge. Both barrels use `.js` extension in the export statement even though the source is `.ts`. Do not edit any existing contract file — the barrel comment says "feature agents EXTEND with new files, they do not edit existing ones."

---

### T3 — Server Discovery + Workspace Routes · type: backend · covers: R1, R2, R7

- **Owned paths**:
  - `server/src/modules/workspace/discovery.ts` (new)
  - `server/src/modules/workspace/service.ts` (new)
  - `server/src/modules/workspace/repository.ts` (new)
  - `server/src/modules/workspace/routes.ts`
- **Skills (mandatory)**: `onion-architecture`, `fastify-best-practices`, `security`, `zod`
- **Task**:

  **`discovery.ts`** — a pure filesystem utility (no DB, no network). Exported function:
  ```ts
  export async function discoverContextDocs(
    repos: Array<{ repoId: string; clonePath: string | null }>,
  ): Promise<Array<{ repoId: string; relativePath: string; category: 'specs' | 'docs' | 'insights' }>>
  ```
  Implementation notes:
  - For each repo entry: skip if `clonePath` is null; skip if `!fs.existsSync(clonePath)` — return empty silently (AC-2).
  - Use `fsPromises.glob('**/{specs,docs,insights}/**/*.md', { cwd: clonePath })` — Node 23 native, no extra dependency.
  - Derive `category` from the **first** directory segment in the matched relative path that equals `specs`, `docs`, or `insights`.
  - **Security guard**: after the glob, verify each resolved path stays within `clonePath` using `path.resolve(clonePath, rel).startsWith(path.resolve(clonePath) + path.sep)`. Drop any that escape (defense against crafted filenames).
  - Node 23's `fs.promises.glob` does **not** follow symlinks by default — add a comment confirming this so reviewers don't silently "fix" it.

  **`repository.ts`** — one method:
  - `agentCountsForPaths(workspaceId, paths: Array<{repoId, relativePath}>)`: single GROUP BY query on `agentContextDocs` joined with `agents` (to scope by `workspaceId`) returning `Map<\`${repoId}:${relativePath}\`, number>`.

  **`service.ts`** — two methods:
  - `listForWorkspace(workspaceId)`: query repos table for the workspace, call `discoverContextDocs`, batch-fetch agent counts via repo, return `ContextDoc[]`.
  - `listForRepo(workspaceId, repoId)`: same but scoped to one repo (verify repoId belongs to workspace).
  - `preview(workspaceId, repoId, relativePath)`: (1) verify repo belongs to workspace; (2) call `discoverContextDocs([{ repoId, clonePath }])` to build valid set (whitelist); (3) if `relativePath` not in valid set → throw `NotFoundError`; (4) `fs.readFile(path.join(clonePath, relativePath), 'utf8')` → return `{ content }`.

  **`routes.ts`** — extend the existing single-route file with three new endpoints:
  ```
  GET /workspace/context-docs                          → service.listForWorkspace(workspaceId)
  GET /repos/:repoId/context-docs                      → service.listForRepo(workspaceId, repoId)
  GET /workspace/context-docs/preview?path=&repoId=   → service.preview(workspaceId, repoId, path)
  ```
  All handlers call `getContext(container, req)` first. The preview query string params are `path` (string, min 1) and `repoId` (string uuid) — validate with Zod.

- **Acceptance**: `cd server && pnpm tsc --noEmit` passes; hermetic unit test for `discoverContextDocs` with a temp dir passes; GET /workspace/context-docs returns a valid `ContextDoc[]` shape.
- **Depends-on**: T1, T2
- **Red flags**: The `agentCountsForPaths` repo method must be a single batch query — NOT one query per doc (N+1 kills performance at 10k-file repos). The `preview` endpoint must never read a file that is not in the discovered set — do the whitelist check BEFORE the `fs.readFile`. `discovery.ts` is a pure utility and is imported by agents/service.ts and skills/service.ts (T4, T5) — keep it side-effect-free.

---

### T4 — Server Agent Context Docs Routes · type: backend · covers: R3, R7

- **Owned paths**:
  - `server/src/modules/agents/routes.ts`
  - `server/src/modules/agents/service.ts`
  - `server/src/modules/agents/repository.ts`
- **Skills (mandatory)**: `onion-architecture`, `fastify-best-practices`, `zod`, `security`
- **Task**: Add two endpoints to the agents module.

  **`repository.ts`** — add:
  - `getContextDocs(agentId)`: SELECT from `agentContextDocs` WHERE `agentId = $1` ORDER BY `order` ASC → `AgentContextDoc[]`
  - `getContextDocPaths(agentId)`: same query but returns `Array<{repoId, relativePath, order}>` (for run-executor)
  - `replaceContextDocs(agentId, items: Array<{repoId, relativePath, order}>)`: in a single Drizzle transaction — DELETE all for agentId, then bulk INSERT; if items is empty the DELETE alone is correct.

  **`service.ts`** — add:
  - `getContextDocs(workspaceId, agentId)`: assert agent belongs to workspace, delegate to repo.
  - `replaceContextDocs(workspaceId, agentId, items: Array<{repoId: string; path: string}>)`:
    1. Assert agent belongs to workspace.
    2. Fetch repos for the workspace (query `repos` table via `this.db` or `this.container.db`).
    3. Call `discoverContextDocs(repos)` imported from `../../modules/workspace/discovery.js`.
    4. Build a valid-path set: `Set<\`${repoId}:${relativePath}\`>`.
    5. Validate every submitted item — if any `(repoId, path)` is absent from the set, throw `AppError(400, 'INVALID_CONTEXT_DOC_PATH', 'One or more paths are not in the discovered set')`.
    6. Call `repo.replaceContextDocs(agentId, items.map((it, i) => ({ repoId: it.repoId, relativePath: it.path, order: i })))`.

  **`routes.ts`** — add:
  ```
  GET /agents/:id/context-docs     → service.getContextDocs(workspaceId, id)
  PUT /agents/:id/context-docs     → service.replaceContextDocs(workspaceId, id, body.items)
  ```
  Validate PUT body with `PutContextDocsBody` from `@devdigest/shared`.

- **Acceptance**: `cd server && pnpm tsc --noEmit` passes; GET returns `AgentContextDoc[]`; PUT with a valid discovered path returns 200 and preserves order; PUT with `../../etc/passwd` returns 400 and leaves the previous list unchanged.
- **Depends-on**: T1, T2, T3
- **Red flags**: `replaceContextDocs` in repository must be **atomic** — delete + insert in one Drizzle transaction, never two separate awaits. The `order` value for each inserted row equals the item's **array index** in `items`. Import `discovery.ts` as a utility (not `WorkspaceService`) to avoid circular service-import issues.

---

### T5 — Server Skill Context Docs Routes · type: backend · covers: R4, R7

- **Owned paths**:
  - `server/src/modules/skills/routes.ts`
  - `server/src/modules/skills/service.ts`
  - `server/src/modules/skills/repository.ts`
- **Skills (mandatory)**: `onion-architecture`, `fastify-best-practices`, `zod`, `security`
- **Task**: Mirror of T4 for the skills module — no `order` column (skills attachments are unordered).

  **`repository.ts`** — add:
  - `getContextDocs(skillId)`: SELECT from `skillContextDocs` WHERE `skillId = $1` → `SkillContextDoc[]`
  - `getContextDocPaths(skillId)`: returns `Array<{repoId, relativePath}>`
  - `replaceContextDocs(skillId, items: Array<{repoId, relativePath}>)`: atomic delete + bulk INSERT.

  **`service.ts`** — add:
  - `getContextDocs(workspaceId, skillId)`: assert skill belongs to workspace, delegate.
  - `replaceContextDocs(workspaceId, skillId, items)`: same whitelist-validation pattern as T4 (import `discovery.ts`, build valid-path set, throw 400 on any mismatch), then repo.replaceContextDocs.

  **`routes.ts`** — add:
  ```
  GET /skills/:id/context-docs     → service.getContextDocs(workspaceId, id)
  PUT /skills/:id/context-docs     → service.replaceContextDocs(workspaceId, id, body.items)
  ```

- **Acceptance**: Same gate as T4 but under `/skills/:id/context-docs`; response shape is `SkillContextDoc[]` (no `order` field).
- **Depends-on**: T1, T2, T3
- **Red flags**: Same atomicity and whitelist rules as T4. No `order` in the Drizzle table or the returned DTO.

---

### T6 — Run-time Injection · type: backend · covers: R5, R6

- **Owned paths**:
  - `server/src/modules/reviews/run-executor.ts`
- **Skills (mandatory)**: `onion-architecture`, `typescript-expert`
- **Task**: After the linked-skills load (around line 203), add the context-doc collection step before the `reviewPullRequest` call:

  1. **Load agent docs**: call a new method `this.agents.getContextDocPaths(agent.id)` → `Array<{repoId, relativePath, order}>` sorted by order.
  2. **Load skill docs**: for each skill in `activeSkills`, call the skills repository/service (accessible via `this.container`) → `Array<{repoId, relativePath}>`. Inject through the Container using the skills service already available there, or add a `getContextDocPaths` method to `SkillsRepository` (owned by T5) and call it directly here.
  3. **Merge + deduplicate**: agent docs first (in order), then skill docs in skill-link order. Dedup by `\`${repoId}:${relativePath}\`` keeping the first (agent-level) occurrence.
  4. **Resolve clone paths**: query the `repos` table once for all unique `repoId`s in the merged list — single batch query, not per-doc.
  5. **Read files**: for each doc in merge order:
     - If `clonePath` is null or `!fs.existsSync(path.join(clonePath, relativePath))`: `runLog.warn(\`Context doc missing: \${relativePath}\`)` → skip; omit from `specs_read`.
     - If file is 0 bytes: skip **silently** (no log entry, no empty block) — omit from `specs_read`.
     - Otherwise: `await fs.readFile(path.join(clonePath, relativePath), 'utf8')` → collect content.
  6. **Pass to engine**: spread `...(specsContents.length > 0 ? { specs: specsContents } : {})` into the `reviewPullRequest({…})` call (join existing spread pattern around line 253). `PromptParts.specs?: string[]` already exists in `reviewer-core/src/prompt.ts:47` — no reviewer-core change.
  7. **Populate trace**: set `specs_read: specsReadPaths` in the trace object at line ~343 and line ~520 (the traceFromBuffer helper). `TraceBody` already renders `specs_read` — AC-19 is satisfied automatically.

- **Acceptance**: `cd server && pnpm tsc --noEmit` passes; existing run-executor tests pass: `pnpm exec vitest run src/modules/reviews`.
- **Depends-on**: T4, T5
- **Red flags**: Do NOT introduce LLM calls or any network request. The 0-byte file case must be silently skipped with no `runLog` entry and no `<untrusted>` block. The `specs_read` field must be populated in **both** the main success trace (line ~343) and the `traceFromBuffer` helper (line ~520) to cover the failure/cancel path too. Use Node's `fs.promises.readFile` (already an ESM import in this file) — do not add a new dependency.

---

### T7 — Client TanStack Query Hooks · type: ui · covers: R2, R3, R4

- **Owned paths**:
  - `client/src/lib/hooks/context-docs.ts` (new)
  - `client/src/lib/hooks/index.ts`
- **Skills (mandatory)**: `react-best-practices`, `frontend-architecture`, `typescript-expert`
- **Task**: Add a new hooks file following the pattern of `client/src/lib/hooks/skills.ts`. Export from `index.ts`.

  Hooks to implement in `context-docs.ts`:
  - `useWorkspaceContextDocs()` — `useQuery({ queryKey: ['workspace-context-docs'], queryFn: () => api.get<ContextDoc[]>('/workspace/context-docs') })`
  - `useContextDocPreview(repoId: string | null, path: string | null)` — GET `/workspace/context-docs/preview?repoId=…&path=…`; `enabled: !!repoId && !!path`
  - `useAgentContextDocs(agentId: string)` — GET `/agents/${agentId}/context-docs` → `AgentContextDoc[]`
  - `useSetAgentContextDocs(agentId: string)` — PUT mutation; on success `invalidateQueries(['agent-context-docs', agentId])` AND `invalidateQueries(['workspace-context-docs'])` (so agent_count chips refresh)
  - `useSkillContextDocs(skillId: string)` — GET `/skills/${skillId}/context-docs` → `SkillContextDoc[]`
  - `useSetSkillContextDocs(skillId: string)` — PUT mutation; on success invalidate `['skill-context-docs', skillId]` AND `['workspace-context-docs']`

  In `index.ts`: append `export * from './context-docs';`

- **Acceptance**: `cd client && pnpm tsc --noEmit` passes; all six hooks are importable from `@/lib/hooks`.
- **Depends-on**: T2
- **Red flags**: All mutations must invalidate `workspace-context-docs` — without this, the `agent_count` chips on the Project Context page go stale after an attachment change. Use `api.get` / `api.put` from `@/services/api` — never raw `fetch`. Import types from `@devdigest/shared`.

---

### T8 — Client Project Context Page · type: ui · covers: R2

- **Owned paths**:
  - `client/src/app/context-docs/page.tsx` (new)
  - `client/src/app/context-docs/_components/ContextDocsList/ContextDocsList.tsx` (new)
  - `client/src/app/context-docs/_components/ContextDocsList/index.ts` (new)
  - `client/src/app/context-docs/_components/ContextDocsPreview/ContextDocsPreview.tsx` (new)
  - `client/src/app/context-docs/_components/ContextDocsPreview/index.ts` (new)
  - `client/src/vendor/ui/nav.ts`
  - `client/messages/en/contextDocs.json` (new)
- **Skills (mandatory)**: `react-best-practices`, `next-best-practices`, `frontend-architecture`, `typescript-expert`
- **Task**:

  **`nav.ts`** — Add to the WORKSPACE section (current items: `p`, `c`, `a`; SKILLS LAB has `k`; settings has `,`):
  ```ts
  { key: "context-docs", label: "Project Context", icon: "FileText", href: "/context-docs", gKey: "x" },
  ```
  Verify `x` is not claimed in `client/src/components/app-shell/hooks/useGlobalShortcuts.ts` before using it; pick a different letter if conflicted.

  **`page.tsx`** — thin Next.js page; `"use client"` delegated to feature components. Side-by-side layout: `ContextDocsList` (left ~40%) + `ContextDocsPreview` (right ~60%). Selected doc state managed here via `useState<{repoId: string; path: string} | null>(null)`.

  **`ContextDocsList`** — `useWorkspaceContextDocs()`; renders a scrollable list with one row per doc:
  - relative path in monospace
  - category badge (distinct color: `specs` → blue, `docs` → green, `insights` → amber — use `@devdigest/ui` Badge)
  - "Used by N agents" chip (agent_count)
  - Row click → sets selected doc
  Empty-state: when `data` is empty or `data.length === 0`, render the i18n empty-state message. Do NOT render an error boundary — show empty state instead (AC-6).

  **`ContextDocsPreview`** — `useContextDocPreview(selected?.repoId, selected?.path)`; show `<Skeleton>` while loading; render `<Markdown content={data.content} />` from `@devdigest/ui` when available; show nothing when no doc is selected.

  **`contextDocs.json`** — strings: page title, list heading, empty-state title + body, badge labels, preview placeholder, etc. Use `useTranslations("contextDocs")` — **not** `"context"` (that namespace belongs to repo-intel).

- **Acceptance**: `cd client && pnpm tsc --noEmit` passes; `/context-docs` loads without error; doc rows appear when a repo clone has matching `.md` files; clicking a row populates the Preview pane.
- **Depends-on**: T7
- **Red flags**: Do NOT touch or read `client/messages/en/context.json` — it is used by the repo-intel feature and is unrelated. Never hardcode English strings in JSX. The `gKey` for the nav entry must be verified against `useGlobalShortcuts.ts` to avoid shortcut collision.

---

### T9 — Agent Context Tab · type: ui · covers: R3

- **Owned paths**:
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/index.ts` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`
  - `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`
  - `client/messages/en/agents.json`
- **Skills (mandatory)**: `react-best-practices`, `next-best-practices`, `frontend-architecture`, `typescript-expert`
- **Task**: Model `ContextTab.tsx` closely on `SkillsTab.tsx` (same DnD kit, same checkbox pattern).

  **Data**: `useWorkspaceContextDocs()` → all docs. `useAgentContextDocs(agent.id)` → attached subset as an ordered list. `useSetAgentContextDocs(agent.id)` → persist mutation.

  **Layout** (per AC-7):
  - Attached docs (ordered) rendered in the drag list; each row: drag handle, checkbox (checked), relative path (monospace), category badge, Preview toggle.
  - Unattached docs float below (alphabetical by `relative_path`); each row: no drag handle, checkbox (unchecked), path, badge, Preview toggle.
  - Preview toggle: inline expand of `useContextDocPreview(doc.repoId, doc.relativePath)` rendered as `<Markdown>`.

  **Checkbox toggle** (AC-8): build a new `AgentContextDoc[]` — if doc was unattached, append at end of current order; if attached, remove. Call `useSetAgentContextDocs` mutation with `{ items: newList.map(d => ({ path: d.relative_path, repo_id: d.repo_id })) }`. Always send the **full** list (not a delta).

  **Drag end** (AC-9): `arrayMove` the attached list, call the same mutation.

  **Footer** (AC-10): `⌈totalChars / 4⌉` tokens, where `totalChars` = sum of attached doc content lengths fetched via `useContextDocPreview`. Label: `"## Project context"`. Show label string verbatim (i18n-escaped).

  **Keyboard DnD** (spec Non-functional a11y): include both `PointerSensor` and `KeyboardSensor` from `@dnd-kit/core`.

  **`constants.ts`**: add `{ key: "context", labelKey: "editor.tabs.context", icon: "FileText" }` to `TABS`.

  **`AgentEditor.tsx`**: import `ContextTab`; in the tab-body switch add `tab === "context" ? <ContextTab key={agent.id} agent={agent} /> : …`.

  **`agents.json`**: add keys for `editor.tabs.context`, empty-state copy, "N of M attached" chip label, token-estimate footer label.

- **Acceptance**: `cd client && pnpm tsc --noEmit` passes; Context tab visible in agent editor between Skills and (future) tabs; checkbox toggle and drag reorder both update GET /agents/:id/context-docs response.
- **Depends-on**: T7
- **Red flags**: Must include `KeyboardSensor` for a11y (spec Non-functional). Always send the full ordered list on every mutation — the PUT endpoint replaces the entire list. The `key={agent.id}` pattern in AgentEditor already handles state reset on agent switch.

---

### T10 — Skill Context Section · type: ui · covers: R4

- **Owned paths**:
  - `client/src/app/skills/_components/SkillEditor/SkillEditor.tsx`
  - `client/messages/en/skills.json`
- **Skills (mandatory)**: `react-best-practices`, `frontend-architecture`, `typescript-expert`
- **Task**: Extend `SkillEditor.tsx` with a new "Context docs" section below the existing form fields. Extract a `SkillContextSection` sub-component within the same file (or a sibling file if it grows large) to keep SkillEditor readable.

  **Section content** (AC-11):
  - Heading: "Context docs" with a count chip "N attached"
  - Filter text input (client-side; narrows list by `relative_path.includes(filter)` — no new API call)
  - Filtered checkbox list: `useWorkspaceContextDocs()` for all docs; `useSkillContextDocs(skill.id)` for attached subset; each row: checkbox, relative path, category badge
  - No drag handles — skills attachments are unordered

  **Checkbox toggle** (AC-12): call `useSetSkillContextDocs(skill.id)` with the new flat set `{ items: newAttached.map(d => ({ path: d.relative_path, repo_id: d.repo_id })) }`. Always send full list.

  **"SERIALIZES AS" block** (AC-13): a pre-formatted block below the list showing:
  ```
  ## Project context
  • specs/api-contract.md
  • docs/architecture.md
  ```
  Derived purely from the currently attached list — no extra API call. Label text comes from i18n.

  **`skills.json`**: add keys for context-section heading, filter placeholder, "N attached" chip, serializes-as label, empty state.

- **Acceptance**: `cd client && pnpm tsc --noEmit` passes; Context section visible in the skill editor; filter narrows the displayed doc list; toggling a checkbox updates GET /skills/:id/context-docs; "SERIALIZES AS" block reflects the current attached set.
- **Depends-on**: T7
- **Red flags**: The "SERIALIZES AS" preview is client-side derived text only — do NOT make an API call to render it. Keep the `SkillEditor.tsx` file manageable by extracting to a `SkillContextSection` component if needed. Send the full attachment list on every mutation.

---

## Test intents

What must be tested — statements, not tasks. While `test-writer` is disabled these land in the run's manual checklist.

- **R1** → **server-unit** (hermetic): create a temp dir with `.md` files at multiple depths under `specs/`, `docs/`, `insights/`; call `discoverContextDocs` directly; assert returned relative paths and categories match. Call with a non-existent path; assert empty array returned, no exception (AC-2). Spy on LLM adapter; assert zero calls (AC-3).
- **R2** → **e2e**: seed a workspace repo with a cloned path containing `.md` files; open `/context-docs`; assert doc rows appear with path, badge, and agent-count chip (AC-4). Click a doc row; assert Preview pane renders the markdown content (AC-5). Workspace with no cloned repos: assert empty-state element visible, no error boundary (AC-6).
- **R3** → **e2e**: open agent editor → Context tab; assert rows show drag handle (attached), checkbox, path, badge, Preview control (AC-7). Toggle a checkbox; assert "N of M" chip updates and GET /agents/:id/context-docs echoes the change (AC-8). Drag a doc to a new position; assert GET /agents/:id/context-docs returns the new order (AC-9). Attach docs of known byte count; assert token estimate = ⌈chars÷4⌉ (AC-10).
- **R4** → **e2e**: open skill editor → Context section; assert all workspace docs listed with checkboxes and filter input visible (AC-11). Toggle a checkbox; assert GET /skills/:id/context-docs echoes the update (AC-12). **manual**: attach a doc to a skill; assert "SERIALIZES AS" preview block shows `## Project context` label and the attached relative path (AC-13).
- **R5** → **server-it** (`*.it.test.ts`): seed a repo clone dir with a known `.md` file; create an agent with that path attached; trigger a run (mocked LLM); assert (a) `specs` argument to `assemblePrompt` contains the expected content (AC-14) and (b) the user message contains `<untrusted source="spec-0">…</untrusted>` wrapping (AC-15). Run with an attached path absent from the clone; assert run completes, `specs_read` is empty, run log has a `warn` entry for the missing path (AC-16). Spy on LLM adapter; assert call count equals equivalent run without context docs (AC-17).
- **R6** → **server-it**: after a run with injected docs, read the persisted trace; assert `specs_read` contains relative paths in injection order (AC-18). **manual (or e2e)**: open trace drawer for a completed run with non-empty `specs_read`; assert paths are visible in the Configuration section — TraceBody already renders this field, no new client code needed (AC-19).
- **R7** → **server-it**: PUT `/agents/:id/context-docs` with body containing `../../etc/passwd` as path; assert HTTP 400 and that the previously saved attachment list is unchanged (AC-20). Repeat for `/skills/:id/context-docs`.

---

## Sequencing & risks

**Topological order — four waves:**

```
Wave 1 (parallel):  T1, T2
Wave 2 (parallel):  T3, T7          — T3: needs T1+T2; T7: needs T2
Wave 3 (parallel):  T4, T5, T8, T9, T10  — T4+T5: need T1+T2+T3; T8+T9+T10: need T7
Wave 4 (parallel):  T6              — needs T4+T5
```

**Critical path:** T1 → T3 → T4 → T6 (backend) or T2 → T7 → T9 (UI). Both are ~4 waves.

**Human confirmation required:**
- `cd server && pnpm db:migrate` must be run manually after T1 commits the migration — never automated, never on boot.
- Apply the migration to a running Postgres instance before running integration tests in Wave 3+.
- Verify the `gKey: "x"` nav shortcut does not conflict with any key in `client/src/components/app-shell/hooks/useGlobalShortcuts.ts` before T8 merges; adjust the letter if needed.

**Risks and mitigation:**
- **Symlink traversal (security)**: Node 23 `fs.promises.glob` does not follow symlinks by default. T3 must add a `path.resolve`-containment check as defense-in-depth and document it with a comment so reviewers don't remove it.
- **Agent_count N+1**: T3's repository must produce a single `GROUP BY` aggregation query. A per-doc lookup on a 10 k-file repo would time out.
- **Discovery performance**: the glob pattern is selective (only `**/{specs,docs,insights}/**/*.md`), so even a 10 k-file repo should complete well under 2s. If measured otherwise, a per-repo memoized cache (keyed on `repoId + clone mtime`) is the opt-in mitigation — not mandatory per spec.
- **AC-19 pre-implemented**: `TraceBody.tsx` already renders `specs_read` chips in the Configuration section. T6 populating `specs_read` in the server trace object automatically satisfies AC-19 with zero client changes. Do not add duplicate rendering.
- **context.json namespace collision**: `messages/en/context.json` is live and owned by the repo-intel feature. T8 must use the new `contextDocs.json` namespace throughout and never touch the existing file.
- **Deduplication edge case (AC-14)**: when a doc is attached both directly to the agent and via a linked skill, it must be injected exactly once, at its first (agent-level) position. T6 must implement this dedup before the file-read loop.

---

## Verification per task

- **T1**: `cd server && pnpm tsc --noEmit` — zero errors; migration `.sql` file present in `server/src/db/migrations/`
- **T2**: `cd server && pnpm tsc --noEmit` + `cd client && pnpm tsc --noEmit` — zero errors in both packages
- **T3**: `cd server && pnpm tsc --noEmit` — zero errors; hermetic unit test for `discoverContextDocs` passes: `pnpm exec vitest run src/modules/workspace`
- **T4**: `cd server && pnpm tsc --noEmit` — zero errors; `pnpm exec vitest run src/modules/agents`
- **T5**: `cd server && pnpm tsc --noEmit` — zero errors; `pnpm exec vitest run src/modules/skills`
- **T6**: `cd server && pnpm tsc --noEmit` — zero errors; `pnpm exec vitest run src/modules/reviews`
- **T7**: `cd client && pnpm tsc --noEmit` — zero errors
- **T8**: `cd client && pnpm tsc --noEmit` — zero errors; `/context-docs` page loads in browser without hydration error or error boundary
- **T9**: `cd client && pnpm tsc --noEmit` — zero errors; "Context" tab visible in agent editor
- **T10**: `cd client && pnpm tsc --noEmit` — zero errors; Context section visible in skill editor
