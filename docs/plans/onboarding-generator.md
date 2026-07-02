# Implementation Plan: onboarding-generator

**Spec:** SPEC-02 (`specs/SPEC-02-2026-07-onboarding-generator.md`)

## Overview

Convert DevDigest's pre-computed repo-intel facts (import graph, PageRank-scored
file list, dependency chains) into a five-section onboarding tour via a single
structured LLM call, persist it per `(repo_id, workspace_id)`, and surface it on
`/repos/:repoId/onboarding-tour` with honest-provenance badges and on-demand
regeneration. The feature reuses every existing adapter — `repoIntel` facade,
`resolveFeatureModel('onboarding')`, `wrapUntrusted`/`INJECTION_GUARD` — without
introducing any new external dependency.

## Execution mode: multi-agent

Five parallel `implementer` instances across three dependency waves.

## Requirements

| ID | Covers AC | Requirement | Acceptance criteria (measurable) |
|---|---|---|---|
| R1 | AC-1, AC-15 | Generate tour: gather facts from the repoIntel facade (`getIndexState`, `getRepoMap(budget)`, `getCriticalPaths`, `getTopFilesByRank`, `getFileRank`), wrap ALL repo-derived text with `wrapUntrusted` + include `INJECTION_GUARD` in the system message, make exactly **one** `llm.completeStructured` call, validate the five-section schema, persist the result as an upsert to `onboarding_tours(repo_id, workspace_id)` | POST /repos/:id/onboarding-tour/generate returns `{ tour: OnboardingTour, log: GenerationLog }` with `log.llm_calls === 1`; a row exists in `onboarding_tours` with all five non-empty sections |
| R2 | AC-2 | Persist generation metadata alongside sections | Persisted `onboarding_tours` row has non-null `generated_at`, `files_indexed`, and `index_status_at_generation` matching the `IndexState` captured immediately before the LLM call |
| R3 | AC-3 | Generation response log carries LLM telemetry | `log.model` non-empty string; `log.tokens_used = result.tokensIn + result.tokensOut > 0`; `log.duration_ms` is the wall-clock time for the `completeStructured` call |
| R4 | AC-4 | In-flight dedup prevents concurrent LLM calls | A second concurrent POST for the same `repoId` returns `{ status: "in_progress" }` without invoking the LLM adapter a second time |
| R5 | AC-5 | LLM schema failure preserves the existing tour | When `completeStructured` throws (including parse failures after retry), no UPSERT runs; the existing `onboarding_tours` row is unchanged; the route returns an error response |
| R6 | AC-6, AC-7, AC-8 | Tour page renders correctly in all three states | State A (tour exists): five section headings + subtitle "Generated from index of N files · last refreshed X ago" visible. State B (no tour, clone present): empty state + "Generate" CTA visible, no section headings. State C (no clone_path): error state directing user to clone, no Generate or Regenerate button |
| R7 | AC-9 | Reading path ordered by PageRank percentile descending | `reading_path` array stored and displayed in the order produced by `getTopFilesByRank()` (rank-descending, pure PageRank); never alphabetical or by date |
| R8 | AC-10, AC-11 | Incomplete-index badge shown/hidden from `index_status_at_generation` | Badge visible when value is `degraded`, `partial`, or `failed`; badge absent when value is `full` |
| R9 | AC-12 | Unverified-commands disclaimer on "How to run locally" | A visible disclaimer element is present within the How to Run Locally section on every rendered tour, regardless of content |
| R10 | AC-13 | Share link copies URL with accessible feedback | `navigator.clipboard.writeText(window.location.href)` on click; button provides visible text change to "Copied!" or equivalent toast that is accessible to screen readers |
| R11 | AC-14 | Regenerate overwrites and refreshes the tour | After Regenerate completes successfully, the `generated_at` in the subtitle is more recent than the pre-click value; both sections and subtitle update without a full page reload |

### Descoped ACs

None — all 15 ACs are covered above.

### Open recommendations

| # | Recommendation | Status |
|---|---|---|
| D1 | Architecture diagram in tour: the `MermaidDiagram` component exists at `client/src/components/mermaid-diagram/MermaidDiagram.tsx` but is NOT in vendored UI and no AC requires a visual diagram. The `architecture_overview` section is prose only. Adding a diagram would require an extra LLM field and violate the one-structured-call constraint. **Descoped.** | accepted (no AC) |
| D2 | Reading-path rank source: `getTopFilesByRank()` returns `string[]` (no raw PageRank). Use `getFileRank(repoId, topPaths)` → `FileRankRow[]` (field: `percentile`) as the stored `rank` number. The `getFileRank` call runs AFTER the ordered list is obtained, so it adds one extra DB query but the ordering is driven by the already-correct `getTopFilesByRank()` result. | accepted |
| D3 | `INJECTION_GUARD` export: the constant is `private const` in `reviewer-core/src/prompt.ts`. Add `export` and re-export from `reviewer-core/src/index.ts` so the onboarding service can import it from `@devdigest/reviewer-core` — single source of truth for the guard text. | accepted |
| D4 | Existing `onboarding` stub in `schema/context.ts` (single `repoId` PK, opaque `json` blob, no workspace scoping): leave it untouched. Add a NEW `onboarding_tours` table in the same file. The barrel import in `schema.ts` gets an extra entry for `onboardingTours`. | accepted |
| D5 | No-clone-path detection on the client: `Repo.clone_path` is part of the shared contract and available via `useActiveRepo()`. The client checks `activeRepo?.clone_path` to render State C proactively without a separate API call. The server also enforces this in the generate endpoint. | accepted |
| D6 | In-flight dedup: an in-memory `Set<string>` in the service instance, keyed by `repoId`. Viable because the server runs as a single process per the boot-reaper contract. `try/finally` guarantees cleanup. No DB status column needed. | accepted |

## Affected packages / modules

- **server** — new module `modules/onboarding-tours/` (`routes.ts`, `service.ts`, `repository.ts`); extend `modules/index.ts`; extend `db/schema/context.ts` with `onboarding_tours` table; extend `db/schema.ts` barrel; new migration
- **shared (dual-vendored)** — new `contracts/onboarding-tour.ts` in both `server/src/vendor/shared` and `client/src/vendor/shared`; both barrels updated
- **reviewer-core** — export `INJECTION_GUARD` from `src/prompt.ts`; re-export from `src/index.ts`
- **client** — new `lib/hooks/onboarding-tour.ts`; update `lib/hooks/index.ts`; update `vendor/ui/nav.ts`; new route `app/repos/[repoId]/onboarding-tour/page.tsx` + `_components/OnboardingTour/`; new `messages/en/onboardingTour.json`

---

## Tasks (parallel units)

Each task = one `implementer` instance, running in the same shared working tree.
Owned paths across tasks MUST be disjoint — no file appears in two tasks.

---

### T1 — DB Schema & Migration · type: backend · covers: R1, R2, R7

- **Owned paths**:
  - `server/src/db/schema/context.ts`
  - `server/src/db/schema.ts`
  - `server/src/db/migrations/<timestamp>_onboarding_tours.sql` (generated)

- **Skills (mandatory)**: `drizzle-orm-patterns`, `postgresql-table-design`

- **Task**: Add the `onboarding_tours` table to `server/src/db/schema/context.ts`.
  Place it after the existing `onboarding` stub (line 120). **Do NOT remove or
  alter the existing `onboarding` table** — it is referenced by the barrel and
  removing it would break the schema object.

  ```ts
  import { integer, uniqueIndex } from 'drizzle-orm/pg-core'; // add to existing import
  import { workspaces } from './core'; // already imported

  export const onboardingTours = pgTable(
    'onboarding_tours',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      repoId: uuid('repo_id')
        .notNull()
        .references(() => repos.id, { onDelete: 'cascade' }),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      /** { architecture_overview, critical_paths, how_to_run_locally, first_tasks } */
      sections: jsonb('sections').notNull(),
      /** { file, rank, description }[] ordered by rank DESC */
      readingPath: jsonb('reading_path').notNull(),
      generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
      filesIndexed: integer('files_indexed').notNull(),
      indexStatusAtGeneration: text('index_status_at_generation', {
        enum: ['full', 'partial', 'degraded', 'failed'],
      }).notNull(),
    },
    (t) => ({
      repoWsUq: uniqueIndex('onboarding_tours_repo_ws_uq').on(t.repoId, t.workspaceId),
      wsIdx: index('onboarding_tours_ws_idx').on(t.workspaceId),
    }),
  );
  ```

  In `server/src/db/schema.ts`:
  - Add `onboardingTours` to the import from `'./schema/context'`
  - Add `onboardingTours` to the `schema` object

  Run `cd /Users/admin/dev-digest/server && pnpm db:generate` to emit the
  migration SQL. Commit the generated `.sql` file. **Do NOT run `pnpm db:migrate`**
  (human confirmation step — see Sequencing section).

- **Acceptance**: `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` passes;
  generated migration `.sql` file is present in
  `server/src/db/migrations/`; `onboardingTours` appears in the `schema` object
  in `schema.ts`.

- **Depends-on**: none

- **Red flags**:
  - The `uniqueIndex` on `(repoId, workspaceId)` is the semantic key for "one tour per repo+workspace". The UUID `id` is the PK for FK cleanliness, consistent with other tables.
  - `sections` and `readingPath` are separate JSONB columns (not one opaque blob) so the repository can update only the sections or only the reading path independently.
  - Add `integer` and `uniqueIndex` to the existing Drizzle import at the top of `context.ts` — do not duplicate the import line.
  - `pnpm db:migrate` is a human step, never automated.

---

### T2 — Shared Contracts + INJECTION_GUARD Export · type: backend · covers: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11

- **Owned paths**:
  - `reviewer-core/src/prompt.ts`
  - `reviewer-core/src/index.ts`
  - `server/src/vendor/shared/contracts/onboarding-tour.ts` (new)
  - `server/src/vendor/shared/index.ts`
  - `client/src/vendor/shared/contracts/onboarding-tour.ts` (new — byte-for-byte identical)
  - `client/src/vendor/shared/index.ts`

- **Skills (mandatory)**: `zod`, `typescript-expert`

- **Task**:

  **`reviewer-core/src/prompt.ts`** — add `export` to the `INJECTION_GUARD` constant (line 16). Change:
  ```ts
  const INJECTION_GUARD =
  ```
  to:
  ```ts
  export const INJECTION_GUARD =
  ```

  **`reviewer-core/src/index.ts`** — add `INJECTION_GUARD` to the export block from `'./prompt.js'`:
  ```ts
  export {
    assemblePrompt,
    wrapUntrusted,
    INJECTION_GUARD,          // ← add this line
    type PromptParts,
    type AssembledPrompt,
  } from './prompt.js';
  ```

  **`contracts/onboarding-tour.ts`** (identical content in BOTH vendor trees):
  ```ts
  import { z } from 'zod';

  /**
   * Five-section schema expected from the LLM's structured call.
   * Server-internal (used in `completeStructured`); included here so it can be
   * imported by the service without reaching into reviewer-core internals.
   */
  export const TourLLMSchema = z.object({
    architecture_overview: z.string().min(1),
    critical_paths: z.string().min(1),
    how_to_run_locally: z.string().min(1),
    reading_path: z.array(
      z.object({ file: z.string().min(1), description: z.string().min(1) }),
    ),
    first_tasks: z.string().min(1),
  });
  export type TourLLMSchema = z.infer<typeof TourLLMSchema>;

  /** Four prose sections persisted in onboarding_tours.sections. */
  export const OnboardingTourSections = z.object({
    architecture_overview: z.string(),
    critical_paths: z.string(),
    how_to_run_locally: z.string(),
    first_tasks: z.string(),
  });
  export type OnboardingTourSections = z.infer<typeof OnboardingTourSections>;

  /** One entry in the rank-ordered reading path. */
  export const ReadingPathItem = z.object({
    file: z.string(),
    rank: z.number(),
    description: z.string(),
  });
  export type ReadingPathItem = z.infer<typeof ReadingPathItem>;

  /** Full tour DTO — returned by GET and embedded in the POST success response. */
  export const OnboardingTour = z.object({
    repo_id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    sections: OnboardingTourSections,
    reading_path: z.array(ReadingPathItem),
    generated_at: z.string(), // ISO 8601
    files_indexed: z.number().int().nonnegative(),
    index_status_at_generation: z.enum(['full', 'partial', 'degraded', 'failed']),
  });
  export type OnboardingTour = z.infer<typeof OnboardingTour>;

  /** Telemetry log included in the POST success response. */
  export const GenerationLog = z.object({
    llm_calls: z.literal(1),
    model: z.string().min(1),
    tokens_used: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
  });
  export type GenerationLog = z.infer<typeof GenerationLog>;
  ```

  In **both** `server/src/vendor/shared/index.ts` AND `client/src/vendor/shared/index.ts`, append:
  ```ts
  export * from './contracts/onboarding-tour.js';
  ```

- **Acceptance**: `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` passes;
  `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` passes;
  `cd /Users/admin/dev-digest/reviewer-core && npm run build` passes (typecheck only).

- **Depends-on**: none

- **Red flags**:
  - The two `onboarding-tour.ts` files **must be byte-for-byte identical**. Copy-paste; do not diverge.
  - Both barrels use `.js` suffix in the export statement (ESM requirement in the server tree; Next.js resolves it fine in the client tree) — this is the dual-vendored `.js` exception documented in `client/INSIGHTS.md`.
  - `INJECTION_GUARD` already exists in `@devdigest/shared → contracts/knowledge.ts` as... actually it does not; check `knowledge.ts` exports before assuming a name conflict. The existing `Onboarding`, `OnboardingSection`, `OnboardingLink` types in `knowledge.ts` are STALE STUBS — do NOT use them; the new `OnboardingTour` name is distinct and does not collide.
  - `reviewer-core` uses **npm** (not pnpm); the typecheck command is `npm run build` from `/Users/admin/dev-digest/reviewer-core`.

---

### T3 — Server Module: onboarding-tours · type: backend · covers: R1, R2, R3, R4, R5, R7

- **Owned paths**:
  - `server/src/modules/onboarding-tours/routes.ts` (new)
  - `server/src/modules/onboarding-tours/service.ts` (new)
  - `server/src/modules/onboarding-tours/repository.ts` (new)
  - `server/src/modules/index.ts`

- **Skills (mandatory)**: `onion-architecture`, `fastify-best-practices`, `zod`, `security`

- **Task**:

  **`repository.ts`** — reads and writes the `onboarding_tours` table:
  ```ts
  import { eq, and } from 'drizzle-orm';
  import type { Db } from '../../db/client.js';
  import * as schema from '../../db/schema.js';

  export class OnboardingTourRepository {
    constructor(private db: Db) {}

    async getTour(repoId: string, workspaceId: string) {
      const rows = await this.db
        .select()
        .from(schema.onboardingTours)
        .where(and(
          eq(schema.onboardingTours.repoId, repoId),
          eq(schema.onboardingTours.workspaceId, workspaceId),
        ))
        .limit(1);
      return rows[0] ?? null;
    }

    async upsertTour(data: {
      repoId: string; workspaceId: string;
      sections: unknown; readingPath: unknown;
      generatedAt: Date; filesIndexed: number;
      indexStatusAtGeneration: 'full' | 'partial' | 'degraded' | 'failed';
    }) {
      const rows = await this.db
        .insert(schema.onboardingTours)
        .values({ ...data })
        .onConflictDoUpdate({
          target: [schema.onboardingTours.repoId, schema.onboardingTours.workspaceId],
          set: {
            sections: data.sections,
            readingPath: data.readingPath,
            generatedAt: data.generatedAt,
            filesIndexed: data.filesIndexed,
            indexStatusAtGeneration: data.indexStatusAtGeneration,
          },
        })
        .returning();
      return rows[0];
    }
  }
  ```

  **`service.ts`** — business logic with in-flight dedup and the single structured LLM call:

  Key constants (module-scoped):
  ```ts
  const TOP_FILES_N = 20; // how many files to include in the reading path
  ```

  Key imports (with `.js` ESM suffixes):
  ```ts
  import { INJECTION_GUARD, wrapUntrusted } from '@devdigest/reviewer-core';
  import { TourLLMSchema, type OnboardingTour } from '@devdigest/shared';
  import { resolveFeatureModel } from '../settings/feature-models.js';
  import { DEFAULT_REPO_MAP_TOKEN_BUDGET } from '../repo-intel/constants.js';
  import { RepoRepository } from '../repos/repository.js';
  import { NotFoundError, ValidationError, ExternalServiceError } from '../../platform/errors.js';
  import { getContext } from '../_shared/context.js';  // for workspace auth in routes
  ```

  `OnboardingTourService` constructor takes `Container`. Maintains `private inFlight = new Set<string>()`.

  `getTour(workspaceId, repoId)` — delegate to repo; workspace auth via the routes (routes call `getContext` before calling service).

  `generateTour(workspaceId, repoId)` flow:
  1. Look up repo via `RepoRepository.getById(workspaceId, repoId)`; throw `NotFoundError` if absent.
  2. If `!repo.clonePath` → throw `ValidationError('Repository has no clone path — clone it first via Settings.')`.
  3. Check `this.inFlight.has(repoId)` → return `{ status: 'in_progress' as const }` immediately.
  4. `this.inFlight.add(repoId)`.
  5. Wrap in `try/finally { this.inFlight.delete(repoId) }`.
  6. Inside try: gather facts in parallel via `Promise.all`:
     - `this.container.repoIntel.getIndexState(repoId)`
     - `this.container.repoIntel.getRepoMap(repoId, DEFAULT_REPO_MAP_TOKEN_BUDGET)`
     - `this.container.repoIntel.getCriticalPaths(repoId)`
     - `this.container.repoIntel.getTopFilesByRank(repoId, TOP_FILES_N)`
  7. Call `this.container.repoIntel.getFileRank(repoId, topFiles)` → `FileRankRow[]` to get percentile per file. Build `rankMap: Map<string, number>` from `path → percentile`.
  8. `const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding')`.
  9. `const llm = await this.container.llm(provider)`.
  10. Build system prompt: `\`You are an expert technical writer producing a five-section developer onboarding tour. ${INJECTION_GUARD}\``.
  11. Build user message: join sections separated by `\n\n`:
      - `## Repository map\n${wrapUntrusted('repo-map', repoMapResult.text || '(no repo map available)')}`
      - `## Critical dependency chains\n${wrapUntrusted('critical-paths', criticalPaths.map(chain => chain.join(' → ')).join('\n') || '(no dependency paths indexed)')}`
      - `## Files ordered by code importance (rank descending)\n${wrapUntrusted('top-files', topFiles.join('\n') || '(no files indexed)')}`
      - Instruction: `'For reading_path: return exactly one entry per file listed under "Files ordered by code importance", in the same order, with a one-to-two sentence description of what each file does.'`
  12. `const startMs = Date.now()`.
  13. `const result = await llm.completeStructured({ model, schema: TourLLMSchema, schemaName: 'OnboardingTour', messages: [{role:'system',content:systemPrompt},{role:'user',content:userMsg}], maxTokens: 8000, maxRetries: 1 })`.
      If this throws (schema validation failed after retry), the `finally` block cleans `inFlight`; existing DB row is untouched; propagate error to the route handler.
  14. `const durationMs = Date.now() - startMs`.
  15. Assemble `readingPath`: map `topFiles` (already rank-descending) to `{ file, rank: rankMap.get(file) ?? 0, description: descMap.get(file) ?? '' }`. Build `descMap` from `result.data.reading_path`.
  16. `await this.repo.upsertTour({...})` with `generatedAt: new Date()`, `filesIndexed: indexState.filesIndexed`, `indexStatusAtGeneration: indexState.status`.
  17. Return `{ tour: toDTO(row), log: { llm_calls: 1, model: result.model, tokens_used: result.tokensIn + result.tokensOut, duration_ms: durationMs } }`.

  **`routes.ts`** — thin Fastify plugin:
  ```
  GET  /repos/:id/onboarding-tour
       → getContext → service.getTour(workspaceId, id)
       → 200 with OnboardingTour | 404 (NotFoundError for no tour or no repo)

  POST /repos/:id/onboarding-tour/generate
       → getContext → service.generateTour(workspaceId, id)
       → 200 with { tour: OnboardingTour, log: GenerationLog }
         OR { status: "in_progress" }
  ```
  Use `IdParams` from `modules/_shared/schemas.ts` for `:id`. Both routes call
  `getContext(app.container, req)` first. Rate limit for POST: leave at global
  `120/min` default; no per-route override.

  **`server/src/modules/index.ts`** — add one import and one entry:
  ```ts
  import onboardingTours from './onboarding-tours/routes.js';
  // ...
  export const modules: Record<string, FastifyPluginAsync> = {
    // existing entries …
    onboardingTours,
  };
  ```

- **Acceptance**:
  - `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` passes.
  - `curl -s -X POST http://localhost:3001/repos/<valid-repoId>/onboarding-tour/generate` with a valid workspace cookie returns `{ tour: {...}, log: { llm_calls: 1, model: "...", tokens_used: N, duration_ms: N } }`.
  - A second concurrent call while the first is running returns `{ status: "in_progress" }`.

- **Depends-on**: T1, T2

- **Red flags**:
  - `inFlight` is an instance-level `Set<string>`. The service is constructed once per app boot (via DI). Do not make it a global or module-level variable.
  - `completeStructured` throwing (after exhausting `maxRetries: 1`) must propagate upward WITHOUT running `upsertTour`. The `try/finally` only handles `inFlight.delete` — the route's global error handler converts the throw into an error response. This is how AC-5 is satisfied: no UPSERT ever runs on a validation failure.
  - `readingPath` ordering: `topFiles` from `getTopFilesByRank()` is already in rank-descending order. Map it to the result array preserving that order. Do NOT sort by `descMap` insertion order or alphabetically.
  - ESM imports: all internal server imports use `.js` suffix.
  - `DEFAULT_REPO_MAP_TOKEN_BUDGET` is in `../repo-intel/constants.js` (currently `1500` tokens).
  - `getFileRank` is on the `RepoIntel` interface; it is mock-testable and works on degraded indexes (returns `[]` → rankMap is empty → all ranks default to `0`).
  - The `ValidationError` for no-clone-path will translate to HTTP 422 via the global error handler (consistent with the server taxonomy — see root INSIGHTS.md re: AC-20 http-code note).

---

### T4 — Client TanStack Query Hooks + Nav Entry · type: ui · covers: R1, R4, R6, R11

- **Owned paths**:
  - `client/src/lib/hooks/onboarding-tour.ts` (new)
  - `client/src/lib/hooks/index.ts`
  - `client/src/vendor/ui/nav.ts`

- **Skills (mandatory)**: `react-best-practices`, `frontend-architecture`, `typescript-expert`

- **Task**:

  **`client/src/lib/hooks/onboarding-tour.ts`** — follow the `client/src/lib/hooks/conventions.ts` pattern:
  ```ts
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
  import { api } from '@/services/api';
  import type { OnboardingTour } from '@devdigest/shared';

  const QUERY_KEY = (repoId: string) => ['onboarding-tour', repoId] as const;

  /**
   * GET /repos/:repoId/onboarding-tour
   * Returns null when the server responds 404 (no tour yet) — per client error policy
   * (4xx stays silent, pages handle inline empty-state).
   */
  export function useOnboardingTour(repoId: string) {
    return useQuery({
      queryKey: QUERY_KEY(repoId),
      queryFn: async () => {
        try {
          return await api.get<OnboardingTour>(`/repos/${repoId}/onboarding-tour`);
        } catch (err: unknown) {
          if (err && typeof err === 'object' && 'status' in err && err.status === 404) {
            return null;
          }
          throw err;
        }
      },
      enabled: !!repoId,
      staleTime: 0, // always re-fetch on mount; tour content is large and infrequently updated
    });
  }

  /**
   * POST /repos/:repoId/onboarding-tour/generate
   * On success, invalidate the tour query so the page re-fetches the persisted tour.
   */
  export function useGenerateTour(repoId: string) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: () =>
        api.post<{ tour: OnboardingTour; log: unknown } | { status: 'in_progress' }>(
          `/repos/${repoId}/onboarding-tour/generate`,
          {},
        ),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY(repoId) });
      },
    });
  }
  ```

  **`client/src/lib/hooks/index.ts`** — append:
  ```ts
  export * from './onboarding-tour';
  ```

  **`client/src/vendor/ui/nav.ts`** — add a nav entry for Onboarding Tour in the WORKSPACE section (after the `conventions` entry, before `agents`). Use `gKey: 'o'` (verified: keys `p`, `c`, `a`, `x`, `k`, `,` are taken; `o` is free):
  ```ts
  { key: "onboarding-tour", label: "Onboarding Tour", icon: "Lightbulb", href: "/repos/:repoId/onboarding-tour", gKey: "o" },
  ```
  Also add to `SHORTCUTS`:
  ```ts
  { keys: "g o", label: "Go to Onboarding Tour", group: "Navigation" },
  ```
  `useGlobalShortcuts.ts` derives shortcut routing DYNAMICALLY from `NAV` items — no change to `useGlobalShortcuts.ts` is needed; adding the nav entry is sufficient.

- **Acceptance**:
  - `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` passes.
  - `useOnboardingTour` and `useGenerateTour` are importable from `@/lib/hooks`.
  - The Onboarding Tour item appears in the sidebar nav (requires Wave 3 page to also exist; verify the link is active in the browser at that point).

- **Depends-on**: T2

- **Red flags**:
  - The 404 catch in `useOnboardingTour` MUST convert to `null` rather than re-throwing. Per client AGENTS.md, the global policy toasts on `0` and `5xx` only; a `404` is an expected "not yet generated" state that the UI must handle inline.
  - `staleTime: 0` is intentional: after a regeneration the user expects the tour to refresh. Do not set a long stale time here.
  - `api.post` signature: match the existing pattern from `client/src/services/api.ts` — pass an empty body `{}` for the generate endpoint since it takes no request body.
  - `Lightbulb` is confirmed in the `Icon` registry in `vendor/ui/icons.tsx`. Do not use `BookOpen` — it is NOT in the registry.
  - The `activeKeyFor("/onboarding")` → `"onboarding-tour"` mapping is ALREADY in `client/src/components/app-shell/helpers.ts` (line 29). Do not duplicate it.

---

### T5 — Client Page + Components + i18n · type: ui · covers: R6, R7, R8, R9, R10, R11

- **Owned paths**:
  - `client/src/app/repos/[repoId]/onboarding-tour/page.tsx` (new)
  - `client/src/app/repos/[repoId]/onboarding-tour/_components/OnboardingTour/OnboardingTour.tsx` (new)
  - `client/src/app/repos/[repoId]/onboarding-tour/_components/OnboardingTour/index.ts` (new)
  - `client/messages/en/onboardingTour.json` (new)

- **Skills (mandatory)**: `react-best-practices`, `next-best-practices`, `frontend-architecture`, `typescript-expert`

- **Task**:

  **Mount chain** (must be verifiable in plan-verifier):
  `nav.ts` → `href: "/repos/:repoId/onboarding-tour"` → Next.js route →
  `client/src/app/repos/[repoId]/onboarding-tour/page.tsx` →
  `<OnboardingTour repoId={repoId} />` (direct render, no tab system involved).
  There is NO `VALID_TABS` whitelist for this page — it is a standalone route,
  not a tab within an existing page.

  **`page.tsx`** — thin route; `"use client"`:
  ```tsx
  "use client";
  import React from "react";
  import { useParams } from "next/navigation";
  import { AppShell } from "@/components/app-shell";
  import { useActiveRepo } from "@/providers/repo-context";
  import { useTranslations } from "next-intl";
  import { OnboardingTour } from "./_components/OnboardingTour";

  export default function OnboardingTourPage() {
    const { repoId } = useParams<{ repoId: string }>();
    const { activeRepo } = useActiveRepo();
    const t = useTranslations("onboardingTour");
    const repoName = activeRepo?.full_name ?? repoId;
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: t("title") }]}>
        <OnboardingTour repoId={repoId} />
      </AppShell>
    );
  }
  ```

  **`OnboardingTour.tsx`** — feature component. Renders three states:

  *State C — No clone path (AC-8):*
  ```tsx
  if (!activeRepo?.clone_path) {
    return (
      <ErrorState
        icon="Lightbulb"
        title={t("noClonePath.title")}
        body={t("noClonePath.body")}
      />
      // No Generate or Regenerate button — AC-8
    );
  }
  ```

  *State B — No tour yet (AC-7):*
  ```tsx
  if (!tourData) {
    return (
      <>
        <EmptyState icon="Lightbulb" title={t("empty.title")} body={t("empty.body")} />
        <Button kind="primary" onClick={() => generate.mutate()} loading={generate.isPending}>
          {t("actions.generate")}
        </Button>
      </>
      // No section headings — AC-7
    );
  }
  ```

  *State A — Tour exists (AC-6, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14):*

  Subtitle text: `t("subtitle", { filesIndexed: tourData.files_indexed, timeAgo: relativeTime(tourData.generated_at) })`. Use a simple relative-time formatter: `formatDistanceToNow` from the `date-fns` package (already available in the project — verify with `grep -r "date-fns" client/package.json` before importing; if absent, use a manual computation `Math.floor((Date.now() - Date.parse(ts)) / 60000)` minutes approach).

  Incomplete-index badge (AC-10, AC-11):
  ```tsx
  const showBadge = ['degraded', 'partial', 'failed'].includes(
    tourData.index_status_at_generation,
  );
  {showBadge && (
    <div role="alert" aria-live="polite" style={s.incompleteBadge}>
      {t("incompleteBadge")}
    </div>
  )}
  ```

  Five sections — render each as `<section>` with a heading:
  - Section 1: Architecture Overview — `tourData.sections.architecture_overview` (prose, `<Markdown>` from `@devdigest/ui`)
  - Section 2: Critical Paths — `tourData.sections.critical_paths` (prose, `<Markdown>`)
  - Section 3: How to Run Locally — `tourData.sections.how_to_run_locally` (prose, `<Markdown>`) **PLUS a visible disclaimer** (AC-12):
    ```tsx
    <div role="note" style={s.disclaimer}>{t("howToRun.disclaimer")}</div>
    ```
  - Section 4: Guided Reading Path — ordered list (`<ol>`) of `tourData.reading_path` items, rendered in array order (already rank-descending from server — AC-9):
    ```tsx
    <ol>
      {tourData.reading_path.map((item) => (
        <li key={item.file}>
          <code>{item.file}</code> — {item.description}
        </li>
      ))}
    </ol>
    ```
  - Section 5: First Tasks — `tourData.sections.first_tasks` (prose, `<Markdown>`)

  Share link button (AC-13, a11y):
  ```tsx
  const [copied, setCopied] = React.useState(false);
  const onShare = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  <button
    type="button"
    aria-label={t("actions.shareLink")}
    aria-live="polite"
    onClick={onShare}
  >
    {copied ? t("actions.copied") : t("actions.shareLink")}
  </button>
  ```

  Regenerate button (AC-14):
  ```tsx
  <Button
    kind="secondary"
    onClick={() => generate.mutate()}
    loading={generate.isPending}
    disabled={generate.isPending}
  >
    {t("actions.regenerate")}
  </Button>
  ```

  Polling while in-progress: when `generate.data?.status === 'in_progress'`,
  set `refetchInterval: 3000` on `useOnboardingTour` by passing a dynamic interval
  prop, or use a local `isPolling` state to trigger a `useEffect` that calls
  `refetch()` on a 3-second interval.

  **`client/messages/en/onboardingTour.json`**:
  ```json
  {
    "title": "Onboarding Tour",
    "subtitle": "Generated from index of {filesIndexed} files · last refreshed {timeAgo}",
    "incompleteBadge": "Generated from an incomplete index — Resync and Regenerate for a fuller tour.",
    "noClonePath": {
      "title": "Repository not cloned",
      "body": "Clone this repository via Settings to generate an onboarding tour."
    },
    "empty": {
      "title": "No onboarding tour yet",
      "body": "Generate a five-section tour from the repository's indexed structure."
    },
    "sections": {
      "architectureOverview": "Architecture Overview",
      "criticalPaths": "Critical Paths",
      "howToRunLocally": "How to Run Locally",
      "readingPath": "Guided Reading Path",
      "firstTasks": "First Tasks"
    },
    "howToRun": {
      "disclaimer": "These commands are LLM-inferred from the repository structure and have not been verified by execution. Always review before running."
    },
    "actions": {
      "generate": "Generate",
      "regenerate": "Regenerate",
      "shareLink": "Share link",
      "copied": "Copied!"
    }
  }
  ```

  i18n namespaces are auto-discovered from filenames (no registry to update — see `client/INSIGHTS.md`).

- **Acceptance**:
  - `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` passes.
  - `/repos/<repoId>/onboarding-tour` loads without hydration error or error boundary for all three states:
    - repo with persisted tour → five section headings visible + subtitle
    - repo without persisted tour (clone_path set) → empty state + Generate button; zero section headings in DOM
    - repo without clone_path → error state; no Generate or Regenerate button in DOM
  - The mount chain is complete: nav item with `gKey: "o"` → href `/repos/:repoId/onboarding-tour` → `page.tsx` renders `<OnboardingTour>`.

- **Depends-on**: T4

- **Red flags**:
  - Check `client/package.json` for `date-fns` before importing it. If absent, implement relative time manually rather than adding a new dependency.
  - The `incompleteBadge` string (`t("incompleteBadge")`) is display copy, NOT a prompt-format literal — it IS appropriate to translate. The `INJECTION_GUARD` text in the server is the prompt-format literal that must NOT be i18n-wrapped (but that lives server-side).
  - Never hardcode English strings in JSX — all user-facing text goes through `useTranslations("onboardingTour")`.
  - The disclaimer (AC-12) must be inside the How to Run Locally section structure so it is always visible when that section is rendered, not only on hover or in a collapsed state.
  - `role="alert"` with `aria-live="polite"` on the incomplete-index badge satisfies the spec's a11y requirement for the badge announcement.
  - `aria-live="polite"` on the Share link button ensures screen readers announce "Copied!" without being disruptive.
  - Mount chain: this is a standalone page route — there is **no** `VALID_TABS` array here (the VALID_TABS pitfall applies only to pages where tab state lives in `?tab=` URL params, like `/agents/[id]` and skills). No tab whitelist needs updating.
  - The `Markdown` component (`@devdigest/ui`) safely renders LLM-generated prose. Do NOT use `dangerouslySetInnerHTML`.

---

## Test intents

What must be tested — statements, not tasks. While `test-writer` is disabled these land in the run's manual checklist.

- **R1, R15** → `server-it` (`*.it.test.ts`): seed a repo with a valid `clone_path` and a full index; call POST /repos/:id/onboarding-tour/generate with a mock LLM (returning a valid five-section schema); assert `onboarding_tours` has a new row with all sections non-empty; assert `result.log.llm_calls === 1`; assert the user message to the mock LLM contains `<untrusted source="repo-map">` and `<untrusted source="top-files">` wrappers and that the system message contains the INJECTION_GUARD sentinel text (AC-1, AC-15).

- **R2** → `server-it`: after generation, read the persisted row; assert `generated_at`, `files_indexed`, and `index_status_at_generation` match the mock IndexState supplied to the fake `repoIntel` adapter (AC-2).

- **R3** → `server-it`: inspect the generate response; assert `log.model` is the string the mock LLM returns; `log.tokens_used > 0`; `log.duration_ms > 0` (AC-3).

- **R4** → hermetic unit: inject a slow mock LLM (`delay: 500ms`); fire two concurrent `service.generateTour()` calls; assert the mock LLM is called exactly once; assert the second call returned `{ status: 'in_progress' }` (AC-4).

- **R5** → hermetic unit: inject a mock LLM that returns a string that fails `TourLLMSchema` validation; assert `generateTour` throws; assert `repository.getTour()` returns the same value as before the call (no UPSERT ran) (AC-5).

- **R6** → `e2e`: seed a tour row with known `files_indexed = 42` and a recent `generated_at`; navigate to `/repos/<repoId>/onboarding-tour`; assert five section headings are visible and the subtitle contains "42" (AC-6). Workspace with no tour: assert empty-state element visible and zero `<section>` elements (AC-7). Repo with `clone_path = null`: assert error-state element visible; assert no element with text "Generate" or "Regenerate" (AC-8).

- **R7** → `server-it`: seed `file_rank` rows with known rank values in non-alphabetical order; call generate with a mock LLM; assert the `reading_path` column in the persisted row lists files in descending percentile order (AC-9).

- **R8** → `e2e`: seed tour with `index_status_at_generation = 'partial'`; navigate to tour page; assert incomplete-index badge text visible (AC-10). Seed tour with `index_status_at_generation = 'full'`; navigate; assert no element with badge text present (AC-11).

- **R9** → `e2e`: navigate to any persisted tour page; assert a disclaimer element is visible within the How to Run Locally section (AC-12).

- **R10** → manual: navigate to tour page; click "Share link"; assert system clipboard contains the current page URL; assert button label changes to "Copied!" (AC-13).

- **R11** → `e2e`: with a persisted tour, click "Regenerate"; wait for the button to stop showing loading state; assert the subtitle's relative-time string reflects a `generated_at` more recent than the pre-click value (AC-14).

---

## Sequencing & risks

**Topological order — three waves:**

```
Wave 1 (parallel):  T1, T2
Wave 2 (parallel):  T3 (needs T1+T2), T4 (needs T2)
Wave 3 (serial):    T5 (needs T4)
```

**Critical path:** T2 → T4 → T5 (client) or T1+T2 → T3 (server). Both converge in Wave 2. Server (T3) and client UI (T5) are independent; they can be code-reviewed independently.

**Commit cadence (course requirement — one commit per wave):**
- Wave 1 commit: DB table + shared contracts + INJECTION_GUARD export
- Wave 2 commit: server module (routes/service/repository/index) + client hooks + nav entry
- Wave 3 commit: client page + components + i18n

**Human confirmation required:**
1. After T1 merges (Wave 1 commit): `cd /Users/admin/dev-digest/server && pnpm db:migrate` must be run manually against the running Postgres instance BEFORE running any integration tests in Wave 2+. Never automated on boot.
2. Verify `gKey: "o"` does not conflict after T4 lands by checking the nav shortcut list. Current taken keys: `p`, `c`, `a`, `x`, `k`, `,`. `o` is free — but confirm in case another feature adds it between planning and implementation.

**Risks and mitigations:**

| Risk | Impact | Mitigation |
|---|---|---|
| `completeStructured` retry exhausted (LLM returns malformed JSON twice) | Generate returns error; previous tour preserved | AC-5 satisfied by construction — upsertTour is never called on throw |
| In-flight Set lost on process restart | Two concurrent LLM calls if one request was in-flight when the process crashed | Acceptable for single-instance deployment per boot-reaper contract |
| `getFileRank` returns empty on degraded index | `readingPath` items all have `rank: 0` | Badge will show, informing user; ordering is still deterministic via `topFiles` |
| `getTopFilesByRank` returns empty on degraded index | Empty `reading_path`; LLM still returns the other four sections | AC-10 badge covers this; spec edge case explicitly handled |
| `reading_path` may contain files the LLM adds that were not in `topFiles` | Stored `reading_path` includes LLM-invented paths with `rank: 0` | Service assembles `readingPath` from `topFiles` (server-controlled), mapping LLM descriptions by file — LLM cannot add extra entries |
| Naming collision with existing `Onboarding`/`OnboardingSection` in `contracts/knowledge.ts` | TypeScript export conflict if both are in the same barrel | New types are named `OnboardingTour`, `OnboardingTourSections`, `ReadingPathItem` — distinct names; no collision |
| `VALID_TABS` pitfall (from INSIGHTS.md) for a tab-less page | None — not applicable | This is a standalone route, not a tab in an existing page. No VALID_TABS lookup exists for `/repos/[repoId]/onboarding-tour`. No action needed. |
| `date-fns` dependency absent from client | Build error on relative-time formatting | Verify before importing; fall back to manual computation if absent |

---

## Verification per task

- **T1**: `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` — zero errors; `server/src/db/migrations/<timestamp>_onboarding_tours.sql` file present; `onboardingTours` in `schema.ts` `schema` object.

- **T2**: `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` — zero errors; `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` — zero errors; `cd /Users/admin/dev-digest/reviewer-core && npm run build` — zero errors; `INJECTION_GUARD` importable from `@devdigest/reviewer-core` in a typecheck sense.

- **T3**: `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` — zero errors; `pnpm exec vitest run src/modules/onboarding-tours` (hermetic unit tests for dedup and schema-failure paths).

- **T4**: `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` — zero errors; `useOnboardingTour` and `useGenerateTour` importable from `@/lib/hooks`.

- **T5**: `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` — zero errors; `/repos/<repoId>/onboarding-tour` page renders without hydration errors (manual browser check or e2e verification).
