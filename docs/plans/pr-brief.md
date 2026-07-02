# Implementation Plan: pr-brief

**Spec:** SPEC-03 (`specs/SPEC-03-2026-07-pr-why-risk-brief.md`)

## Overview

The PR Overview tab lacks a single decision-ready synthesis of what a PR does,
why it exists, and where the risks lie. This plan wires a structured one-LLM-call
synthesis that draws from the existing persisted intent, blast radius, smart-diff
stats, linked issue, and agent context docs, persists the result in the already-
scaffolded `pr_brief` table (no migration), and renders it as `PrBriefCard` — the
first card on the Overview tab above the Intent+Blast grid.

## Execution mode: multi-agent

Three implementer instances over two dependency waves.

## Requirements

| ID | Covers AC | Requirement | Acceptance criteria (measurable) |
|---|---|---|---|
| R1 | AC-1, AC-2 | `GET /pulls/:id/brief` returns `{ brief: BriefRecord \| null }` HTTP 200 in both the null (no row) and populated cases; no LLM call on GET | DB-backed `.it.test.ts`: null case → HTTP 200 body `{ brief: null }`; seeded case → HTTP 200 body matches the seeded row; mock LLM adapter receives 0 calls on GET |
| R2 | AC-3 | `POST /pulls/:id/brief` returns HTTP 422 `intent_required` when no `pr_intent` row exists; no LLM call | DB-backed `.it.test.ts`: PR with no intent row → HTTP 422, `error.code === "intent_required"`, mock LLM adapter 0 calls |
| R3 | AC-4, AC-8 | LLM prompt assembled from intent text, blast summary, smart-diff file-group stats, linked issue, and agent context docs; no diff hunk bodies (no `+`/`-`-prefixed diff lines) in any message | Hermetic unit: supply mock inputs for all five sources; call `assembleBriefMessages`; assert all five represented in output messages; assert no `+`/`-`-prefixed diff line content |
| R4 | AC-5 | Exactly one `completeStructured` call per `POST` generation | Hermetic unit: inject call-counting mock LLM; trigger generation; assert adapter received exactly 1 call |
| R5 | AC-6, AC-7 | Grounding gate: filter `Risk.file_refs` against PR changed file set (drop empty-ref risks); drop `review_focus` entries whose `file` is outside the set; `POST` response includes `dropped_items` count | DB-backed `.it.test.ts`: mock LLM returns mixed valid/invalid file-ref items; persisted `BriefRecord.risks` + `review_focus` contain only grounded items; `POST` response `dropped_items ≥ 1` |
| R6 | AC-9 | `tokens_in` in `POST` response ≤ 8 000 for the reference integration-test PR fixture | DB-backed `.it.test.ts`: mock LLM echoes `tokensIn` derived from the assembled prompt length; assert response `tokens_in ≤ 8000` |
| R7 | AC-10 | Agent-level context docs collected from all workspace agents, deduped by `(repo_id, relative_path)` (first-occurrence wins), zero-byte files silently skipped | DB-backed `.it.test.ts`: two agents with overlapping paths + one zero-byte file; each unique path read exactly once from mock clone dir; zero-byte file absent from the assembled prompt |
| R8 | AC-11 | All untrusted text (intent, linked issue, blast summary, smart-diff paths, context doc content) wrapped with `wrapUntrusted`; `INJECTION_GUARD` in system message | Hermetic unit: all five input types enclosed in `<untrusted …>` delimiters; system message contains the `INJECTION_GUARD` sentinel string |
| R9 | AC-12, AC-13, AC-14, AC-15 | `PrBriefCard` renders three states (empty/generate, populated with usage line, 422-hint) and supports Regenerate with loading indicator | e2e: empty state visible with no content fields (AC-12); populated card is first element above Intent+Blast grid (AC-13); 422 hint state after no-intent POST (AC-14); Regenerate shows loading then updates content (AC-15) |

### Descoped ACs

None — all 15 ACs are covered above. AC-1, AC-2 → R1; AC-3 → R2; AC-4, AC-8 → R3;
AC-5 → R4; AC-6, AC-7 → R5; AC-9 → R6; AC-10 → R7; AC-11 → R8;
AC-12, AC-13, AC-14, AC-15 → R9.

### Open recommendations

| # | Recommendation | Status |
|---|---|---|
| D1 | Remove `PrBrief` aggregate type from `contracts/brief.ts` | accepted — PrBrief (`{intent, blast, risks, history}`) is only a dead re-export in `client/src/types/index.ts`; not consumed in any product component or service; removing it prevents confusion with the new `BriefRecord` |
| D2 | New `modules/brief/` module vs extending `modules/reviews/` | accepted — blast module is a standalone module for PR-scoped data; brief follows the same pattern; keeps reviews/ focused on agent review runs and findings |
| D3 | `BriefService` instantiates `BlastService(this.container)` and `ReviewService(this.container)` internally to get blast summary + file set + smart-diff stats | accepted — both peer services take only `Container` (no circular dep); avoids duplicating blast composition logic and smart-diff file-group retrieval; trade-off: brief module has runtime imports on blast and reviews modules |
| D4 | `BriefLLMSchema` (raw LLM output type) lives in `modules/brief/helpers.ts` (module-internal); `BriefRecord` and `ReviewFocusItem` live in `contracts/brief.ts` (shared) | accepted — applies the SPEC-02 arch-review lesson: LLM decoder schema is not a domain contract; client never needs to know the raw LLM type |
| D5 | Inline `resolveLinkedIssue` logic in `modules/brief/helpers.ts` | accepted — avoids cross-module import from `modules/reviews/intent.ts`; the function is ~20 lines + one regex; stable enough to duplicate |
| D6 | File links in `PrBriefCard` navigate to `?tab=diff` (no per-file anchor exists in the current `DiffTab`) | accepted — the current DiffTab has no file anchor / scroll mechanism; `useRouter` + `useParams` + `useSearchParams` builds `?tab=diff` URL in the card component without prop drilling through OverviewTab |
| D7 | Per-source character caps during prompt assembly (no pre-call truncation): blast summary ≤ 2 000 chars; linked issue body ≤ 1 500 chars; each context doc ≤ 1 500 chars; intent text ≤ 3 000 chars | accepted — keeps assembled prompt well under the 8 000-token budget without violating the spec's "no pre-call truncation" non-goal (caps are applied during assembly, not on the raw LLM call) |

## Affected packages / modules

- **server** — new `modules/brief/` (routes.ts, service.ts, repository.ts, helpers.ts);
  update `modules/index.ts`
- **shared (dual-vendored)** — extend `server/src/vendor/shared/contracts/brief.ts` and
  `client/src/vendor/shared/contracts/brief.ts` (byte-identical): remove `PrBrief`
  aggregate stub; add `ReviewFocusItem`, `BriefRecord`; no barrel update needed
  (brief.ts already re-exported via `export * from './contracts/brief.js'` in both index.ts files)
- **client** — new `lib/hooks/brief.ts`; update `lib/hooks/index.ts`; new
  `_components/PrBriefCard/{PrBriefCard.tsx,styles.ts,index.ts}`; update
  `_components/OverviewTab/OverviewTab.tsx`; new `messages/en/brief.json`;
  update `src/types/index.ts`

---

## Tasks (parallel units)

Each task = one `implementer` instance, running in the same shared working tree.
Owned paths across tasks MUST be disjoint — no file appears in two tasks.

---

### T1 — Shared Contracts · type: backend · covers: R1, R2, R3, R4, R5, R6, R7, R8, R9

- **Owned paths**:
  - `server/src/vendor/shared/contracts/brief.ts`
  - `client/src/vendor/shared/contracts/brief.ts`
  - `client/src/types/index.ts`

- **Skills (mandatory)**: `zod`, `typescript-expert`

- **Task**:

  **`contracts/brief.ts`** — edit BOTH vendor copies (content must be byte-for-byte
  identical after the edit). All existing types (`Intent`, `BlastRadius`, `Risk`,
  `Risks`, `SmartDiff`, etc.) are retained unchanged. The only removal is the
  final `PrBrief` aggregate type (lines 147–153 in both files). Add immediately
  after the `SmartDiff` block:

  ```ts
  // ---- Brief: generated PR Why + Risk synthesis (SPEC-03) ----

  export const ReviewFocusItem = z.object({
    file: z.string(),
    line: z.number().int().nullable(),
    reason: z.string(),
  });
  export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

  /**
   * Full PR brief DTO — stored in pr_brief.json and returned by both GET and POST.
   * Includes the LLM-generated fields (what/why/risk_level/risks/review_focus)
   * and the generation metadata (tokens_in/tokens_out/cost_usd/generated_at).
   */
  export const BriefRecord = z.object({
    what: z.string(),
    why: z.string(),
    risk_level: z.enum(['low', 'medium', 'high']),
    risks: z.array(Risk),
    review_focus: z.array(ReviewFocusItem),
    tokens_in: z.number().int(),
    tokens_out: z.number().int(),
    cost_usd: z.number().nullable(),
    generated_at: z.string(), // ISO 8601
  });
  export type BriefRecord = z.infer<typeof BriefRecord>;
  ```

  Then remove the stale `PrBrief` aggregate at the bottom of the file
  (the `// ---- Composed PR Brief (pr_brief.json) ----` section with the
  `PrBrief` Zod object and type).

  Update both `vendor/shared/index.ts` comment blocks that still reference
  `PrBrief` in the description (the barrel re-export `export * from
  './contracts/brief.js'` stays — only the comment changes).

  **`client/src/types/index.ts`** — on line 35, replace:
  ```ts
  export type { PrBrief, SmartDiff } from "@devdigest/shared";
  ```
  with:
  ```ts
  export type { BriefRecord, SmartDiff } from "@devdigest/shared";
  ```

- **Acceptance**:
  - `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` — zero errors.
  - `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` — zero errors.
  - `BriefRecord` and `ReviewFocusItem` importable from `@devdigest/shared` in
    a typecheck sense; `PrBrief` no longer exported.

- **Depends-on**: none

- **Red flags**:
  - Both `contracts/brief.ts` files **must be byte-for-byte identical** after
    editing. Copy the final version; do not diverge.
  - Retain ALL existing types (`Intent`, `BlastRadius`, `Risk`, `Risks`,
    `SmartDiff`, `SmartDiffGroup`, etc.) — they are actively used by blast and
    review features. Only remove `PrBrief`.
  - `BriefRecord.risks` reuses the existing `Risk` type (already in the file);
    do not redefine it.
  - No barrel (`index.ts`) update is needed in either vendor tree — brief.ts
    is already included via `export * from './contracts/brief.js'`.
  - The two `index.ts` barrel files are NOT owned by T1; only update the
    comment text inside them, not the export lines.

---

### T2 — Server Module: brief · type: backend · covers: R1, R2, R3, R4, R5, R6, R7, R8

- **Owned paths**:
  - `server/src/modules/brief/routes.ts` (new)
  - `server/src/modules/brief/service.ts` (new)
  - `server/src/modules/brief/repository.ts` (new)
  - `server/src/modules/brief/helpers.ts` (new)
  - `server/src/modules/index.ts`

- **Read-only dependencies (not owned — do not modify)**:
  - `server/src/modules/blast/service.ts` (`BlastService.blastForPull`) — instantiate internally
  - `server/src/modules/reviews/service.ts` (`ReviewService.smartDiffForPull`) — instantiate internally
  - `server/src/modules/repos/repository.ts` (`RepoRepository.getById`,
    `RepoRepository.getClonePathsByIds`) — import cross-module (same pattern as
    `onboarding-tours/service.ts`)
  - `server/src/modules/settings/feature-models.ts` (`resolveFeatureModel`) — import
  - `@devdigest/reviewer-core` — `INJECTION_GUARD`, `wrapUntrusted`

- **Skills (mandatory)**: `onion-architecture`, `fastify-best-practices`, `zod`, `security`

- **Task**:

  **`helpers.ts`** — module-internal utilities:

  ```ts
  // BriefLLMSchema: raw LLM output type (module-internal, never shared).
  // No .min(1) on strings — OpenAI strict JSON schema rejects length constraints.
  export const BriefLLMSchema = z.object({
    what: z.string(),
    why: z.string(),
    risk_level: z.enum(['low', 'medium', 'high']),
    risks: z.array(z.object({
      kind: z.string(),
      title: z.string(),
      explanation: z.string(),
      severity: z.enum(['high', 'medium', 'low']),
      file_refs: z.array(z.string()),
    })),
    review_focus: z.array(z.object({
      file: z.string(),
      line: z.number().int().nullable(),
      reason: z.string(),
    })),
  });
  export type BriefLLMOutput = z.infer<typeof BriefLLMSchema>;
  ```

  `assembleBriefMessages(inputs: BriefInputs): { system: string; user: string }`
  — builds the LLM messages from typed inputs. `BriefInputs` carries: `intent`
  (text), `blastSummary`, `smartDiffStats` (text serialisation of file-group role
  + path + additions + deletions, no hunk content), `linkedIssue`
  (`{ title: string; body: string } | null`), and `contextDocContents`
  (`string[]`). Character caps applied here before wrapping:
  - `intent.slice(0, 3000)` before `wrapUntrusted('intent', ...)`
  - `blastSummary.slice(0, 2000)` before `wrapUntrusted('blast-summary', ...)`
  - `linkedIssue.body.slice(0, 1500)` before `wrapUntrusted('linked-issue', ...)`
  - each context doc `.slice(0, 1500)` before `wrapUntrusted('context-doc-N', ...)`
  - smart-diff stats: already structured text (no body content), no cap needed

  The system message must include `INJECTION_GUARD`:
  ```ts
  const system = `You are a senior code reviewer producing a structured PR brief. ${INJECTION_GUARD}`;
  ```

  `groundBrief(llmOutput: BriefLLMOutput, prFileSet: Set<string>)`:
  ```
  → { risks: Risk[], review_focus: ReviewFocusItem[], droppedItems: number }
  ```
  Implements AC-6 gate:
  1. For each risk: filter `file_refs` to files in `prFileSet`; drop risk if
     `file_refs` is empty after filter.
  2. For each `review_focus` entry: drop if `file` not in `prFileSet`.
  3. `droppedItems` = count of dropped risks + dropped focus entries.

  `resolveLinkedIssue(container, repoRow, prBody)` — inlined from
  `modules/reviews/intent.ts`; same logic and same `LINKED_ISSUE_RE` regex;
  never throws.

  **`repository.ts`** — reads and writes the `pr_brief` table and ancillary PR data:

  ```ts
  export class BriefRepository {
    constructor(private db: Db) {}

    async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined>
    async getIntent(prId: string): Promise<Intent | undefined>
    async getBrief(prId: string): Promise<BriefRecord | null>
    // jsonb typed via .$type<BriefRecord>(); returns null when no row exists.

    async upsertBrief(prId: string, json: BriefRecord): Promise<void>
    // INSERT INTO pr_brief (pr_id, json) VALUES (…) ON CONFLICT (pr_id)
    // DO UPDATE SET json = EXCLUDED.json
  }
  ```

  `getBrief` queries `t.prBrief` where `prBriefRow.prId === prId`; parse the
  stored jsonb with `BriefRecord.parse(row.json)` before returning to ensure
  shape integrity.

  **`service.ts`** — business logic:

  `BriefService(container: Container)` — constructor; creates:
  - `this.repo = new BriefRepository(container.db)`
  - `this.repoRepo = new RepoRepository(container.db)` (for getById + getClonePathsByIds)

  `getBrief(workspaceId: string, prId: string)`:
  1. `const pull = await this.repo.getPull(workspaceId, prId)`; throw `NotFoundError`
     when absent (PR does not belong to workspace).
  2. Return `{ brief: await this.repo.getBrief(prId) }` — null when no row.

  `generateBrief(workspaceId: string, prId: string)`:
  1. `const pull = await this.repo.getPull(workspaceId, prId)`; throw `NotFoundError`.
  2. `const intent = await this.repo.getIntent(prId)`; if absent throw
     `AppError('intent_required', 'Compute the PR intent before generating a brief.', 422)`.
     (Use `AppError` directly with a 422 status so the global error handler emits the
     correct `ApiErrorBody` envelope with `code: "intent_required"`.)
  3. `const repo = await this.repoRepo.getById(workspaceId, pull.repoId)`;
     throw `NotFoundError` when absent.
  4. Gather inputs in parallel — note the three independent fetch groups:
     ```ts
     const [blast, smartDiff, linkedIssue] = await Promise.all([
       new BlastService(this.container).blastForPull(workspaceId, prId),
       new ReviewService(this.container).smartDiffForPull(workspaceId, prId),
       resolveLinkedIssue(this.container, repo, pull.body),
     ]);
     ```
  5. Build `prFileSet: Set<string>` = union of:
     - `blast.changed_symbols.map(s => s.file)`
     - `smartDiff.groups.flatMap(g => g.files.map(f => f.path))`
  6. Collect context docs (AC-10):
     ```
     a. const agents = await this.container.agentsRepo.list(workspaceId)
     b. For each agent, getContextDocPaths(agent.id); merge + dedup by (repoId, relativePath)
     c. Batch-fetch clone paths via this.repoRepo.getClonePathsByIds(uniqueRepoIds)
     d. Read files: skip missing (warn in server log), skip zero-byte (silent)
     e. contextDocContents: string[] of successfully read + non-empty files
     ```
  7. Build `smartDiffStats`: serialise each `SmartDiffGroup` as plain text:
     `[role]\n<path> (+N -N)\n…` — no pseudocode_summary, no hunk bodies, no findings.
  8. Build `intentText`: `${intent.intent}\nIn scope: ${intent.in_scope.join(', ')}\nOut of scope: ${intent.out_of_scope.join(', ')}`.
  9. `const messages = assembleBriefMessages({ intent: intentText, blastSummary: blast.summary, smartDiffStats, linkedIssue, contextDocContents })`.
  10. `const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief')`.
  11. `const llm = await this.container.llm(provider)` — wrap in try/catch;
      re-throw `ConfigError` as-is; wrap others as `ExternalServiceError('llm-brief', err.message)`.
  12. `const result = await llm.completeStructured({ model, messages: [{ role: 'system', content: messages.system }, { role: 'user', content: messages.user }], schema: BriefLLMSchema, schemaName: 'Brief', maxRetries: 1 })` — wrap in try/catch; throw `ExternalServiceError` on any failure.
  13. `const { risks, review_focus, droppedItems } = groundBrief(result.data, prFileSet)`.
  14. Build `BriefRecord`:
      ```ts
      const briefRecord: BriefRecord = {
        what: result.data.what,
        why: result.data.why,
        risk_level: result.data.risk_level,
        risks,
        review_focus,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        cost_usd: result.costUsd,
        generated_at: new Date().toISOString(),
      };
      ```
  15. `await this.repo.upsertBrief(prId, briefRecord)`.
  16. Return `{ brief: briefRecord, dropped_items: droppedItems }`.

  **Error mapping** (global error handler in `app.ts` handles all of these):
  - `NotFoundError` → 404
  - `AppError` with status 422 → 422 + `error.code`
  - `ExternalServiceError` → 502
  - `ConfigError` → re-thrown → 500

  **`routes.ts`** — thin Fastify plugin:

  ```ts
  GET  /pulls/:id/brief
       schema: { params: IdParams, response: { 200: BriefGetResponse } }
       → getContext → service.getBrief(workspaceId, id)
       → 200 { brief: BriefRecord | null }

  POST /pulls/:id/brief
       schema: { params: IdParams, response: { 200: BriefPostResponse } }
       config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
       → getContext → service.generateBrief(workspaceId, id)
       → 200 { brief: BriefRecord, dropped_items: number }
       OR 422 { error: { code: 'intent_required', message: '…' } }
  ```

  Response schemas (must be registered with `serializerCompiler` — the framework
  does this when the `response` key is present in the route schema):
  ```ts
  const BriefGetResponse = z.object({ brief: BriefRecord.nullable() });
  const BriefPostResponse = z.object({
    brief: BriefRecord,
    dropped_items: z.number().int(),
  });
  ```

  Both routes call `getContext(container, req)` first. The `serializerCompiler`
  registration is automatic when the `response` key is present — this is the
  runtime validation gate per the INSIGHTS requirement.

  **`server/src/modules/index.ts`** — add one import and one entry:
  ```ts
  import brief from './brief/routes.js';
  // in the modules object:
  brief,
  ```

- **Acceptance**:
  - `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` — zero errors.
  - `curl -s http://localhost:3001/pulls/<valid-prId>/brief` with a valid workspace
    cookie returns `{ "brief": null }` for a PR without a seeded row.
  - `curl -s -X POST http://localhost:3001/pulls/<prId-no-intent>/brief` returns
    HTTP 422 with body `{ "error": { "code": "intent_required", … } }`.
  - Hermetic unit: inject mock LLM → trigger generation → assert exactly 1
    `completeStructured` call recorded.

- **Depends-on**: T1

- **Red flags**:
  - The `AppError` constructor takes `(code: string, message: string, statusCode: number)` —
    verify the exact signature in `platform/errors.ts` before using it for the 422 path.
    If `AppError` doesn't accept a status, use `ValidationError` from `errors.ts` but
    then add a special error-to-code mapping so the response body carries `intent_required`.
    Alternatively, throw a new class `BriefPreconditionError extends AppError`. Verify
    the actual `AppError` taxonomy first.
  - `BriefRecord.parse(row.json)` in `getBrief` is the runtime schema gate; if the
    stored jsonb is malformed (e.g. from a failed past write), this will throw —
    catch and return null or re-throw as `ExternalServiceError` based on team preference.
  - ESM imports: all internal server imports use `.js` suffix.
  - `BlastService` and `ReviewService` are instantiated with `new BlastService(this.container)`
    — they do NOT need to be cached; each call creates a fresh instance. This is cheap
    since services hold no expensive resources.
  - The `maxRetries: 1` on `completeStructured` means up to 2 attempts total; with
    `strict: true` JSON schema enforcement, the first attempt almost always succeeds.
    If both attempts fail, `completeStructured` throws `ExternalServiceError` → HTTP 502.
  - Character caps are enforced in `assembleBriefMessages` (step 9). Do NOT apply
    them in the service layer — keep prompt assembly pure and testable in `helpers.ts`.
  - `dropped_items` is returned in the POST response only; it must NOT be stored in
    `pr_brief.json`.
  - The `pr_brief` table has `json jsonb NOT NULL` — Drizzle column type is `jsonb('json').$type<BriefRecord>()`. The column name in the table schema is literally `json`.
  - Rate limit for POST brief (5/min) is tighter than review (10/min) because each
    call makes an LLM call; the brief is cheap but not free.

---

### T3 — Client: hooks + PrBriefCard + OverviewTab mount · type: ui · covers: R9

- **Owned paths**:
  - `client/src/lib/hooks/brief.ts` (new)
  - `client/src/lib/hooks/index.ts`
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx` (new)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/styles.ts` (new)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/index.ts` (new)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
  - `client/messages/en/brief.json` (new)

- **Skills (mandatory)**: `react-best-practices`, `next-best-practices`, `frontend-architecture`, `typescript-expert`

- **Task**:

  **`client/src/lib/hooks/brief.ts`** — follow the `intent.ts` and `blast.ts` patterns:

  ```ts
  "use client";
  import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
  import { api } from "@/services/api";
  import type { BriefRecord } from "@devdigest/shared";

  export interface BriefGetResponse { brief: BriefRecord | null; }
  export interface BriefPostResponse { brief: BriefRecord; dropped_items: number; }

  export function useBrief(prId: string | null | undefined) {
    return useQuery({
      queryKey: ["brief", prId],
      queryFn: () => api.get<BriefGetResponse>(`/pulls/${prId}/brief`),
      enabled: prId != null,
    });
  }

  export function useGenerateBrief(prId: string) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: () => api.post<BriefPostResponse>(`/pulls/${prId}/brief`, {}),
      onSuccess: (data) => {
        // Write the new brief into the GET cache immediately — no refetch wait.
        qc.setQueryData(["brief", prId], { brief: data.brief });
      },
    });
  }
  ```

  **`client/src/lib/hooks/index.ts`** — append:
  ```ts
  export * from './brief';
  ```

  **`client/messages/en/brief.json`**:
  ```json
  {
    "title": "PR Why + Risk Brief",
    "empty": {
      "title": "No brief yet",
      "body": "Generate a structured summary of what this PR does, why, and where the risks are."
    },
    "intentRequired": "Intent not yet computed. Use the Intent card below to compute intent, then click Generate Brief.",
    "riskLevel": {
      "low": "Low risk",
      "medium": "Medium risk",
      "high": "High risk"
    },
    "sections": {
      "what": "What",
      "why": "Why",
      "risks": "Risks",
      "reviewFocus": "Review Focus"
    },
    "usage": "{tokensIn} → {tokensOut} tokens · {costUsd}",
    "actions": {
      "generate": "Generate Brief",
      "regenerate": "Regenerate"
    },
    "a11y": {
      "riskBadge": "Risk level: {level}",
      "fileLink": "Go to diff for {file}"
    }
  }
  ```

  **`PrBriefCard.tsx`** — feature component. States in render order:

  *Loading (query pending):*
  ```tsx
  if (isLoading) return <Skeleton height={120} />;
  ```

  *Empty state (brief is null, no ongoing mutation error):*
  ```tsx
  if (!data?.brief && !generate.error) {
    return (
      <div>
        <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
        <Button kind="primary" loading={generate.isPending}
          onClick={() => generate.mutate()}>
          {t("actions.generate")}
        </Button>
      </div>
    );
  }
  ```

  *422 intent-required hint (AC-14):*
  The `useMutation` error surface: when POST returns 422, `api.post` throws an
  `ApiError` with `status === 422` and `code === "intent_required"`. The card
  checks `generate.error` — if it is an `ApiError` with `status === 422` and
  `error.code === "intent_required"`, render the hint state:
  ```tsx
  if (generate.error instanceof ApiError && generate.error.status === 422) {
    return (
      <div>
        <EmptyState icon="FileText" title={t("empty.title")} body={t("intentRequired")} />
      </div>
    );
  }
  ```
  (The global mutation-error toast is suppressed for 422 per the client AGENTS.md
  policy — the card renders its own inline hint for this case. Verify that the
  global policy only toasts on `0` and `5xx` before adding extra suppression.)

  *Populated brief (AC-13):*
  ```tsx
  const brief = data.brief!; // non-null after the empty-state guard
  const navigateToDiff = () => {
    // navigate to the diff tab via URL param — no prop needed from OverviewTab
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", "diff");
    router.replace(`/repos/${repoId}/pulls/${number}?${sp.toString()}`);
  };
  ```

  - Risk level badge: colour-coded (`low`=green, `medium`=amber, `high`=red) with
    `aria-label={t("a11y.riskBadge", { level: t("riskLevel." + brief.risk_level) })}`.
  - `risks[]` list: each item rendered as `<li>`; each `file_ref` in `risk.file_refs`
    as a `<button onClick={navigateToDiff}>` with `aria-label={t("a11y.fileLink", { file })}`.
  - `review_focus[]` ordered list: each item formatted as `file[:line] — reason`; the
    file portion is a `<button onClick={navigateToDiff}>` with accessible label.
  - Usage line: format tokens and cost via `t("usage", { tokensIn: brief.tokens_in, tokensOut: brief.tokens_out, costUsd: brief.cost_usd != null ? `$${brief.cost_usd.toFixed(4)}` : '—' })`.
  - Regenerate button: `<Button kind="secondary" loading={generate.isPending} disabled={generate.isPending} onClick={() => generate.mutate()}>{t("actions.regenerate")}</Button>`.
    Must be keyboard-operable (it's a `<Button>` — this is satisfied by construction).

  `PrBriefCard` receives `prId: string`. It uses:
  ```ts
  const params = useParams<{ repoId: string; number: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { data, isLoading } = useBrief(prId);
  const generate = useGenerateBrief(prId);
  const t = useTranslations("brief");
  ```

  **`OverviewTab.tsx`** — insert `PrBriefCard` as the FIRST rendered child,
  before the Intent+Blast grid:

  ```tsx
  import { PrBriefCard } from "../PrBriefCard";

  export function OverviewTab({ prBody, prId }: OverviewTabProps) {
    return (
      <>
        {prId && <PrBriefCard prId={prId} />}

        {/* Two-column card grid: Intent (left) + Blast Radius (right) */}
        {prId && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
            <IntentCard prId={prId} />
            <BlastRadiusCard prId={prId} />
          </div>
        )}

        {prBody && (
          <section>
            <SectionLabel icon="MessageSquare">Description</SectionLabel>
            <div style={s.descriptionBox}>{prBody}</div>
          </section>
        )}
      </>
    );
  }
  ```

  The `PrBriefCard` block must appear in DOM order before the grid container
  (AC-13: "first element in the Overview tab body, above the IntentCard+BlastRadiusCard
  grid container").

  **`PrBriefCard/index.ts`**:
  ```ts
  export { PrBriefCard } from "./PrBriefCard";
  ```

- **Acceptance**:
  - `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` — zero errors.
  - Navigate to any PR Overview tab with no `pr_brief` row: `PrBriefCard` empty-state
    visible above the grid; no `what`/`why`/`risk_level` elements in DOM.
  - Navigate to any PR Overview tab with a seeded `pr_brief` row: `PrBriefCard` renders
    first (before IntentCard+BlastRadiusCard grid in DOM order); `risk_level` badge,
    `risks` list, `review_focus` list, and usage line are visible.
  - Click "Generate Brief" on a PR with no `pr_intent` row: the 422 hint-state renders
    with text referencing intent computation; no generic error toast.
  - Regenerate button: clicking it shows a loading state; on mock POST resolve, the brief
    content updates without page reload.

- **Depends-on**: T1

- **Red flags**:
  - `useSearchParams()` inside a `"use client"` component that is embedded in an existing
    page requires the page to be wrapped in `<Suspense>` — the PR detail page already
    has `<Suspense>` at the root (`PRDetailPage` in `page.tsx`), so this is covered.
    Do NOT add another `<Suspense>` wrapper.
  - `useParams<{ repoId: string; number: string }>()` resolves the Next.js route segment
    params. The URL bracket notation `[number]` maps to `number` as the key.
  - The 422 hint state must NOT re-throw or trigger the global toast. The global mutation
    error toast fires on `0` and `5xx` only per `providers/index.tsx` — a `422` is a
    known intent-required case handled inline. Confirm in `providers/index.tsx` that 422
    errors are indeed silent before relying on this.
  - Never hardcode English strings in JSX — all user-facing text via `useTranslations("brief")`.
  - i18n namespaces are auto-discovered from filenames — no registry to update; just
    create `messages/en/brief.json`.
  - `PrBriefCard` must NOT import `OverviewTab` (direction: OverviewTab imports PrBriefCard,
    not the other way around).
  - `useGenerateBrief.onSuccess` writes to `["brief", prId]` cache key — ensure the key
    matches `useBrief`'s `queryKey` exactly.
  - Do NOT add `no border shorthand/longhand mixing` in `styles.ts` — use consistent
    `border: '1px solid …'` across all `borderTop`/`borderBottom` style properties to
    avoid Stylex/React DOM warnings (the INSIGHTS lesson about border shorthand/longhand).
  - The `PrBriefCard` is rendered inside `OverviewTab` which is itself a `"use client"`
    component. No `"use client"` directive needed on `PrBriefCard.tsx` — it inherits the
    boundary. BUT because it uses `useRouter`, `useSearchParams`, and `useParams`, it
    must either be `"use client"` itself OR be wrapped. Since it uses client hooks, add
    `"use client"` at the top of `PrBriefCard.tsx`.

---

## Test intents

What must be tested — statements, not tasks. While `test-writer` is disabled, these
land in the run's manual checklist after each wave commit.

- **R1** → `server-it` (`*.it.test.ts`): seed a `pr_brief` row with known JSON; call
  `GET /pulls/:id/brief`; assert HTTP 200 and body matches seeded data; assert mock LLM
  adapter received 0 calls. Also: seed no row; assert `{ brief: null }` with HTTP 200.
  (AC-1, AC-2)

- **R2** → `server-it`: seed PR with no `pr_intent` row; call `POST /pulls/:id/brief`;
  assert HTTP 422 and `error.code === "intent_required"`; assert mock LLM 0 calls.
  (AC-3)

- **R3** → hermetic unit (`*.test.ts`): call `assembleBriefMessages` with mock inputs
  for all five sources (intent, blast summary, smart-diff stats, linked issue, one
  context doc); assert each source appears in the output; assert output contains no
  `+`-prefixed or `-`-prefixed diff line content. (AC-4, AC-8)

- **R4** → hermetic unit: inject a call-counting mock `LLMProvider`; call
  `generateBrief` once on a valid PR fixture; assert the mock received exactly 1
  `completeStructured` invocation. (AC-5)

- **R5** → `server-it`: mock LLM returning `risks: [{kind: 'perf', title: 'T', …, file_refs: ['a.ts']}, {kind: 'sec', title: 'T', …, file_refs: ['outside.ts']}]` and
  `review_focus: [{file: 'a.ts', …}, {file: 'outside.ts', …}]`; PR file set = `{a.ts}`
  only; assert persisted `brief.risks` has 1 entry with `file_refs: ['a.ts']`; assert
  `review_focus` has 1 entry; assert POST response `dropped_items === 2`. (AC-6, AC-7)

- **R6** → `server-it`: use a mock LLM that echoes `tokensIn` equal to the byte length
  of the assembled user message divided by 4 (approximation); assert POST response
  `tokens_in ≤ 8000` for a representative PR fixture. (AC-9)

- **R7** → `server-it`: seed 2 agents with 3 context doc paths (one shared path, one
  agent-2-only, one shared zero-byte path); mock clone dir; trigger `generateBrief`;
  assert the shared non-empty path was read once; assert the zero-byte path absent from
  mock LLM call messages. (AC-10)

- **R8** → hermetic unit: call `assembleBriefMessages` with non-empty values for all
  five input types; assert every third-party string is enclosed in `<untrusted …>` /
  `</untrusted>` delimiters; assert system message contains the `INJECTION_GUARD`
  sentinel string (import it from `@devdigest/reviewer-core` in the test). (AC-11)

- **R9** → `e2e`: three flow specs — (1) PR with no `pr_brief` row: navigate to Overview
  tab; assert `PrBriefCard` empty-state element visible; assert no `what`/`why`/`risk_level`
  elements. (2) PR with seeded `pr_brief` row: navigate to Overview tab; assert
  `PrBriefCard` is the first rendered child before the grid; assert `risk_level` badge,
  one `risks` entry, one `review_focus` entry, usage line all visible. (3) PR with no
  `pr_intent` row: click Generate Brief; assert 422 hint text visible with reference to
  intent computation. (AC-12, AC-13, AC-14, AC-15)

---

## Sequencing & risks

**Topological order — two waves:**

```
Wave 1 (serial):    T1
Wave 2 (parallel):  T2 (needs T1) || T3 (needs T1)
```

T2 and T3 are fully parallel in Wave 2 — no shared files.

**Critical path:** T1 → T2 (server) or T1 → T3 (client). Both converge at Wave 2.
The server (T2) and client (T3) are independently reviewable after their wave.

**Commit cadence (one commit per wave):**
- Wave 1 commit: shared contracts (`BriefRecord`, `ReviewFocusItem`; remove `PrBrief`)
- Wave 2 commit: server module + client hooks + card + OverviewTab mount

**No human confirmation steps required:**
- The `pr_brief` table already exists — `pnpm db:generate` and `pnpm db:migrate` are
  NOT needed. This is explicitly a non-migration feature.
- No new nav entries or VALID_TABS changes needed — the card mounts in an existing tab.

**Risks and mitigations:**

| Risk | Impact | Mitigation |
|---|---|---|
| `BriefLLMSchema` strict mode rejects a Zod constraint | `completeStructured` throws on every attempt | No `.min(1)` on any string field in `BriefLLMSchema`; only use plain `z.string()`, `z.enum()`, `z.number().int().nullable()` |
| `composeSmartDiff` depends on findings from the latest review — if no review exists yet, findings are `[]` | Smart-diff file list may be empty; this is valid (brief proceeds with only blast files in prFileSet) | The spec allows this; grounding gate handles empty file sets correctly |
| `BlastService.blastForPull` fails when repo-intel is disabled or degraded | Brief generation proceeds with empty `changed_symbols`; only smart-diff file paths in prFileSet | `BlastRadius.status` may be `"failed"`; brief service checks `blast.status` and logs a warning; grounding gate still runs on smart-diff paths |
| `tokensIn` accumulates across `completeStructured` retries (up to 2 attempts) | POST response `tokens_in` may exceed the 8K target when the model fails schema validation on attempt 1 | `maxRetries: 1` limits the blast to 2 × prompt tokens; per-source character caps (D7) keep the first-attempt prompt well under 4K tokens, giving headroom even with a retry |
| `wrapUntrusted` delimiter injection in issue body or context doc | INJECTION_GUARD neutralises it | Same mechanism as SPEC-01 and L05 run-executor — already tested there; covered by R8 hermetic test |
| Concurrent `POST /pulls/:id/brief` — two callers hit simultaneously | Both make an LLM call; last UPSERT wins | Spec explicitly accepts this (edge case section); both use the same inputs and produce semantically equivalent briefs; no data corruption |
| `PrBrief` removal breaks a downstream consumer not found in grep | TypeScript build errors in Wave 1 verification | `pnpm tsc --noEmit` on both server and client is the T1 acceptance gate; will fail loudly if `PrBrief` is consumed anywhere |

---

## Verification per task

- **T1**: `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` — zero errors;
  `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` — zero errors.
  Spot check: `grep -r "PrBrief" /Users/admin/dev-digest/server/src /Users/admin/dev-digest/client/src` returns only comments (no type usages).

- **T2**: `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` — zero errors;
  `cd /Users/admin/dev-digest/server && pnpm exec vitest run src/modules/brief`
  (hermetic unit tests for prompt assembly, grounding gate, single-call invariant).
  Integration smoke: with the server running and Postgres seeded —
  `curl -s -H "Cookie: <ws-cookie>" http://localhost:3001/pulls/<prId>/brief` returns
  `{ "brief": null }` (HTTP 200); `curl -s -X POST … /pulls/<no-intent-prId>/brief`
  returns HTTP 422 with `code: "intent_required"`.

- **T3**: `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` — zero errors;
  `cd /Users/admin/dev-digest/client && pnpm exec vitest run src/app/repos` (existing
  component unit tests continue to pass). Manual browser check: PR Overview tab renders
  `PrBriefCard` above the IntentCard+BlastRadiusCard grid; empty state and Generate
  button visible for a PR with no seeded brief.
