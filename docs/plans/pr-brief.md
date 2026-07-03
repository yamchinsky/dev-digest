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
| R2 | AC-3 | `POST /pulls/:id/brief` returns HTTP 422 with `error.code === "validation_error"` and `error.details.code === "intent_required"` when no `pr_intent` row exists; no LLM call | DB-backed `.it.test.ts`: PR with no intent row → HTTP 422, response body `{ error: { code: "validation_error", details: { code: "intent_required" } } }`, mock LLM adapter 0 calls |
| R3 | AC-4, AC-8 | LLM prompt assembled from intent text, blast summary, smart-diff file-group stats, linked issue, and agent context docs; no diff hunk bodies (no `+`/`-`-prefixed diff lines) in any message | Hermetic unit: supply mock inputs for all five sources; call `assembleBriefMessages`; assert all five represented in output messages; assert no `+`/`-`-prefixed diff line content |
| R4 | AC-5 | Exactly one `completeStructured` call per `POST` generation | Hermetic unit: inject call-counting mock LLM; trigger generation; assert adapter received exactly 1 call |
| R5 | AC-6, AC-7 | Grounding gate: filter `Risk.file_refs` against PR changed file set (drop empty-ref risks); drop `review_focus` entries whose `file` is outside the set; `POST` response includes `dropped_items` count | DB-backed `.it.test.ts`: mock LLM returns mixed valid/invalid file-ref items; persisted `BriefRecord.risks` + `review_focus` contain only grounded items; `POST` response `dropped_items ≥ 1` |
| R6 | AC-9 | `tokens_in` in `POST` response ≤ 8 000 for the reference integration-test PR fixture | DB-backed `.it.test.ts`: mock LLM echoes `tokensIn` derived from the assembled prompt length; assert response `tokens_in ≤ 8000` |
| R7 | AC-10 | Agent-level context docs collected from all workspace agents in deterministic creation order, deduped by `(repo_id, relative_path)` (first-occurrence wins), zero-byte files silently skipped | DB-backed `.it.test.ts`: two agents with overlapping paths + one zero-byte file; each unique path read exactly once from mock clone dir; zero-byte file absent from the assembled prompt |
| R8 | AC-11 | All untrusted text (intent, linked issue title+body, blast summary, smart-diff stats, context doc content) wrapped with `wrapUntrusted`; `INJECTION_GUARD` in system message | Hermetic unit: all five input types enclosed in `<untrusted …>` delimiters; system message contains the `INJECTION_GUARD` sentinel string |
| R9 | AC-12, AC-13, AC-14, AC-15 | `PrBriefCard` renders three states (empty/generate, populated with usage line, 422-hint) and supports Regenerate with loading indicator; file links navigate to `?tab=diff&file=<path>` and the diff tab scrolls the target file card into view | e2e: empty state visible with no content fields (AC-12); populated card is first element above Intent+Blast grid (AC-13); 422 hint state after no-intent POST (AC-14); Regenerate shows loading then updates content (AC-15); file link click navigates to diff tab and matching FileCard is visible in viewport |

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
| D5 | `resolveLinkedIssue` — export from `modules/reviews/intent.ts` and import in `modules/brief/helpers.ts` | partially accepted — cross-module import of a helper follows the established `RepoRepository` cross-module precedent; exporting the existing function (one-line change) is cleaner than duplicating 20 lines; T2 owns the export addition in `reviews/intent.ts` |
| D6 | File links in `PrBriefCard` navigate to `?tab=diff&file=<path>`; `DiffTab` reads the `file` param and scrolls the matching `FileCard` into view via a stable `id` on each `FileCard` wrapper in `DiffViewer` | accepted — file-level anchoring is achievable with minimal changes to two shared components; rendered as real `<a href>` for middle-click/copy semantics with `onClick` SPA navigation |
| D7 | Per-source character caps during prompt assembly (no pre-call truncation): blast summary ≤ 2 000 chars; linked issue body ≤ 1 500 chars; each context doc ≤ 1 500 chars; intent text ≤ 3 000 chars | accepted — keeps assembled prompt well under the 8 000-token budget without violating the spec's "no pre-call truncation" non-goal |

## Affected packages / modules

- **server** — new `modules/brief/` (routes.ts, service.ts, repository.ts, helpers.ts);
  one-line `export` addition in `modules/reviews/intent.ts`; update `modules/index.ts`
- **shared (dual-vendored)** — extend `server/src/vendor/shared/contracts/brief.ts` and
  `client/src/vendor/shared/contracts/brief.ts` (byte-identical): remove `PrBrief`
  aggregate stub; add `ReviewFocusItem`, `BriefRecord`; no barrel update needed
  (brief.ts already re-exported via `export * from './contracts/brief.js'` in both index.ts files)
- **client** — new `lib/hooks/brief.ts`; update `lib/hooks/index.ts`; new
  `_components/PrBriefCard/{PrBriefCard.tsx,styles.ts,index.ts}`; update
  `_components/OverviewTab/OverviewTab.tsx`; update `_components/DiffTab/DiffTab.tsx`;
  update `components/diff-viewer/DiffViewer/DiffViewer.tsx`; new `messages/en/brief.json`;
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
  - Spot check: `grep -r "PrBrief" /Users/admin/dev-digest/server/src /Users/admin/dev-digest/client/src`
    returns only comments (no type usages).

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
  - `server/src/modules/reviews/intent.ts` (one-line `export` addition only — D5)

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

  **`server/src/modules/reviews/intent.ts`** — add `export` keyword to
  `resolveLinkedIssue` (D5). Change:
  ```ts
  async function resolveLinkedIssue(
  ```
  to:
  ```ts
  export async function resolveLinkedIssue(
  ```
  No other changes to this file.

  **`helpers.ts`** — module-internal utilities. This file contains the LLM schema,
  path normalizer, prompt assembler, grounding gate, and the linked-issue resolver
  import.

  **`normalizePath(p: string): string`** — canonicalize a file path to repo-relative
  POSIX before grounding-set membership checks. Strips a leading `./`, converts
  `\` to `/`, trims whitespace. Used on BOTH the prFileSet entries AND the
  LLM-returned `file_refs` / `review_focus.file` values before comparison:
  ```ts
  export function normalizePath(p: string): string {
    return p.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  }
  ```

  **`BriefLLMSchema`** — raw LLM output type (module-internal, never shared):
  ```ts
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

  **`assembleBriefMessages(inputs: BriefInputs): { system: string; user: string }`**
  — builds the LLM messages from typed inputs. `BriefInputs` carries: `intent`
  (text), `blastSummary`, `smartDiffStats` (text serialisation of file-group role
  + path + additions + deletions, no hunk content), `linkedIssue`
  (`{ title: string; body: string } | null`), and `contextDocContents` (`string[]`).

  All five untrusted surfaces MUST be wrapped (AC-11) — wrap each explicitly:
  1. `wrapUntrusted('intent', intent.slice(0, 3_000))`
  2. `wrapUntrusted('blast-summary', blastSummary.slice(0, 2_000))`
  3. `wrapUntrusted('smart-diff', smartDiffStats)` — stats block is structured
     but contains contributor-controlled file paths
  4. `wrapUntrusted('linked-issue', `${linkedIssue.title}\n\n${linkedIssue.body.slice(0, 1_500)}`)` when linkedIssue non-null; entire slot omitted when null
  5. `wrapUntrusted(\`context-doc-${N}\`, content.slice(0, 1_500))` per context doc

  System message must include `INJECTION_GUARD`:
  ```ts
  const system = `You are a senior code reviewer producing a structured PR brief. ${INJECTION_GUARD}`;
  ```

  **`groundBrief(llmOutput: BriefLLMOutput, prFileSet: Set<string>)`**:
  ```
  → { risks: Risk[], review_focus: ReviewFocusItem[], droppedItems: number }
  ```
  Implements AC-6 gate. IMPORTANT — normalize ALL paths before comparison:
  1. Build `normalizedSet = new Set([...prFileSet].map(normalizePath))`.
  2. For each risk: `filteredRefs = risk.file_refs.map(normalizePath).filter(f => normalizedSet.has(f))`; drop risk when `filteredRefs` is empty, else keep with filtered refs.
  3. For each `review_focus` entry: drop when `normalizePath(entry.file)` is not in `normalizedSet`.
  4. `droppedItems` = count of dropped risks + dropped focus entries.

  Re-export `resolveLinkedIssue` from `reviews/intent.ts`:
  ```ts
  export { resolveLinkedIssue } from '../reviews/intent.js';
  ```

  **`repository.ts`** — reads and writes the `pr_brief` table and ancillary PR data:

  ```ts
  export class BriefRepository {
    constructor(private db: Db) {}

    async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined>
    async getIntent(prId: string): Promise<Intent | undefined>

    async getBrief(
      prId: string,
      logger?: { warn: (msg: string) => void },
    ): Promise<BriefRecord | null> {
      const [row] = await this.db
        .select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
      if (!row) return null;
      const parsed = BriefRecord.safeParse(row.json);
      if (!parsed.success) {
        logger?.warn(`pr_brief row for prId=${prId} failed schema validation — returning null`);
        return null;
      }
      return parsed.data;
    }

    async upsertBrief(prId: string, json: BriefRecord): Promise<void>
    // INSERT INTO pr_brief (pr_id, json) VALUES (…) ON CONFLICT (pr_id)
    // DO UPDATE SET json = EXCLUDED.json
  }
  ```

  `getBrief` uses `BriefRecord.safeParse` (not `.parse`) so a malformed stored
  jsonb logs a warning and returns `null` — GET always responds HTTP 200.

  **`service.ts`** — business logic:

  `BriefService(container: Container)` — constructor; creates:
  - `this.repo = new BriefRepository(container.db)`
  - `this.repoRepo = new RepoRepository(container.db)`

  `getBrief(workspaceId: string, prId: string)`:
  1. `const pull = await this.repo.getPull(workspaceId, prId)`; throw `NotFoundError`
     when absent (PR does not belong to workspace).
  2. Return `{ brief: await this.repo.getBrief(prId) }` — null when no row.

  `generateBrief(workspaceId: string, prId: string)`:
  1. `const pull = await this.repo.getPull(workspaceId, prId)`; throw `NotFoundError`.
  2. `const intent = await this.repo.getIntent(prId)`; if absent throw:
     ```ts
     throw new ValidationError(
       'Compute the PR intent before generating a brief.',
       { code: 'intent_required' },
     );
     ```
     This produces the envelope `{ error: { code: 'validation_error', message: '…',
     details: { code: 'intent_required' } } }` — matching the platform taxonomy's
     `ValidationError` constructor: `super('validation_error', message, 422, details)`.
  3. `const repo = await this.repoRepo.getById(workspaceId, pull.repoId)`;
     throw `NotFoundError` when absent.
  4. Gather inputs in parallel:
     ```ts
     const [blast, smartDiff, linkedIssue] = await Promise.all([
       new BlastService(this.container).blastForPull(workspaceId, prId),
       new ReviewService(this.container).smartDiffForPull(workspaceId, prId),
       resolveLinkedIssue(this.container, repo, pull.body),
     ]);
     ```
  5. Build `prFileSet: Set<string>` using normalized paths:
     ```ts
     const rawFilePaths = [
       ...blast.changed_symbols.map(s => s.file),
       ...smartDiff.groups.flatMap(g => g.files.map(f => f.path)),
     ];
     const prFileSet = new Set(rawFilePaths.map(normalizePath));
     ```
  6. Collect context docs in deterministic order (AC-10):
     ```
     a. const agents = await this.container.agentsRepo.list(workspaceId)
        // list() returns rows in DB insertion order; sort by agent.id (UUID) for
        // deterministic ordering if multiple agents were inserted in the same transaction.
     b. For each agent in order, call getContextDocPaths(agent.id)
        // paths are already ordered by `order` ASC inside each agent.
     c. Merge + dedup by normalizePath(repoId + ':' + relativePath); first-occurrence wins.
     d. Batch-fetch clone paths: this.repoRepo.getClonePathsByIds(uniqueRepoIds).
     e. Read files with existsSync + readFile; skip missing (warn in server log), skip zero-byte (silent).
     f. contextDocContents: string[] of successfully read + non-empty file contents.
     ```
  7. Build `smartDiffStats`: serialise each `SmartDiffGroup` as plain text:
     `[role]\n<path> (+N -N)\n…` — no pseudocode_summary, no hunk bodies, no findings.
  8. Build `intentText`:
     `${intent.intent}\nIn scope: ${intent.in_scope.join(', ')}\nOut of scope: ${intent.out_of_scope.join(', ')}`.
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

  **Error mapping** (global error handler in `app.ts` handles all):
  - `NotFoundError` → 404
  - `ValidationError` → 422 with `{ error: { code: 'validation_error', details: { code: 'intent_required' } } }`
  - `ExternalServiceError` → 502
  - `ConfigError` → 500

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
  ```

  Response schemas (registered automatically via `serializerCompiler` when the
  `response` key is present — this is the runtime validation gate per INSIGHTS):
  ```ts
  const BriefGetResponse = z.object({ brief: BriefRecord.nullable() });
  const BriefPostResponse = z.object({
    brief: BriefRecord,
    dropped_items: z.number().int(),
  });
  ```

  Both routes call `getContext(container, req)` first.

  **`server/src/modules/index.ts`** — add one import and one entry:
  ```ts
  import brief from './brief/routes.js';
  // in the modules object:
  brief,
  ```

- **Acceptance**:
  - `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` — zero errors.
  - `curl -s -H "Cookie: <ws-cookie>" http://localhost:3001/pulls/<valid-prId>/brief`
    returns `{ "brief": null }` for a PR without a seeded row (HTTP 200).
  - `curl -s -X POST … /pulls/<no-intent-prId>/brief` returns HTTP 422 with body
    `{ "error": { "code": "validation_error", "details": { "code": "intent_required" } } }`.
  - Hermetic unit: inject mock LLM → trigger generation → assert exactly 1
    `completeStructured` call; assert mock LLM messages contain all five
    `<untrusted …>` wrappers including `source="linked-issue"` and `source="smart-diff"`.

- **Depends-on**: T1

- **Red flags**:
  - **Path normalization is mandatory on both sides**: call `normalizePath()` on every
    path before inserting into `prFileSet` AND on every LLM-returned `file_refs` /
    `review_focus.file` value before grounding comparison. Without this,
    `./src/foo.ts` ≠ `src/foo.ts` and valid risks are silently dropped.
  - **`ValidationError` for intent-required, NOT `AppError`**: verify the exact
    `ValidationError` constructor in `platform/errors.ts` before using it:
    `new ValidationError(message, details?)` → `super('validation_error', message, 422, details)`.
    The `intent_required` discriminator lives in `details: { code: 'intent_required' }`.
    The response envelope is `{ error: { code: 'validation_error', message: '…', details: { code: 'intent_required' } } }`.
  - **`getBrief` uses `safeParse`, not `parse`**: a malformed stored jsonb must
    log a warning (with `prId`) and return `null`, never throw — GET must always
    respond HTTP 200. Pass `this.container.log` (or equivalent) as the logger.
  - **`resolveLinkedIssue` import path**: it is exported from `../reviews/intent.js`
    (ESM `.js` suffix required). Confirm the export was added before importing.
  - **Context-doc ordering (F6)**: the dedup key is
    `normalizePath(repoId + ':' + relativePath)`. First-occurrence wins. Agents ordered
    by `agentsRepo.list()` insertion order (sort by `agent.id` if needed for stability).
    Docs within each agent already ordered by `order` ASC.
  - ESM imports: all internal server imports use `.js` suffix.
  - `BriefLLMSchema` must NOT use `.min(1)` on any string field — OpenAI strict
    JSON schema rejects `minLength` constraints; Zod validates after the call.
  - `dropped_items` is returned in the POST response only; must NOT be stored
    in `pr_brief.json`.
  - The `pr_brief` table column is `json jsonb NOT NULL`. In Drizzle:
    `jsonb('json').$type<BriefRecord>()`. The Drizzle row field is `.json`.
  - Rate limit for POST brief (5/min) is tighter than review (10/min) because each
    call makes an LLM call.

---

### T3 — Client: hooks + PrBriefCard + OverviewTab mount + file scroll · type: ui · covers: R9

- **Owned paths**:
  - `client/src/lib/hooks/brief.ts` (new)
  - `client/src/lib/hooks/index.ts`
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx` (new)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/styles.ts` (new)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/index.ts` (new)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`
  - `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx`
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

  **`components/diff-viewer/DiffViewer/DiffViewer.tsx`** — add `targetFile` prop;
  wrap each `FileCard` in a stable-id div; auto-expand the matching file:

  ```tsx
  export function DiffViewer({
    files,
    commenting,
    targetFile,         // NEW prop
  }: {
    files: PrFile[];
    commenting?: DiffCommentApi;
    targetFile?: string;
  }) {
    const t = useTranslations("shell");
    if (!files || files.length === 0) {
      return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
    }
    return (
      <div style={s.list}>
        {files.map((f, i) => (
          <div key={f.path || i} id={`diff-file-${encodeURIComponent(f.path)}`}>
            <FileCard
              file={f}
              commenting={commenting}
              defaultOpen={f.path === targetFile || undefined}
            />
          </div>
        ))}
      </div>
    );
  }
  ```

  The `id` attribute on the wrapper div is the stable anchor used by the scroll
  effect in `DiffTab`. `key` changes from `i` to `f.path || i` for stable DOM
  identity. `defaultOpen` is passed `undefined` (not `false`) for non-target files
  to preserve the existing `AUTO_EXPAND_MAX_LINES` auto-rule in `FileCard`.

  **`_components/DiffTab/DiffTab.tsx`** — read `file` URL param; pass `targetFile`
  to `DiffViewer`; add scroll effect:

  ```tsx
  // Add to existing imports:
  import { useSearchParams } from "next/navigation";

  export function DiffTab({ prId, filesCount, files, canComment, onOpenFinding }: DiffTabProps) {
    const searchParams = useSearchParams();
    const targetFile = searchParams.get("file") ?? undefined;

    // Scroll the target FileCard into view after the diff renders.
    React.useEffect(() => {
      if (!targetFile) return;
      const id = `diff-file-${encodeURIComponent(targetFile)}`;
      const timer = setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(timer);
    }, [targetFile]);

    // ...existing hook calls (commenting API, etc.)...

    return (
      <section>
        {/* ...existing SectionLabel... */}
        <DiffViewer files={files} commenting={commentingApi} targetFile={targetFile} />
        {/* ...existing SmartDiffViewer... */}
      </section>
    );
  }
  ```

  The 100 ms delay allows the diff content to paint before scrolling. `DiffTab` is
  always rendered inside the `<Suspense>` boundary already present in `page.tsx`
  (`PRDetailPage` wraps `PRDetailPageInner` in `<Suspense>`) — `useSearchParams()`
  is safe here without an additional boundary.

  **`PrBriefCard.tsx`** — feature component. States in render order:

  ```tsx
  "use client";
  import React from "react";
  import { useParams, useSearchParams, useRouter } from "next/navigation";
  import { useTranslations } from "next-intl";
  import { useBrief, useGenerateBrief } from "@/lib/hooks/brief";
  import { ApiError } from "@/services/api";
  // import styles, Skeleton, Button, EmptyState from @devdigest/ui

  export function PrBriefCard({ prId }: { prId: string }) {
    const params = useParams<{ repoId: string; number: string }>();
    const searchParams = useSearchParams();
    const router = useRouter();
    const t = useTranslations("brief");
    const { data, isLoading } = useBrief(prId);
    const generate = useGenerateBrief(prId);

    // Build the diff-tab URL for a given file path (D6).
    // Real <a href> enables middle-click / copy; onClick overrides for SPA nav.
    const diffUrl = (file: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", "diff");
      sp.set("file", file);
      return `/repos/${params.repoId}/pulls/${params.number}?${sp.toString()}`;
    };

    if (isLoading) return <Skeleton height={120} />;

    // 422 intent-required hint (AC-14).
    // IMPORTANT: MutationCache.onError in providers/index.tsx fires notify.error
    // unconditionally for ALL mutation errors (line 42: `onError: (err) =>
    // notify.error(errorMessage(err))`). There is no per-mutation suppression.
    // The 422 WILL both toast globally AND render the inline hint. This is the
    // accepted double-signal pattern — do NOT modify providers.tsx to suppress it.
    const isIntentRequired =
      generate.error instanceof ApiError &&
      generate.error.status === 422 &&
      (generate.error.details as { code?: string } | undefined)?.code === 'intent_required';

    if (isIntentRequired) {
      return (
        <div style={s.card}>
          <EmptyState icon="FileText" title={t("empty.title")} body={t("intentRequired")} />
        </div>
      );
    }

    // Empty state — no brief yet (AC-12)
    if (!data?.brief) {
      return (
        <div style={s.card}>
          <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
          <Button kind="primary" loading={generate.isPending} onClick={() => generate.mutate()}>
            {t("actions.generate")}
          </Button>
        </div>
      );
    }

    // Populated brief (AC-13)
    const brief = data.brief;
    return (
      <div style={s.card}>
        {/* risk_level badge */}
        <span
          style={s.riskBadge[brief.risk_level]}
          aria-label={t("a11y.riskBadge", { level: t(`riskLevel.${brief.risk_level}`) })}
        >
          {t(`riskLevel.${brief.risk_level}`)}
        </span>

        <section><h3>{t("sections.what")}</h3><p>{brief.what}</p></section>
        <section><h3>{t("sections.why")}</h3><p>{brief.why}</p></section>

        {/* risks list */}
        <section>
          <h3>{t("sections.risks")}</h3>
          <ul>
            {brief.risks.map((risk, i) => (
              <li key={i}>
                <strong>{risk.title}</strong> — {risk.explanation}
                {risk.file_refs.length > 0 && (
                  <ul>
                    {risk.file_refs.map((file) => (
                      <li key={file}>
                        {/* Real <a> for middle-click/copy; SPA nav via onClick */}
                        <a
                          href={diffUrl(file)}
                          aria-label={t("a11y.fileLink", { file })}
                          onClick={(e) => { e.preventDefault(); router.push(diffUrl(file)); }}
                        >
                          {file}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* review_focus list */}
        <section>
          <h3>{t("sections.reviewFocus")}</h3>
          <ol>
            {brief.review_focus.map((item, i) => (
              <li key={i}>
                <a
                  href={diffUrl(item.file)}
                  aria-label={t("a11y.fileLink", { file: item.file })}
                  onClick={(e) => { e.preventDefault(); router.push(diffUrl(item.file)); }}
                >
                  {item.file}{item.line != null ? `:${item.line}` : ""}
                </a>
                {" — "}{item.reason}
              </li>
            ))}
          </ol>
        </section>

        {/* usage line (AC-13) */}
        <p style={s.usage}>
          {t("usage", {
            tokensIn: brief.tokens_in,
            tokensOut: brief.tokens_out,
            costUsd: brief.cost_usd != null ? `$${brief.cost_usd.toFixed(4)}` : "—",
          })}
        </p>

        {/* Regenerate (AC-15) */}
        <Button kind="secondary" loading={generate.isPending} disabled={generate.isPending}
          onClick={() => generate.mutate()}>
          {t("actions.regenerate")}
        </Button>
      </div>
    );
  }
  ```

  **`OverviewTab.tsx`** — insert `PrBriefCard` as the FIRST rendered child,
  before the Intent+Blast grid (AC-13):

  ```tsx
  import { PrBriefCard } from "../PrBriefCard";

  export function OverviewTab({ prBody, prId }: OverviewTabProps) {
    return (
      <>
        {prId && <PrBriefCard prId={prId} />}

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

  **`PrBriefCard/index.ts`**:
  ```ts
  export { PrBriefCard } from "./PrBriefCard";
  ```

- **Acceptance**:
  - `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` — zero errors.
  - PR Overview tab with no `pr_brief` row: `PrBriefCard` empty-state visible
    above the grid; no `what`/`why`/`risk_level` elements in DOM.
  - PR Overview tab with seeded `pr_brief` row: `PrBriefCard` renders first
    (before IntentCard+BlastRadiusCard grid in DOM order); risk badge, risks list,
    review_focus list, and usage line all visible.
  - Click a file link in `risks` or `review_focus`: page navigates to diff tab;
    the element with `id="diff-file-<encoded-path>"` is in the viewport (scrolled
    into view); the matching FileCard is expanded (`defaultOpen` applied).
  - Click "Generate Brief" on a PR with no `pr_intent` row: the global toast fires
    (MutationCache unconditional — this is expected and accepted) AND the inline
    hint-state renders with text referencing intent computation.
  - Regenerate button: shows loading indicator; on mock POST resolve, the brief
    content updates without a page reload.

- **Depends-on**: T1

- **Red flags**:
  - **DiffTab `useSearchParams` + Suspense**: `DiffTab` is rendered only inside
    `PRDetailPageInner`, which is wrapped in `<Suspense>` in `page.tsx` — no
    additional wrapper needed. Do NOT add another `<Suspense>`.
  - **`DiffViewer` key change**: change `key={i}` to `key={f.path || i}` to ensure
    stable DOM identity for the `id`-based scroll target.
  - **`defaultOpen` semantics**: pass `defaultOpen={f.path === targetFile || undefined}` —
    `undefined` (not `false`) preserves the existing `AUTO_EXPAND_MAX_LINES` auto-rule
    for non-target files. Passing `false` would collapse all non-target files.
  - **Global toast on 422**: `MutationCache.onError` in `providers/index.tsx` fires
    `notify.error` for ALL mutation errors unconditionally (no `4xx` exception for
    mutations — only queries suppress below 500). The 422 WILL toast globally AND
    the card renders an inline hint. This is the only available pattern without
    modifying `providers.tsx`. Do not attempt to suppress the toast.
  - **`generate.error.details` typing**: `ApiError.details` is `unknown`; cast with
    `(generate.error.details as { code?: string } | undefined)?.code` to safely read
    the `intent_required` discriminator.
  - Never hardcode English strings in JSX — all user-facing text via `useTranslations("brief")`.
  - i18n namespaces are auto-discovered from filenames — no registry to update.
  - Do NOT mix border shorthand/longhand in `styles.ts` — use consistent
    `border: '1px solid …'` to avoid Stylex/React DOM warnings.
  - `PrBriefCard` must NOT import `OverviewTab` (direction: OverviewTab imports PrBriefCard).
  - `useGenerateBrief.onSuccess` writes to `["brief", prId]` — the key must match
    `useBrief`'s `queryKey` exactly.
  - `"use client"` at the top of `PrBriefCard.tsx` is required because it uses
    `useRouter`, `useSearchParams`, and `useParams`.

---

## Test intents

What must be tested — statements, not tasks. While `test-writer` is disabled, these
land in the run's manual checklist after each wave commit.

- **R1** → `server-it` (`*.it.test.ts`): seed a `pr_brief` row with known JSON; call
  `GET /pulls/:id/brief`; assert HTTP 200 and body matches seeded data; assert mock LLM
  adapter received 0 calls. Also: seed no row; assert `{ brief: null }` with HTTP 200.
  Malformed-jsonb case: insert a row with `json = '"not-a-brief"'`; assert GET returns
  `{ brief: null }` with HTTP 200 (the `safeParse` path). (AC-1, AC-2)

- **R2** → `server-it`: seed PR with no `pr_intent` row; call `POST /pulls/:id/brief`;
  assert HTTP 422; assert response body
  `{ error: { code: "validation_error", details: { code: "intent_required" } } }`;
  assert mock LLM 0 calls. (AC-3)

- **R3** → hermetic unit (`*.test.ts`): call `assembleBriefMessages` with mock inputs
  for all five sources; assert each source appears in the output including
  `<untrusted source="linked-issue">` (title + body) and `<untrusted source="smart-diff">`
  (file paths); assert output contains no `+`-prefixed or `-`-prefixed diff line content.
  (AC-4, AC-8)

- **R4** → hermetic unit: inject a call-counting mock `LLMProvider`; call
  `generateBrief` once; assert the mock received exactly 1 `completeStructured`
  invocation. (AC-5)

- **R5** → `server-it`: mock LLM returns
  `risks: [{…, file_refs: ['src/a.ts']}, {…, file_refs: ['./outside.ts']}]`
  and `review_focus: [{file: 'src/a.ts', …}, {file: 'outside.ts', …}]`;
  PR file set = `{'src/a.ts'}` only; assert persisted `brief.risks` has 1 entry
  with `file_refs: ['src/a.ts']`; assert `review_focus` has 1 entry with
  `file: 'src/a.ts'`; assert POST response `dropped_items === 2`. (AC-6, AC-7)

- **R6** → `server-it`: mock LLM echoes `tokensIn` proportional to prompt byte length;
  assert POST response `tokens_in ≤ 8000` for a reference PR fixture. (AC-9)

- **R7** → `server-it`: seed 2 agents with 3 paths (1 shared non-empty, 1 zero-byte
  shared); mock clone dir; trigger `generateBrief`; assert the shared non-empty path
  read exactly once; assert zero-byte path absent from LLM call messages. (AC-10)

- **R8** → hermetic unit: call `assembleBriefMessages` with all five inputs populated;
  assert system message contains `INJECTION_GUARD` sentinel; assert each of the five
  untrusted surfaces (`intent`, `blast-summary`, `smart-diff`, `linked-issue`,
  `context-doc-0`) appears wrapped in `<untrusted …>` / `</untrusted>`. (AC-11)

- **R9** → `e2e`: three flows — (1) PR with no `pr_brief` row: navigate to Overview
  tab; assert `PrBriefCard` empty-state visible; assert no `what`/`why`/`risk_level`
  badge in DOM. (2) PR with seeded `pr_brief` row: assert card is first child before
  the grid container; assert badge, risks, review_focus, usage line visible; click a
  `review_focus` file link; assert tab changes to diff and the target `FileCard`
  element is in viewport. (3) PR with no `pr_intent` row: click Generate Brief;
  assert inline hint text with intent reference visible (global toast also fires —
  both are part of the expected outcome). (AC-12, AC-13, AC-14, AC-15)

---

## Sequencing & risks

**Topological order — two waves:**

```
Wave 1 (serial):    T1
Wave 2 (parallel):  T2 (needs T1) || T3 (needs T1)
```

T2 and T3 are fully parallel in Wave 2 — no shared files.

**Critical path:** T1 → T2 (server) or T1 → T3 (client). Both converge at Wave 2.

**Commit cadence (one commit per wave):**
- Wave 1 commit: shared contracts (`BriefRecord`, `ReviewFocusItem`; remove `PrBrief`)
- Wave 2 commit: server module + `reviews/intent.ts` export + client hooks + card + DiffViewer + OverviewTab mount

**No human confirmation steps required:**
- The `pr_brief` table already exists — no migration.
- No new nav entries or VALID_TABS changes — card mounts in an existing tab.

**Risks and mitigations:**

| Risk | Impact | Mitigation |
|---|---|---|
| `BriefLLMSchema` strict mode rejects a Zod constraint | `completeStructured` throws on every attempt | No `.min(1)` on any string field in `BriefLLMSchema` |
| Path mismatch between blast/smart-diff file paths and LLM-returned refs | Valid risks silently dropped | `normalizePath()` applied to both sides before grounding comparison (Extra-CRITICAL) |
| `composeSmartDiff` returns empty files when no review exists yet | Smart-diff file list may be empty; prFileSet smaller | Brief proceeds with only blast files; grounding gate handles empty sets correctly |
| `BlastService.blastForPull` returns `status: "failed"` | Empty `changed_symbols`; only smart-diff paths in prFileSet | Spec explicitly allows this; brief continues with whatever files are available |
| `tokensIn` accumulates across retries (up to 2 attempts with `maxRetries: 1`) | POST response `tokens_in` can exceed 8K if first attempt fails schema validation | Character caps (D7) keep first-attempt prompt well under 4K, giving headroom |
| Malformed `pr_brief.json` in DB | `getBrief` throws if using `parse` | `safeParse` + warn + return null — GET always responds HTTP 200 (F2) |
| MutationCache toasts ALL errors including 422 | 422 double-signals (toast + inline hint) | Accepted — cannot suppress without modifying providers.tsx; both signals documented in T3 |
| `PrBrief` removal breaks a downstream consumer not found in grep | TypeScript build errors | T1 acceptance gate: `pnpm tsc --noEmit` on both packages fails loudly |
| Concurrent `POST /pulls/:id/brief` | Both make an LLM call; last UPSERT wins | Spec explicitly accepts this; no data corruption |

---

## Verification per task

- **T1**: `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` — zero errors;
  `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` — zero errors.
  `grep -r "PrBrief" /Users/admin/dev-digest/server/src /Users/admin/dev-digest/client/src`
  returns only comments, no type usages.

- **T2**: `cd /Users/admin/dev-digest/server && pnpm tsc --noEmit` — zero errors;
  `cd /Users/admin/dev-digest/server && pnpm exec vitest run src/modules/brief`
  (hermetic unit tests for prompt assembly, path normalization, grounding gate,
  single-call invariant).
  Integration smoke: `curl -s … /pulls/<prId>/brief` returns `{ "brief": null }` (HTTP 200);
  `curl -s -X POST … /pulls/<no-intent-prId>/brief` returns HTTP 422 with
  `{ "error": { "code": "validation_error", "details": { "code": "intent_required" } } }`.

- **T3**: `cd /Users/admin/dev-digest/client && pnpm tsc --noEmit` — zero errors;
  `cd /Users/admin/dev-digest/client && pnpm exec vitest run src/app/repos` — existing
  tests continue to pass. Manual browser check: PR Overview tab renders `PrBriefCard`
  above the grid; file link click navigates to diff tab and the target `FileCard`
  scrolls into view.

---

## Cross-model review dispositions (gpt-5-mini, 2026-07-03)

Staff-engineer cross-model review via OpenRouter (model: openai/gpt-5-mini). Verdict: REQUEST CHANGES. 12 findings + 1 extra from first pass.

| ID | Severity | Disposition | Detail |
|---|---|---|---|
| F1 | CRITICAL | **Accepted** | File links now render as real `<a href="?tab=diff&file=<path>">` with `onClick` for SPA nav and `aria-label`. `DiffViewer.tsx` wraps each `FileCard` in a div with a stable `id="diff-file-<encoded-path>"`. `DiffTab.tsx` reads the `file` URL param via `useSearchParams`, passes `targetFile` to `DiffViewer`, and adds a `useEffect` scroll with 100 ms delay. T3 now owns `DiffTab/DiffTab.tsx` and `components/diff-viewer/DiffViewer/DiffViewer.tsx`. |
| Extra-CRITICAL | CRITICAL | **Accepted** | `normalizePath(p: string): string` helper added to `helpers.ts` (strip `./`, convert `\` to `/`, trim). Called on every path before insertion into `prFileSet` AND on every LLM-returned `file_refs`/`review_focus.file` value before the grounding-set comparison. Prevented `./src/foo.ts` ≠ `src/foo.ts` silent drops. |
| F2 | CRITICAL | **Accepted** | `getBrief` uses `BriefRecord.safeParse(row.json)` instead of `.parse`. On failure, logs warn with `prId` and returns `null`. GET always responds HTTP 200. Malformed-jsonb test case added to R1 test intent. |
| F3 | WARNING | **Accepted** | All five untrusted surfaces explicitly enumerated in `assembleBriefMessages`: `intent`, `blast-summary`, `smart-diff` (contributor-controlled file paths), `linked-issue` (title + body jointly capped), `context-doc-N` per doc. R8 test intent updated to assert all five `<untrusted …>` wrappers. |
| F4 | WARNING | **Rejected** | D3 (internal `new BlastService(container)` + `new ReviewService(container)`) follows the repo convention per `server/AGENTS.md`: services take `Container` only; mocks are injected via `ContainerOverrides` at the container level. No import cycle (brief → blast/reviews, never the reverse). Internal peer-service instantiation is both testable and consistent with existing patterns. |
| F5 | WARNING | **Partially accepted** | `resolveLinkedIssue` is exported from `modules/reviews/intent.ts` (one-line change) and imported in `modules/brief/helpers.ts`. Cross-module helper import follows the `RepoRepository` cross-module precedent established in `onboarding-tours/service.ts`. T2 owned paths updated to include `reviews/intent.ts`. D5 wording updated from "inline" to "export + import". |
| F6 | WARNING | **Accepted** | Context-doc union now explicitly ordered: agents by `agentsRepo.list()` insertion order (sort by `agent.id` UUID for tiebreak), docs within each agent by `order ASC` (already guaranteed by repository query). Dedup key normalized via `normalizePath`. Stable prompts across runs. R7 test intent updated. |
| F7 | WARNING | **Rejected** | CI byte-identity guard for dual-vendored contracts is a repo-wide tooling concern outside SPEC-03 scope. The `pr-self-review` skill's shared-contracts bucket already diffs the vendor copies at PR-gate time. Recorded here as future work. |
| F8 | WARNING | **Accepted** | `generateBrief` step 2 now uses `new ValidationError('…', { code: 'intent_required' })` (verified against `platform/errors.ts`: constructor is `ValidationError(message?, details?)` → `super('validation_error', message, 422, details)`). Envelope: `{ error: { code: 'validation_error', details: { code: 'intent_required' } } }`. R2 acceptance criteria updated. T2 error-mapping section updated. 422 curl assertion updated. |
| F9 | WARNING | **Rejected** | `PrBrief` compat alias is unnecessary. `pnpm tsc --noEmit` gate plus `grep` spot-check confirm zero runtime or compile-time consumers. Nothing in this repo is published as an npm package (root AGENTS.md: "Nothing is published"). Removal stands. |
| F10 | NOTE | **Accepted — merged into F1** | Real `<a href>` rendering with `onClick` SPA nav is fully addressed by F1. No separate change. |
| F11 | WARNING | **Accepted** | Verified: `MutationCache.onError` in `providers/index.tsx` fires `notify.error(errorMessage(err))` unconditionally for ALL mutation errors. No per-mutation suppression exists. The 422 both toasts globally AND the card shows the inline hint. Documented as the accepted double-signal pattern in T3 task body and red flags. Acceptance criteria updated to assert both signals. |
| F12 | NOTE | **Rejected** | Cross-task PR sequencing is not applicable: tasks run in ONE shared working tree; the orchestrator commits per wave after both T2 and T3 complete; path disjointness (not PR ordering) prevents collisions. |
