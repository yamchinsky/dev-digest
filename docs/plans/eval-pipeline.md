# Implementation Plan: eval-pipeline

**Spec:** SPEC-04 (`specs/SPEC-04-2026-07-eval-pipeline.md`)

## Overview

DevDigest currently has no way to measure whether a change to an agent's system
prompt, model, or linked skills improved or regressed its behaviour. The Eval
Pipeline closes this gap: accepted/dismissed finding decisions become frozen test
cases; a batch executor replays those cases through the agent using pure arithmetic
scoring (zero LLM calls per scoring step); successive runs produce comparable
recall/precision/citation_accuracy metrics so regressions are immediately visible
and the L06 homework gate (`pnpm verify:l06`) is satisfiable.

## Execution mode: multi-agent

Ten parallel `implementer` instances across three dependency waves.

## Requirements

| ID | Covers AC | Requirement | Acceptance criteria (measurable) |
|---|---|---|---|
| R1 | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6 | Create an eval case from any accepted or dismissed finding via `POST /findings/:id/eval-case`; type derived from `accepted_at`/`dismissed_at`; diff frozen from git clone or reconstructed from `pr_files.patch`; 422 for undecided, null-agent-without-body, or unavailable diff; client shows a toast linking to `/agents/{agentId}?tab=evals` on success | Server returns 201 + `EvalCase` for accepted or dismissed findings; 422 for undecided (AC-3), null-agent-without-body (AC-4), or unavailable diff (AC-5); `expected_output.type` is `must_find` for accepted, `must_not_flag` for dismissed; `input_diff` is non-empty; client toast contains `/agents/{agentId}?tab=evals` link (AC-6) |
| R2 | AC-7, AC-8, AC-9 | Create and edit eval cases manually via dedicated Case Editor pages with name, diff-paste area, PR meta fields, structured expectation fields (type, file, start_line, end_line, note), and a synchronous "Run case" control; client rejects start_line > end_line before sending; server rejects same at route level with 422 | Case Editor renders name, Diff tab, PR meta tab, expectation fields, and Run Case button (AC-7); submitting with start_line > end_line shows a validation error and makes no fetch call (AC-8); `POST /eval-cases` with start_line > end_line returns 422 (AC-9) |
| R3 | AC-10, AC-11 | Evals tab in AgentEditor shows all cases for an agent via `GET /agents/:id/eval-cases`, each with name, last-run pass/fail status ("never run" if no run), and recall from the last batch that includes it; empty state when no cases exist | Evals tab renders case names with pass/fail or "never run" status (AC-10); empty state visible when `GET /agents/:id/eval-cases` returns `[]` (AC-11) |
| R4 | AC-12, AC-13, AC-14, AC-15, AC-16, AC-17 | Batch run: `POST /agents/:id/eval-runs` returns 202 + `EvalBatch{status:'running'}` with snapshotted agent config; executes all cases fire-and-forget; per-case engine errors record `pass=false` and continue; missing provider/secret fails batch before any case runs; boot reaper marks orphaned `running` batches `failed`; completed batch persists recall, precision, citation_accuracy, cases_total, cases_passed, duration_ms, cost_usd | HTTP 202 with batch row carrying snapshotted `system_prompt` (AC-12); 422 for zero-case agent (AC-13); engine error on one case → run row has `pass=false` + error, batch ends `done` (AC-14); missing provider → batch `failed`, no eval_run rows (AC-15); boot reaper sets orphaned `running` batches to `failed` with `error='orphaned by restart'` (AC-16); completed batch row has non-null recall/precision/citation_accuracy/cost_usd (AC-17) |
| R5 | AC-18, AC-19, AC-20, AC-21, AC-22 | Pure-arithmetic scoring: `matchesExpectation(exp, finding)` = same file + inclusive line-range intersection; recall = matched must_find / total must_find (0/0 → 1.0); precision = TP / (TP+FP) where FP = matched must_not_flag only (0/0 → 1.0); citation_accuracy = sum(survivors) / sum(survivors+dropped) (0/0 → 1.0); zero LLM calls in scoring module | `matchesExpectation` returns true iff same file and ranges overlap (AC-18); hermetic unit tests assert recall=0.5 for 1/2 must_find matched (AC-19); precision=0.5 for 1 TP + 1 FP (AC-20); citation_accuracy = arithmetic sum (AC-21); scoring module import graph contains no LLM adapter (AC-22) |
| R6 | AC-23, AC-24 | Run history: `GET /agents/:id/eval-runs` returns completed and running batch records in reverse-chronological order, excluding single-case runs (batch_id=NULL); client polls `GET /eval-runs/:id` at 1 500 ms while status is `running` and stops on `done`/`failed` | GET /agents/:id/eval-runs excludes batch_id=NULL rows; single-case run is absent from list (AC-23); client polling hook stops when status transitions to done/failed (AC-24) |
| R7 | AC-25 | Trend chart in Evals tab renders three series (recall, precision, citation_accuracy) for completed batch runs in chronological order; each point tooltip shows model, provider, cost | TrendChart renders with three series when at least one done batch exists; each data point maps to one batch run; chart not rendered when zero done batches (AC-25) |
| R8 | AC-26, AC-27 | Client-side compare view: user selects two completed batch runs; client fetches two `EvalBatchDetail` responses and renders metric deltas (run B − run A) and per-case pass/fail flip table; no dedicated compare API endpoint | CompareView renders metric deltas and flip table from two EvalBatchDetail props (AC-26); no additional fetch beyond the two detail calls (AC-27) |
| R9 | AC-28 | Batch run records in run history display `cost_usd` formatted as USD; null cost_usd displays "—" | cost_usd=0.042 renders "$0.042"; cost_usd=null renders "—" (AC-28) |
| R10 | AC-29 | Seed five eval cases for the General Reviewer against demo PR #482 idempotent by (workspaceId, ownerId, name): stripe-key-leak (must_find), n-plus-one-users (must_find), ratelimit-comparison-bug (must_find), readme-docs-noise (must_not_flag), safe-var-rename (must_not_flag); each has a non-empty `input_diff` with correct hunk headers | Running `seed(db)` twice yields exactly five eval_cases rows for the General Reviewer; each has non-empty input_diff with valid `@@ -N,M +N,M @@` hunk headers (AC-29) |
| R11 | AC-30 | All case inputs (input_diff, input_meta title/body, derived intent) supplied to `reviewPullRequest` through `wrapUntrusted` / `INJECTION_GUARD` path; skill bodies are not wrapped (they are trusted) | The assembled prompt passed to reviewPullRequest wraps input_diff and PR title/body in `<untrusted source="...">` delimiters; the system message contains INJECTION_GUARD sentinel text (AC-30) |
| R12 | — | Root `pnpm verify:l06` script: server typecheck + client typecheck + reviewer-core build + scoring unit tests + seed integration test + client eval component tests + spec file existence check | `bash scripts/verify-l06.sh` exits 0; `package.json` at repo root contains `verify:l06` script |

### Descoped ACs

None — all 30 ACs are covered above.

### Open recommendations

None — the spec is approved with no open design questions; codebase contradictions flagged inline as red flags per task.

## Affected packages / modules

- **server** — new module `modules/eval/` (`routes.ts`, `service.ts`, `repository.ts`, `scoring.ts`, `eval.it.test.ts`, `scoring.test.ts`); extend `modules/index.ts`; extend `db/schema/eval.ts` (new `evalRunBatches` table + `batchId` on `evalRuns`); extend `db/schema.ts` barrel; extend `db/rows.ts`; new migration `0014_*`; new seed `db/seed-eval-cases.ts` + its integration test; extend `app.ts` (boot reaper for batches)
- **shared (dual-vendored)** — new `contracts/eval-scoring.ts` in both `server/src/vendor/shared/` and `client/src/vendor/shared/`; both barrels updated
- **client** — new `lib/hooks/evals.ts`; update `lib/hooks/index.ts`; new `AgentEditor/_components/EvalsTab/`; update `AgentEditor/constants.ts`, `AgentEditor.tsx`, `agents/[id]/page.tsx`; new `agents/[id]/eval-cases/` pages + `CaseEditor` component; update `FindingCard.tsx`, `FindingsPanel.tsx`; update `messages/en/eval.json`, `messages/en/prReview.json`
- **root** — new `package.json` (minimal), new `scripts/verify-l06.sh`
- **reviewer-core** — no changes (INJECTION_GUARD is already exported from `reviewer-core/src/prompt.ts`)

---

## Tasks (parallel units)

Each task = one `implementer` instance, running in the same shared working tree.
Owned paths across tasks MUST be disjoint — no file appears in two tasks.

---

### T1 — DB Schema & Migration · type: backend · covers: R4, R10

- **Owned paths**:
  - `server/src/db/schema/eval.ts`
  - `server/src/db/schema.ts`
  - `server/src/db/rows.ts`
  - `server/src/db/migrations/0014_eval_run_batches.sql` (generated; exact name assigned by Drizzle)

- **Skills (mandatory)**: `drizzle-orm-patterns`, `postgresql-table-design`

- **Task**: Modify `server/src/db/schema/eval.ts` to add the `evalRunBatches` table and a nullable `batchId` column to `evalRuns`.

  **Order matters**: define `evalRunBatches` BEFORE `evalRuns` in the file so the FK arrow-function reference resolves cleanly. The current order is `evalCases` → `evalRuns` → `conformanceChecks` → `composedReviews`; insert `evalRunBatches` between `evalCases` and `evalRuns`.

  New `evalRunBatches` table (references `workspaces` from `./core` and `agents` from `./agents`; add those imports if not present):
  ```ts
  export const evalRunBatches = pgTable('eval_run_batches', {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['running', 'done', 'failed'] }).notNull().default('running'),
    agentVersion: integer('agent_version'),
    systemPrompt: text('system_prompt').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    strategy: text('strategy').notNull().default('auto'),
    skillBodies: jsonb('skill_bodies').$type<string[]>(),
    casesTotal: integer('cases_total').notNull(),
    casesPassed: integer('cases_passed'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    costUsd: doublePrecision('cost_usd'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  });
  ```

  Add `batchId` to the existing `evalRuns` table definition (insert after the existing `caseId` column):
  ```ts
  batchId: uuid('batch_id').references(() => evalRunBatches.id, { onDelete: 'cascade' }),
  ```

  `batchId` is nullable (no `.notNull()`). Single-case sync runs have `batch_id = NULL`.

  In `server/src/db/schema.ts`:
  - Add `evalRunBatches` to the import from `'./schema/eval'`
  - Add `evalRunBatches` to the `schema` object

  In `server/src/db/rows.ts`, append three new type aliases:
  ```ts
  export type EvalCaseRow = typeof t.evalCases.$inferSelect;
  export type EvalRunRow = typeof t.evalRuns.$inferSelect;       // now includes batchId
  export type EvalRunBatchRow = typeof t.evalRunBatches.$inferSelect;
  ```

  Generate the migration by running from the repo root:
  ```
  pnpm -C server db:generate
  ```
  Commit the generated `.sql` file. **Do NOT run `pnpm -C server db:migrate`** — that is a manual human step after T1 merges.

- **Acceptance**: `pnpm -C server exec tsc --noEmit` passes; `server/src/db/migrations/0014_*.sql` file is present and contains both `CREATE TABLE eval_run_batches` and `ALTER TABLE eval_runs ADD COLUMN batch_id`; `evalRunBatches` appears in `schema.ts`'s `schema` object; `EvalRunBatchRow` is importable from `server/src/db/rows.ts`.

- **Depends-on**: none

- **Red flags**:
  - `evalRunBatches` must be defined BEFORE `evalRuns` in `eval.ts` so the `() => evalRunBatches.id` arrow-function reference resolves at runtime without `AnyPgColumn` casting. Do NOT place it after `evalRuns`.
  - The `agents` table lives in `./agents.ts`; import it: `import { agents } from './agents';`. The `workspaces` table is already imported via `./core`.
  - `batchId` is nullable — never add `.notNull()`. Single-case sync runs have `batch_id = NULL` by design.
  - `precision` is a reserved keyword in some PostgreSQL contexts; Drizzle quotes column names, so `doublePrecision('precision')` is safe.
  - `pnpm db:generate` must be run from inside `server/` or using `-C server`. The root directory has no lockfile until T6 adds `package.json`, so do not run pnpm from root for this step.
  - Do NOT modify `conformanceChecks`, `composedReviews`, or any other existing table — they are unchanged.

---

### T2 — Shared Contracts · type: backend · covers: R1, R2, R3, R4, R5, R6, R7, R8, R9, R11

- **Owned paths**:
  - `server/src/vendor/shared/contracts/eval-scoring.ts` (new)
  - `server/src/vendor/shared/index.ts`
  - `client/src/vendor/shared/contracts/eval-scoring.ts` (new — byte-identical)
  - `client/src/vendor/shared/index.ts`

- **Skills (mandatory)**: `zod`

- **Task**: Create `contracts/eval-scoring.ts` in both vendor trees (byte-for-byte identical) and add it to both barrel exports.

  **Content of `contracts/eval-scoring.ts`** (identical in both trees):
  ```ts
  import { z } from 'zod';
  import { Provider } from './platform.js';

  /**
   * Eval Pipeline scoring contracts — SPEC-04.
   *
   * These extend the barrel; do NOT modify eval-ci.ts, knowledge.ts, or findings.ts.
   * EvalCase and EvalRun (legacy aggregate) live in knowledge.ts and are unchanged.
   * EvalRunRecord (persisted run row) lives in eval-ci.ts and is unchanged.
   */

  export const EvalExpectationType = z.enum(['must_find', 'must_not_flag']);
  export type EvalExpectationType = z.infer<typeof EvalExpectationType>;

  /** Structured expectation embedded in an eval case's expected_output. */
  export const EvalExpectation = z.object({
    type: EvalExpectationType,
    /** File path the finding must (or must not) appear in. */
    file: z.string().min(1),
    /** Inclusive start line (1-based). */
    start_line: z.number().int().min(1),
    /** Inclusive end line (≥ start_line). Enforced at route level; here for typing only. */
    end_line: z.number().int().min(1),
    /** Optional human note — not used in scoring. */
    note: z.string().nullish(),
    /** Finding that originated this case (null for manual cases). */
    source_finding_id: z.string().uuid().nullish(),
  });
  export type EvalExpectation = z.infer<typeof EvalExpectation>;

  export const EvalBatchStatus = z.enum(['running', 'done', 'failed']);
  export type EvalBatchStatus = z.infer<typeof EvalBatchStatus>;

  /** A batch execution record (one run of all cases for an agent). */
  export const EvalBatch = z.object({
    id: z.string().uuid(),
    agent_id: z.string().uuid().nullable(),
    workspace_id: z.string().uuid(),
    status: EvalBatchStatus,
    agent_version: z.number().int().nullable(),
    system_prompt: z.string(),
    provider: z.string(),
    model: z.string(),
    strategy: z.string(),
    skill_bodies: z.array(z.string()).nullable(),
    cases_total: z.number().int(),
    cases_passed: z.number().int().nullable(),
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
    cost_usd: z.number().nullable(),
    duration_ms: z.number().int().nullable(),
    error: z.string().nullable(),
    created_at: z.string(),
    finished_at: z.string().nullable(),
  });
  export type EvalBatch = z.infer<typeof EvalBatch>;

  /** Batch record plus all associated per-case run rows. Used for polling + compare. */
  export const EvalBatchDetail = z.object({
    batch: EvalBatch,
    runs: z.array(
      z.object({
        id: z.string().uuid(),
        case_id: z.string().uuid(),
        case_name: z.string().nullish(),
        batch_id: z.string().uuid().nullable(),
        ran_at: z.string(),
        pass: z.boolean().nullable(),
        actual_output: z.unknown(),
        recall: z.number().nullable(),
        precision: z.number().nullable(),
        citation_accuracy: z.number().nullable(),
        duration_ms: z.number().int().nullable(),
        cost_usd: z.number().nullable(),
      })
    ),
  });
  export type EvalBatchDetail = z.infer<typeof EvalBatchDetail>;

  /** Optional provider/model override for a batch run. */
  export const EvalStartBatchInput = z.object({
    provider: Provider.optional(),
    model: z.string().optional(),
  });
  export type EvalStartBatchInput = z.infer<typeof EvalStartBatchInput>;
  ```

  In **both** `server/src/vendor/shared/index.ts` AND `client/src/vendor/shared/index.ts`, append:
  ```ts
  export * from './contracts/eval-scoring.js';
  ```

- **Acceptance**: `pnpm -C server exec tsc --noEmit` passes; `pnpm -C client exec tsc --noEmit` passes; `EvalExpectation`, `EvalBatch`, `EvalBatchDetail`, `EvalStartBatchInput`, `EvalBatchStatus`, `EvalExpectationType` are all importable from `@devdigest/shared` in both packages.

- **Depends-on**: none

- **Red flags**:
  - Both `eval-scoring.ts` files must be **byte-for-byte identical**. Copy exactly — do not diverge.
  - Both barrel `index.ts` files require `.js` suffix in the export statement: `export * from './contracts/eval-scoring.js'`. This is mandatory for ESM resolution in the server tree; Next.js resolves it fine in the client tree. This follows the established pattern from `onboarding-tour.js` in the same barrels.
  - Do NOT modify `eval-ci.ts`, `knowledge.ts`, or any other existing contract file. The new types go exclusively in the new `eval-scoring.ts` file.
  - `Provider` is imported from `./platform.js` (it's already in the shared contracts barrel). Verify the import resolves before committing.
  - The `EvalExpectation.end_line ≥ start_line` constraint is NOT enforced by `z.refine()` here — it is enforced at the route/service level (AC-9). The contract defines the shape.

---

### T3 — Server eval module · type: backend · covers: R1, R2, R3, R4, R6, R9, R11

- **Owned paths**:
  - `server/src/modules/eval/routes.ts` (new)
  - `server/src/modules/eval/service.ts` (new)
  - `server/src/modules/eval/repository.ts` (new)
  - `server/src/modules/eval/eval.it.test.ts` (new)
  - `server/src/modules/index.ts`
  - `server/src/app.ts`

- **Skills (mandatory)**: `onion-architecture`, `fastify-best-practices`, `zod`, `security`

- **Task**: Implement the complete `eval` server module with five route groups, the EvalService (including fire-and-forget batch executor and boot reaper), and the EvalRepository.

  **`repository.ts`** — owns `eval_cases`, `eval_runs`, and `eval_run_batches` tables:
  - `getCases(workspaceId, agentId)` — `SELECT * FROM eval_cases WHERE workspace_id = ? AND owner_kind = 'agent' AND owner_id = ?`
  - `getCaseById(workspaceId, id)` — single case scoped to workspace
  - `insertCase(data)` — INSERT returning
  - `updateCase(workspaceId, id, patch)` — UPDATE returning
  - `deleteCase(workspaceId, id)` — DELETE, return boolean
  - `insertBatch(data)` — INSERT eval_run_batches returning
  - `updateBatch(id, patch)` — UPDATE eval_run_batches
  - `getBatch(workspaceId, id)` — SELECT with workspace scope
  - `getBatchWithRuns(workspaceId, id)` — SELECT batch + all eval_runs for it (for polling/detail)
  - `listBatches(workspaceId, agentId)` — SELECT batch history WHERE batch_id IS NOT NULL (excludes single-case runs), ORDER BY created_at DESC
  - `insertRun(data)` — INSERT eval_runs returning (used per-case during execution)
  - `reapStaleBatches()` — UPDATE eval_run_batches SET status='failed', error='orphaned by restart' WHERE status='running'; returns count

  **`service.ts`** — `EvalService(container)`:

  `createCaseFromFinding(workspaceId, findingId, agentIdOverride?)`:
  1. SELECT finding JOIN reviews (for `reviews.agentId`, `reviews.prId`, `reviews.workspaceId`)
  2. Verify `workspaceId` matches
  3. If neither `acceptedAt` nor `dismissedAt` → throw `ValidationError('Finding has no decision')`
  4. Resolve agentId: `reviews.agentId ?? agentIdOverride` — if still null → `ValidationError('Agent required for seeded reviews — supply agent_id in body')`
  5. Freeze diff: try `container.git.diff(pr.repoClonePath, pr.headSha)` → `parseUnifiedDiff(raw)` → serialize back to string. If empty or clone unavailable, reconstruct from `pr_files.patch` rows (join patches with newlines). If both empty → `ValidationError('Diff unavailable')`
  6. Build `expectedOutput: EvalExpectation` from finding fields
  7. `repo.insertCase(...)` → return EvalCase row

  `startBatch(workspaceId, agentId, opts?)`:
  1. Load cases via `repo.getCases(workspaceId, agentId)`
  2. If `cases.length === 0` → throw `ValidationError('No eval cases for this agent')`
  3. Load agent via `container.agentsRepo.getById(workspaceId, agentId)` (NotFoundError if absent)
  4. Load linked skill bodies: `container.agentsRepo.linkedSkills(agentId)` → skill.body strings for enabled skills only
  5. Resolve provider/model (opts override or agent defaults); attempt `container.llm(provider)` — ConfigError propagates as-is → HTTP 500
  6. `repo.insertBatch({ workspaceId, agentId, status:'running', systemPrompt, provider, model, strategy, skillBodies, agentVersion: agent.version, casesTotal: cases.length })`
  7. Fire-and-forget: `void this.executeBatch(batch, cases, llm, provider, model).catch(err => logger.error(...))`
  8. Return batch row (202)

  `executeBatch(batch, cases, llm, provider, model)` (private):
  - For each case in sequence:
    - Parse `case.expectedOutput` as `EvalExpectation`
    - Build `ReviewInput`: `systemPrompt` from batch snapshot, `model`, `llm`, `diff` from `parseUnifiedDiff(case.inputDiff)`, `skills` from `batch.skillBodies`, `prDescription` from `case.inputMeta.body` wrapped via `wrapUntrusted`, `task` from `case.inputMeta.title` wrapped via `wrapUntrusted` — all untrusted text goes through `wrapUntrusted`
    - `reviewPullRequest(input)` — catch per-case errors: record `pass=false, error=err.message`; continue
    - On success: `scoreEvalCase(expectation, { findings: outcome.review.findings, droppedCount: outcome.dropped.length })`
    - `repo.insertRun({ caseId, batchId: batch.id, pass, actualOutput, recall, precision, citationAccuracy, durationMs, costUsd })` where costUsd = `outcome.costUsd ?? container.priceBook.estimate(model, tokensIn, tokensOut)`
  - After all cases: `aggregateEvalMetrics(scores)` → UPDATE batch to `done` with metrics
  - Catch executor-level error: UPDATE batch to `failed` with error message

  `reapStaleBatches()` → delegates to `repo.reapStaleBatches()`

  **`routes.ts`** — thin Fastify plugin, `withTypeProvider<ZodTypeProvider>()` on all routes:

  ```
  POST /findings/:id/eval-case    body: { agent_id?: uuid } → 201 EvalCase | 422
  POST /eval-cases                body: EvalCaseInput → 201 EvalCase | 422
  GET  /eval-cases/:id            → 200 EvalCase | 404
  PUT  /eval-cases/:id            body: Partial<EvalCaseInput> → 200 EvalCase | 404 | 422
  DELETE /eval-cases/:id          → 204 | 404
  GET  /agents/:id/eval-cases     → 200 EvalCase[]
  POST /agents/:id/eval-runs      body: EvalStartBatchInput → 202 EvalBatch | 422
  GET  /agents/:id/eval-runs      → 200 EvalBatch[]
  GET  /eval-runs/:id             → 200 EvalBatchDetail | 404
  POST /eval-cases/:id/run        body: EvalStartBatchInput → 200 EvalRunResult | 422
  ```

  All routes call `getContext(app.container, req)` first for workspace scoping. Use `IdParams` from `modules/_shared/schemas.ts` for `:id` params. `start_line > end_line` in `EvalExpectation` bodies: validate in the route or service and throw `ValidationError`.

  **`server/src/modules/index.ts`**: add one import + one entry:
  ```ts
  import eval_ from './eval/routes.js';
  // in the modules object:
  eval: eval_,
  ```
  (Use `eval_` as the import name since `eval` is a reserved word in JS.)

  **`server/src/app.ts`**: add a reaper call immediately after the existing `reapStaleRuns()` block (lines 80-85):
  ```ts
  try {
    const { EvalService } = await import('./modules/eval/service.js');
    const reapedBatches = await new EvalService(container).reapStaleBatches();
    if (reapedBatches > 0) app.log.info({ reapedBatches }, 'reaped stale eval_run_batches on boot');
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'stale-batch reaping failed (non-fatal)');
  }
  ```
  Or add a static top-level import of `EvalService` if you prefer consistency with the `ReviewService` pattern.

  **`eval.it.test.ts`** — DB-backed integration tests covering AC-12 through AC-17, AC-23, AC-30. Follow the `run-executor.it.test.ts` template: Docker gate at top, `MockLLMProvider` via `ContainerOverrides.llm`, `MockGitClient` via `ContainerOverrides.git`. Key assertions per AC from the verification hints in the spec.

- **Acceptance**:
  - `pnpm -C server exec tsc --noEmit` passes
  - `pnpm -C server exec vitest run src/modules/eval/eval.it.test.ts` passes (or self-skips without Docker)
  - `curl -X POST .../findings/<accepted-id>/eval-case` returns 201 with `expected_output.type = 'must_find'`

- **Depends-on**: T1, T2

- **Red flags**:
  - `agent_id` is NOT a column on `findings` — it lives on `reviews`. The route for `POST /findings/:id/eval-case` must JOIN: `findings.review_id → reviews.id → reviews.agent_id`. Do not attempt to read `finding.agent_id`.
  - `INJECTION_GUARD` is **already** exported from `reviewer-core/src/prompt.ts` — no change to reviewer-core is needed. Import it via `import { INJECTION_GUARD, wrapUntrusted } from '@devdigest/reviewer-core'`.
  - The `parseUnifiedDiff` function is at `server/src/adapters/git/diff-parser.ts` (exported as `parseUnifiedDiff(raw: string): UnifiedDiff`). Use it to parse the frozen diff before passing to `reviewPullRequest`.
  - `pr_files.patch` is nullable — skip rows with null patch when reconstructing the fallback diff. If all rows have null patch AND the git clone is unavailable, return 422 (AC-5).
  - Fire-and-forget pattern: `void this.executeBatch(...).catch(err => logger.error(...))`. The HTTP 202 response returns before execution begins. Never `await` the executor from the route.
  - Response Zod schemas MUST be registered via `serializerCompiler` per repo INSIGHTS. Never skip response serialization on new routes.
  - `eval` is a reserved JavaScript keyword — use `eval_` as the import name in `modules/index.ts`.
  - For the boot reaper in `app.ts`: match the existing `try/catch/log` structure exactly. The call is `await` within the try block, non-fatal on catch (same as `reapStaleRuns`).
  - Provider/secret resolution failure (AC-15): catch `ConfigError` thrown by `container.llm(provider)` BEFORE creating the batch row or before starting any per-case execution, and UPDATE the batch to `failed` immediately.

---

### T4 — Scoring module · type: backend · covers: R5

- **Owned paths**:
  - `server/src/modules/eval/scoring.ts` (new)
  - `server/src/modules/eval/scoring.test.ts` (new)

- **Skills (mandatory)**: `onion-architecture`, `typescript-expert`

- **Task**: Implement pure-arithmetic scoring functions and their hermetic unit tests.

  **`scoring.ts`**:
  ```ts
  import type { Finding } from '@devdigest/shared';
  import type { EvalExpectation } from '@devdigest/shared';

  export interface CaseScore {
    pass: boolean;
    isMustFind: boolean;
    isMustNotFlag: boolean;
    matched: boolean; // at least one finding matched
    survivors: number;
    dropped: number;
  }

  /**
   * matchesExpectation — inclusive line-range intersection on the same file.
   * AC-18: true iff finding.file === exp.file
   *     AND finding.start_line <= exp.end_line
   *     AND exp.start_line <= finding.end_line
   */
  export function matchesExpectation(exp: EvalExpectation, finding: Finding): boolean {
    return (
      finding.file === exp.file &&
      finding.start_line <= exp.end_line &&
      exp.start_line <= finding.end_line
    );
  }

  /**
   * scoreEvalCase — score one case execution.
   * findings: the grounded findings from ReviewOutcome.review.findings
   * droppedCount: ReviewOutcome.dropped.length (for citation_accuracy numerator/denominator)
   */
  export function scoreEvalCase(
    exp: EvalExpectation,
    outcome: { findings: Finding[]; droppedCount: number },
  ): CaseScore {
    const anyMatch = outcome.findings.some((f) => matchesExpectation(exp, f));
    const isMustFind = exp.type === 'must_find';
    const isMustNotFlag = exp.type === 'must_not_flag';
    return {
      pass: isMustFind ? anyMatch : !anyMatch,
      isMustFind,
      isMustNotFlag,
      matched: anyMatch,
      survivors: outcome.findings.length,
      dropped: outcome.droppedCount,
    };
  }

  export interface AggregatedMetrics {
    recall: number;
    precision: number;
    citation_accuracy: number;
    cases_passed: number;
    cases_total: number;
  }

  /**
   * aggregateEvalMetrics — AC-19, AC-20, AC-21.
   * recall     = matched must_find / total must_find         (0/0 → 1.0)
   * precision  = TP / (TP + FP)                             (0/0 → 1.0)
   *   TP = matched must_find cases; FP = matched must_not_flag cases
   *   Extra findings outside labeled spans are NOT false positives.
   * citation   = sum(survivors) / sum(survivors + dropped)   (0/0 → 1.0)
   */
  export function aggregateEvalMetrics(scores: CaseScore[]): AggregatedMetrics {
    const mustFindTotal = scores.filter((s) => s.isMustFind).length;
    const mustFindMatched = scores.filter((s) => s.isMustFind && s.matched).length;
    const mustNotFlagMatched = scores.filter((s) => s.isMustNotFlag && s.matched).length;
    const tp = mustFindMatched;
    const fp = mustNotFlagMatched;
    const totalSurvivors = scores.reduce((acc, s) => acc + s.survivors, 0);
    const totalDropped = scores.reduce((acc, s) => acc + s.dropped, 0);

    const recall = mustFindTotal === 0 ? 1.0 : mustFindMatched / mustFindTotal;
    const precision = tp + fp === 0 ? 1.0 : tp / (tp + fp);
    const citation_accuracy =
      totalSurvivors + totalDropped === 0
        ? 1.0
        : totalSurvivors / (totalSurvivors + totalDropped);

    return {
      recall,
      precision,
      citation_accuracy,
      cases_passed: scores.filter((s) => s.pass).length,
      cases_total: scores.length,
    };
  }
  ```

  **`scoring.test.ts`** — hermetic unit tests (no Docker, no DB, no LLM mocks) covering all verification hints for AC-18 through AC-22:
  - AC-18: test `matchesExpectation` with overlapping ranges (true), non-overlapping (false), different file (false)
  - AC-19: two must_find cases, one matched → recall = 0.5
  - AC-20: one matched must_find (TP=1), one matched must_not_flag (FP=1) → precision = 0.5
  - AC-21: three cases with known survivors/dropped counts → assert arithmetic sum
  - AC-22: assert that `import('./scoring')` (static analysis) has no import from `../../platform/container` or any LLM adapter

- **Acceptance**:
  - `pnpm -C server exec tsc --noEmit` passes
  - `pnpm -C server exec vitest run src/modules/eval/scoring.test.ts` — all tests pass

- **Depends-on**: T2

- **Red flags**:
  - Extra findings outside labeled spans are **NOT** counted as false positives (AC-20). Only matched `must_not_flag` cases count as FP. Do not penalise extra findings.
  - 0/0 denominators must return 1.0 (not NaN, not 0) for all three metrics. Use explicit guard: `denominator === 0 ? 1.0 : numerator / denominator`.
  - `scoring.ts` must have **zero** imports from `container.ts`, `errors.ts`, or any LLM adapter. The AC-22 test verifies this; do not add any I/O import.
  - `Finding` type: import from `@devdigest/shared`. It has `file: string`, `start_line: number`, `end_line: number` fields (from `contracts/findings.ts`).

---

### T5 — Seed file · type: backend · covers: R10

- **Owned paths**:
  - `server/src/db/seed-eval-cases.ts` (new)
  - `server/src/db/seed-eval-cases.it.test.ts` (new)

- **Skills (mandatory)**: `drizzle-orm-patterns`

- **Task**: Create an idempotent seed function that inserts five eval cases for the General Reviewer agent against demo PR #482.

  **`seed-eval-cases.ts`** exports `seedEvalCases(db: Db): Promise<void>`. It:
  1. Looks up the default workspace (name = 'default') and the General Reviewer agent (name = 'General Reviewer') via SELECT
  2. For each of the five cases, calls `db.insert(t.evalCases).values({ ... }).onConflictDoNothing()` keyed on a unique index over `(workspace_id, owner_id, name)` — if the unique index does not exist, use a SELECT-first check before INSERT
  3. Uses realistic but minimal diffs in `inputDiff` — each must have a valid unified diff hunk header: `--- a/<file>\n+++ b/<file>\n@@ -N,M +N,M @@\n...`

  Five cases:
  | name | type | inputDiff theme |
  |---|---|---|
  | `stripe-key-leak` | `must_find` | `src/config.ts` adds a line with `sk_live_` literal |
  | `n-plus-one-users` | `must_find` | `src/api/users.ts` queries DB inside a loop |
  | `ratelimit-comparison-bug` | `must_find` | `src/middleware/rate-limit.ts` uses `=` instead of `<=` in comparison |
  | `readme-docs-noise` | `must_not_flag` | `README.md` adds a paragraph of documentation |
  | `safe-var-rename` | `must_not_flag` | `src/utils/helpers.ts` renames a local variable with no logic change |

  `expectedOutput` for each case must be a JSON-serializable object shaped as `EvalExpectation`: `{ type, file, start_line, end_line }`. The `start_line` and `end_line` must correspond to the `+` lines in the diff hunk (arithmetically correct).

  The function is safe to call multiple times (idempotent).

  **`seed-eval-cases.it.test.ts`** — DB-backed test (Docker gate + testcontainers, following `run-executor.it.test.ts` pattern): calls `seed(db)` to get workspaceId, calls `seedEvalCases(db)` twice, asserts exactly five `eval_cases` rows exist for the General Reviewer, asserts each has a non-empty `inputDiff`.

- **Acceptance**:
  - `pnpm -C server exec tsc --noEmit` passes
  - `pnpm -C server exec vitest run src/db/seed-eval-cases.it.test.ts` passes or self-skips without Docker
  - Running `seedEvalCases(db)` twice in the test yields exactly five rows (idempotency verified)

- **Depends-on**: T1, T2

- **Red flags**:
  - The unique idempotency key is `(workspace_id, owner_id, name)`. If `eval_cases` has no unique index on these columns, implement a SELECT-then-INSERT guard. The migration 0014 should add this index — coordinate with T1 or document that the seed falls back to SELECT-then-INSERT.
  - `inputDiff` must be non-empty and a valid unified diff (AC-29). Each hunk header `@@ -N,M +N,M @@` must be arithmetically correct: `M` is the count of context lines + changed lines on the respective side.
  - `expectedOutput.start_line` and `expectedOutput.end_line` must correspond to the actual `+` lines in the diff hunk — or the scoring test will always count as a miss. Double-check the arithmetic.
  - Seed file uses `Db` type from `../../db/client.js` — same import as `seed.ts`. Not a Fastify plugin.

---

### T6 — Root verify script · type: backend · covers: R12

- **Owned paths**:
  - `/Users/admin/dev-digest/package.json` (new)
  - `/Users/admin/dev-digest/scripts/verify-l06.sh` (new)

- **Skills (mandatory)**: none (structural script)

- **Task**: Create the minimal root `package.json` and the `verify-l06.sh` script, following the exact pattern of `scripts/verify-l03.sh`.

  **`package.json`** (repo root):
  ```json
  {
    "name": "dev-digest",
    "private": true,
    "scripts": {
      "verify:l06": "bash scripts/verify-l06.sh"
    }
  }
  ```

  **`scripts/verify-l06.sh`** — five steps following `verify-l03.sh`'s `set -euo pipefail` + `log/warn/fail/ok` helper pattern:

  ```
  Step 1/6 — server typecheck         pnpm -C server exec tsc --noEmit
  Step 2/6 — client typecheck         pnpm -C client exec tsc --noEmit
  Step 3/6 — reviewer-core build      (cd reviewer-core && npm run build)
  Step 4/6 — scoring unit tests       pnpm -C server exec vitest run src/modules/eval/scoring.test.ts
  Step 5/6 — server eval IT tests     pnpm -C server exec vitest run src/modules/eval/eval.it.test.ts src/db/seed-eval-cases.it.test.ts
  Step 6/6 — client eval tests        pnpm -C client exec vitest run (EvalsTab + CaseEditor + FindingCard paths)
  ```

  After all steps, print `✔ All L06 checks passed.`

  Also add a spec file existence check before step 1:
  ```bash
  test -f specs/SPEC-04-2026-07-eval-pipeline.md || fail "SPEC-04 file not found"
  ```

- **Acceptance**:
  - `bash /Users/admin/dev-digest/scripts/verify-l06.sh` exits 0 when all steps pass
  - `cat /Users/admin/dev-digest/package.json` shows the `verify:l06` script
  - Script has `chmod +x` or is run via `bash`

- **Depends-on**: none (can be written in Wave 1; actual execution requires Wave 2 and 3 to complete)

- **Red flags**:
  - Follow `verify-l03.sh` structure exactly: `set -euo pipefail`, `ROOT` detection via `$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)`, `cd "$ROOT"` before any steps.
  - Client vitest paths with `[id]` in the directory name need quoting/escaping: use single quotes around the path glob, e.g. `'src/app/agents/\[id\]/_components/AgentEditor/_components/EvalsTab'`.
  - The step 5 IT tests self-skip without Docker — this is expected and the script must not fail if they self-skip (they report `skipped`, not `failed`).
  - Do NOT add `pnpm install` or any lockfile-modifying command.

---

### T7 — Client hooks · type: ui · covers: R1, R2, R3, R4, R6

- **Owned paths**:
  - `client/src/lib/hooks/evals.ts` (new)
  - `client/src/lib/hooks/index.ts`

- **Skills (mandatory)**: `react-best-practices`, `frontend-architecture`, `typescript-expert`

- **Task**: Create `hooks/evals.ts` with all hooks for the eval pipeline and add a barrel export.

  **Hooks to implement**:

  ```ts
  // Cases
  useEvalCases(agentId: string)           // GET /agents/:id/eval-cases → EvalCase[]
  useEvalCase(caseId: string)             // GET /eval-cases/:id → EvalCase
  useCreateEvalCase()                     // POST /eval-cases → 201 EvalCase
  useUpdateEvalCase()                     // PUT /eval-cases/:id → 200 EvalCase
  useDeleteEvalCase()                     // DELETE /eval-cases/:id → 204

  // Create from finding (AC-1, AC-6)
  useCreateEvalCaseFromFinding()          // POST /findings/:id/eval-case
  // onSuccess: show toast with link to /agents/{evalCase.owner_id}?tab=evals

  // Batch runs
  useEvalBatches(agentId: string)         // GET /agents/:id/eval-runs → EvalBatch[]
  useEvalBatch(batchId: string)           // GET /eval-runs/:id → EvalBatchDetail
  // refetchInterval: (q) => q.state.data?.batch.status === 'running' ? 1500 : false  (AC-24)
  useStartEvalBatch(agentId: string)      // POST /agents/:id/eval-runs → 202 EvalBatch
  // onSuccess: invalidate useEvalBatches; triggers polling via useEvalBatch

  // Single-case sync run
  useRunEvalCase()                        // POST /eval-cases/:id/run → 200 EvalRunResult
  ```

  `useCreateEvalCaseFromFinding` `onSuccess` callback:
  ```ts
  onSuccess: (evalCase) => {
    const { toast } = useToast(); // ← hook called at component level, pass via closure or accept toast as arg
    toast({ title: t('evalsTab.caseCreated'), href: `/agents/${evalCase.owner_id}?tab=evals` });
  }
  ```
  Note: `useToast` is a hook — it cannot be called inside a callback. Design this hook to accept a `onSuccess` callback prop or use the module-level `notify.success` from `client/src/providers/toast.tsx` which is usable outside hooks. Check the toast provider's module-level API.

  Query key conventions (follow agents.ts pattern):
  ```ts
  const EVAL_CASES_KEY = (agentId: string) => ['eval-cases', agentId] as const;
  const EVAL_BATCH_KEY = (batchId: string) => ['eval-batch', batchId] as const;
  const EVAL_BATCHES_KEY = (agentId: string) => ['eval-batches', agentId] as const;
  ```

  **`client/src/lib/hooks/index.ts`**: append one line:
  ```ts
  export * from './evals';
  ```

- **Acceptance**:
  - `pnpm -C client exec tsc --noEmit` passes
  - All hooks importable from `@/lib/hooks`
  - `useEvalBatch` refetchInterval stops polling when `status` transitions to `done`/`failed` (verify via component test in T8)

- **Depends-on**: T2

- **Red flags**:
  - `useToast` is a React hook and cannot be called inside `onSuccess` callbacks. Use the module-level `notify` object from `client/src/providers/toast.tsx` for mutation callbacks (it's available outside React component context). Or accept a `toast` argument at hook call site.
  - `refetchInterval` for `useEvalBatch` must be a **function** `(query) => ...` not a fixed number, so polling stops when status is done/failed (following the `repo-intel.ts` pattern at line 36).
  - Do NOT add real HTTP calls in the hook file — all fetches go through `api.get`/`api.post` from `@/services/api`.
  - The 4xx silent policy: `useEvalCases` 404 should return `[]` (no cases yet); `useEvalBatch` 404 should be re-thrown (genuine not-found). Follow the error policy in client AGENTS.md.

---

### T8 — Client EvalsTab + AgentEditor wiring · type: ui · covers: R3, R6, R7, R8, R9

- **Owned paths**:
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/index.ts` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/styles.ts` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`
  - `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`
  - `client/src/app/agents/[id]/page.tsx`
  - `client/messages/en/eval.json`

- **Skills (mandatory)**: `react-best-practices`, `next-best-practices`, `frontend-architecture`, `react-testing-library`

- **Task**: Implement the Evals tab inside AgentEditor, wire it into the tab system, and extend `eval.json` with the missing i18n keys.

  **`constants.ts`**: add `{ key: "evals", labelKey: "editor.tabs.evals", icon: "BarChart2" }` to the `TABS` array.

  **`AgentEditor.tsx`**: add `EvalsTab` branch in the ternary chain (before the `tab === "context"` check):
  ```tsx
  {tab === "evals" ? (
    <EvalsTab key={agent.id} agent={agent} />
  ) : tab === "skills" ? (
  // ...
  ```
  Add import: `import { EvalsTab } from "./_components/EvalsTab"`.

  **`page.tsx`**: add `"evals"` to `VALID_TABS`:
  ```ts
  const VALID_TABS = ["config", "skills", "context", "evals"];
  ```

  **`EvalsTab.tsx`** — feature component `({ agent }: { agent: Agent })`:

  Sections rendered (top to bottom):
  1. **MetricCards row** — three `MetricCard` instances (recall, precision, citation_accuracy) from the latest done batch; show `—` placeholder when no done batch exists
  2. **TrendChart** — `LineChart` with three series; render only when ≥ 1 done batch (AC-25); each series is `{ name, color, data: batchHistory.map(b => b.recall|precision|citation_accuracy) }`
  3. **Run controls** — "Run eval" button → `useStartEvalBatch(agent.id).mutate()`; shows loading state while batch is running; also triggers `useEvalBatch` polling
  4. **CasesList** — cases from `useEvalCases(agent.id)` each showing name + pass/fail/"never run" + recall from last batch that includes the case; empty state when no cases (AC-11)
  5. **RunHistory table** — batch records from `useEvalBatches(agent.id)`; columns: ran_at, model, recall, precision, citation, cost; checkboxes for selecting two rows for compare; "Compare" button appears when exactly two done batches selected (AC-26)
  6. **CompareView** — rendered inline when two batches selected; fetches `useEvalBatch(idA)` and `useEvalBatch(idB)`; computes deltas purely on client (AC-27); shows three `MetricCard` instances with `delta` prop (signed B − A) and a per-case flip table listing cases whose pass/fail status differs between runs

  Polling: start `useEvalBatch(runningBatchId)` when a batch is in `running` status; update the UI when status transitions to `done`.

  **`eval.json`** — add missing keys (merge with existing content, do not overwrite):
  ```json
  {
    "evalsTab": {
      "history": {
        "title": "Run history",
        "model": "Model",
        "ranAt": "Ran at",
        "recall": "Recall",
        "precision": "Precision",
        "citation": "Citation",
        "cost": "Cost",
        "status": "Status",
        "compare": "Compare",
        "selectTwo": "Select two completed runs to compare"
      }
    },
    "compare": {
      "title": "Compare runs",
      "recall": "Recall",
      "precision": "Precision",
      "citation": "Citation accuracy",
      "flipTable": "Case flips",
      "caseFlippedPass": "→ pass",
      "caseFlippedFail": "→ fail",
      "close": "Close"
    },
    "caseEditor": {
      "expectation": {
        "type": "Expectation type",
        "file": "File",
        "startLine": "Start line",
        "endLine": "End line",
        "note": "Note (optional)",
        "mustFind": "must find",
        "mustNotFlag": "must not flag"
      }
    }
  }
  ```
  **Merge** these keys into the existing `eval.json` (which already has `dashboard`, `caseEditor`, `evalsTab`, `page` sections) — do not delete existing keys.

  **`EvalsTab.test.tsx`** — component tests covering AC-10, AC-11, AC-24, AC-25, AC-26, AC-27, AC-28.

- **Acceptance**:
  - `pnpm -C client exec tsc --noEmit` passes
  - `pnpm -C client exec vitest run 'src/app/agents/\[id\]/_components/AgentEditor/_components/EvalsTab'` — all tests pass
  - Navigating to `?tab=evals` renders EvalsTab without error boundary

- **Depends-on**: T2, T7

- **Red flags**:
  - `eval.json` already contains many keys — **merge** the new keys into the existing JSON, do not overwrite the file. The existing `evalsTab`, `caseEditor`, `dashboard`, `page` sections must be preserved.
  - `BarChart2` icon: verify it exists in `client/src/vendor/ui/icons.tsx` before using it. If absent, use `TrendingUp` or `Activity` — pick one that's confirmed present in the icon registry.
  - CompareView's per-case flip table: derive by comparing `runs` arrays of the two `EvalBatchDetail` responses by `case_id`; a case is a flip if `pass` differs between the two runs.
  - `MetricCard` with `delta` prop: positive delta renders with an up-arrow in green (from MetricCard implementation); negative delta renders red. `delta = runB.recall - runA.recall`.
  - `LineChart` from `@devdigest/ui`: `yMin=0, yMax=1` for metric series (not the default 0.6–1.0 since a regression could go below 0.6).
  - Accessible metric values: label each `MetricCard` with an aria-label containing both the metric name and value for screen readers.

---

### T9 — Client Case Editor · type: ui · covers: R2

- **Owned paths**:
  - `client/src/app/agents/[id]/eval-cases/new/page.tsx` (new)
  - `client/src/app/agents/[id]/eval-cases/[caseId]/page.tsx` (new)
  - `client/src/app/agents/[id]/eval-cases/_components/CaseEditor/CaseEditor.tsx` (new)
  - `client/src/app/agents/[id]/eval-cases/_components/CaseEditor/CaseEditor.test.tsx` (new)
  - `client/src/app/agents/[id]/eval-cases/_components/CaseEditor/index.ts` (new)

- **Skills (mandatory)**: `react-best-practices`, `next-best-practices`, `frontend-architecture`, `react-testing-library`

- **Task**: Implement the standalone Case Editor pages and `CaseEditor` component for manual case creation and editing.

  **Route structure**: two page routes under `agents/[id]/eval-cases/`:
  - `new/page.tsx` — renders `<CaseEditor agentId={id} />` (no `caseId`)
  - `[caseId]/page.tsx` — fetches `useEvalCase(caseId)` and renders `<CaseEditor agentId={id} caseId={caseId} initialValues={evalCase} />`

  **`CaseEditor.tsx`** props:
  ```ts
  interface CaseEditorProps {
    agentId: string;
    caseId?: string;
    initialValues?: EvalCase;
  }
  ```

  Fields (AC-7):
  - **Name**: `<TextInput>` from vendored UI; required
  - **Input section**: two-tab UI (use `Tabs` from vendored UI):
    - "Diff" tab: `<Textarea>` for diff paste; below it, a simple line-by-line preview rendering `+` lines in green and `-` lines in red using inline styles (no external markdown parser needed)
    - "PR meta" tab: `<TextInput>` for title, `<Textarea>` for body
  - **Expectation section** (use i18n keys from `eval.json` `caseEditor.expectation.*` added by T8):
    - Type selector: `<SelectInput>` with options `must_find` / `must_not_flag` (labelled from eval.json)
    - `<TextInput>` for file path
    - `<TextInput type="number">` for start_line
    - `<TextInput type="number">` for end_line
    - `<TextInput>` for note (optional)
  - **Client validation** (AC-8): `if (start_line > end_line) { setError('...'); return; }` — abort submit, show error, make no fetch call
  - **"Run case" button**: only shown when `caseId` is defined (can only run a saved case); calls `useRunEvalCase().mutate({ caseId })` synchronously; shows result summary on response: `recall {recall}% · precision {precision}% · citation {citation}% · {duration}s`
  - **"Save" button**: calls `useCreateEvalCase().mutate(...)` for new, `useUpdateEvalCase().mutate(...)` for edit; on success navigate to `/agents/${agentId}?tab=evals`

  **`CaseEditor.test.tsx`** — component tests for AC-7, AC-8 per the spec's verification hints: render in new-case mode; assert all fields present; simulate Run Case click with mocked API; assert start_line > end_line shows error without fetch.

- **Acceptance**:
  - `pnpm -C client exec tsc --noEmit` passes
  - `pnpm -C client exec vitest run 'src/app/agents/\[id\]/eval-cases/_components/CaseEditor'` — all tests pass
  - Navigating to `/agents/:id/eval-cases/new` renders the form without error boundary

- **Depends-on**: T2, T7

- **Red flags**:
  - These are **standalone route pages**, not tabs within AgentEditor. There is NO `VALID_TABS` check — the pages are at their own Next.js routes under `eval-cases/`.
  - The i18n keys `caseEditor.expectation.*` are added to `eval.json` by T8. T9 uses `useTranslations("eval")` and accesses `t("caseEditor.expectation.type")` etc. Since T9 and T8 run in parallel, T9's code can reference those keys; they will be present when T8's eval.json changes are merged.
  - "Run case" is synchronous: `POST /eval-cases/:id/run` blocks until the LLM call completes. The button shows a loading state; the result summary appears inline (not in a separate route).
  - The diff paste preview: a minimal implementation renders each line with inline style based on its first character (`+` → `{ color: 'var(--ok)' }`, `-` → `{ color: 'var(--crit)' }`). No syntax highlighting library needed.
  - Do not import from `AgentEditor/constants.ts` or `AgentEditor/_components/` — the Case Editor is a sibling feature under `agents/[id]/`, not a tab of AgentEditor.

---

### T10 — Client FindingCard button · type: ui · covers: R1

- **Owned paths**:
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx`
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
  - `client/messages/en/prReview.json`

- **Skills (mandatory)**: `react-best-practices`, `frontend-architecture`, `react-testing-library`

- **Task**: Add a "Create eval case" button to `FindingCard` and wire the mutation in `FindingsPanel`.

  **`FindingCard.tsx`**: add a new optional prop:
  ```ts
  onCreateEvalCase?: () => void;
  ```
  Inside the expanded body's `<div style={s.actions}>`, add a button after the existing dismiss button:
  ```tsx
  {(accepted || dismissed) && onCreateEvalCase && (
    <Button
      kind="ghost"
      size="sm"
      icon="PlusCircle"
      onClick={onCreateEvalCase}
      aria-label={t("finding.createEvalCase")}
    >
      {t("finding.createEvalCase")}
    </Button>
  )}
  ```
  The button is only rendered when the finding has a decision (`accepted || dismissed`) and the `onCreateEvalCase` prop is provided. It is keyboard-operable (native `<button>` via vendored `Button`) with an accessible label (AC-30 NFR a11y clause).

  Verify `PlusCircle` exists in the icon registry (`client/src/vendor/ui/icons.tsx`). If absent, use `Plus` or `BookPlus` — pick one that is confirmed present.

  **`FindingsPanel.tsx`**: add a new optional prop `agentId?: string | null` and wire `onCreateEvalCase`:
  ```tsx
  const createFromFinding = useCreateEvalCaseFromFinding();
  // Inside the FindingCard render:
  onCreateEvalCase={() =>
    createFromFinding.mutate({ findingId: f.id, agentId: agentId ?? undefined })
  }
  ```
  The `useCreateEvalCaseFromFinding` hook (from T7) shows the toast with the link to `/agents/{evalCase.owner_id}?tab=evals` in its `onSuccess` callback.

  **`prReview.json`**: add `"createEvalCase": "Create eval case"` to the existing `"finding"` object.

  **`FindingCard.test.tsx`**: add a test asserting that a finding with `accepted_at` set renders the "Create eval case" button and that clicking it invokes `onCreateEvalCase` (AC-6 component-level verification hint).

- **Acceptance**:
  - `pnpm -C client exec tsc --noEmit` passes
  - `pnpm -C client exec vitest run 'src/app/repos/\[repoId\]/pulls/\[number\]/_components/FindingCard'` — all tests pass
  - "Create eval case" button visible in expanded FindingCard when finding is accepted or dismissed; absent for undecided findings

- **Depends-on**: T2, T7

- **Red flags**:
  - FindingCard already checks `accepted = !!f.accepted_at` and `dismissed = !!f.dismissed_at` — reuse these local variables for the conditional render.
  - The button must be inside the expanded body (`{expanded && (...)}`), not in the header — consistent with the existing accept/dismiss button placement.
  - Do NOT re-implement the toast in FindingCard — the toast lives in the `useCreateEvalCaseFromFinding` hook's `onSuccess` (T7). FindingCard just calls `onCreateEvalCase()`.
  - `FindingsPanel` calls `FindingCard` for each finding via `.map()`. The `onCreateEvalCase` prop is wired on every FindingCard; the mutation is deduplicated by TanStack Query.
  - The `agentId` prop added to FindingsPanel: the parent component (PR detail page) must pass this. Look at the PR detail page to confirm it receives the agentId from the review row (it does — `review.agent_id` is available on the review DTO).

---

## Test intents

What must be tested — statements, not tasks. Test-writer is disabled; these land in each implementer's acceptance and the run's manual checklist. One line per requirement:

- **R1** → server-it (`eval.it.test.ts`): seed findings with accepted_at and dismissed_at; call `POST /findings/:id/eval-case`; assert 201 + `expected_output.type` (AC-1, AC-2); assert 422 for undecided (AC-3), null-agent-without-body (AC-4), unavailable-diff (AC-5). Client component test (`FindingCard.test.tsx`): mock mutation; simulate button click on accepted finding; assert toast with `/agents/{agentId}?tab=evals` link (AC-6).
- **R2** → client component test (`CaseEditor.test.tsx`): render in new-case mode; assert name, diff tab, PR meta tab, expectation fields, Run Case button present (AC-7); fill start_line=10, end_line=5, submit; assert no fetch call and validation error visible (AC-8). Server-it: call `POST /eval-cases` with start_line > end_line; assert 422 (AC-9).
- **R3** → client component test (`EvalsTab.test.tsx`): mock `GET /agents/:id/eval-cases` with two fixtures; assert both names appear with pass/fail status (AC-10); mock returning `[]`; assert empty-state element visible (AC-11).
- **R4** → server-it (`eval.it.test.ts`): call `POST /agents/:id/eval-runs`; assert 202 + `status='running'` + snapshotted `system_prompt` (AC-12); zero-case agent → 422 (AC-13); one-case batch where engine throws → case row `pass=false` + error, batch ends `done` (AC-14); unknown provider → batch `failed`, zero eval_run rows (AC-15); insert `running` batch row, invoke reaper, assert `failed` + `error='orphaned by restart'` (AC-16); complete batch → assert non-null recall/precision/citation_accuracy/cost_usd (AC-17).
- **R5** → hermetic unit (`scoring.test.ts`): matchesExpectation intersection rule (AC-18); two must_find 1-matched → recall=0.5 (AC-19); 1 TP + 1 FP → precision=0.5 (AC-20); citation arithmetic (AC-21); assert scoring module import graph has no LLM adapter (AC-22).
- **R6** → server-it: seed one batch run and one single-case run (batch_id=NULL); `GET /agents/:id/eval-runs` returns only the batch run (AC-23). Client component test (`EvalsTab.test.tsx`): mock poll returning `running` then `done`; assert polling stopped (AC-24).
- **R7** → client component test (`EvalsTab.test.tsx` or `TrendChart.test.tsx`): supply two done batch fixtures; assert LineChart element with three series rendered (AC-25).
- **R8** → client component test (`CompareView.test.tsx` or `EvalsTab.test.tsx`): supply two EvalBatchDetail fixtures where one case flipped; assert metric deltas and flip row rendered (AC-26); assert no additional fetch calls beyond two detail fetches (AC-27).
- **R9** → client component test: batch with `cost_usd=0.042` → assert "$0.042" visible; batch with `cost_usd=null` → assert "—" visible (AC-28).
- **R10** → server-it (`seed-eval-cases.it.test.ts`): call `seedEvalCases(db)` twice; assert exactly five `eval_cases` rows; assert each has non-empty `inputDiff` (AC-29).
- **R11** → server-it (`eval.it.test.ts`): supply input_diff containing a mock injection attempt; assert the assembled prompt wraps it in `<untrusted source="...">` delimiters and system message contains INJECTION_GUARD sentinel (AC-30).

---

## Sequencing & risks

**Topological order — three waves:**

```
Wave 1 (parallel):  T1, T2, T6
Wave 2 (parallel):  T3 (needs T1+T2), T4 (needs T2), T5 (needs T1+T2), T7 (needs T2)
Wave 3 (parallel):  T8 (needs T2+T7), T9 (needs T2+T7), T10 (needs T2+T7)
```

**Critical path**: T2 → T7 → T8/T9/T10. Server path: T1+T2 → T3. Both converge before integration testing.

**Commit cadence (one commit per wave):**
- Wave 1 commit: DB schema + migration 0014 + shared contracts + root verify script
- Wave 2 commit: server eval module + scoring + seed + client hooks
- Wave 3 commit: EvalsTab + Case Editor + FindingCard button + i18n

**Human confirmation required:**
1. After Wave 1 commits: run `pnpm -C server db:migrate` manually against the running Postgres instance BEFORE starting any Wave 2 integration tests. Never automated on boot.
2. Verify no icon name collision: confirm `BarChart2` (EvalsTab) and `PlusCircle` (FindingCard) exist in `client/src/vendor/ui/icons.tsx` before T8 and T10 land. If absent, substitute confirmed-present alternatives.

**Risks and mitigations:**

| Risk | Impact | Mitigation |
|---|---|---|
| `eval` reserved word in JS | `import eval from './eval/routes.js'` fails at parse time | Use `import eval_ from './eval/routes.js'` and `eval: eval_` in the registry object |
| `evalRunBatches` defined after `evalRuns` in eval.ts | TypeScript can't resolve the `() => evalRunBatches.id` forward reference at module level | Define `evalRunBatches` BEFORE `evalRuns` in eval.ts — reorder table definitions accordingly |
| Migration timestamp collision | Two tasks writing migrations at the same time | T1 is the only schema task in this plan — no intra-plan collision; cross-feature collisions at merge resolved by regenerating |
| eval.json merge conflict | T8 adds keys to an existing JSON file | T8 must read the existing file first and merge keys; do not overwrite |
| `agent_id` not directly on findings | `POST /findings/:id/eval-case` reads wrong column | The service must JOIN findings → reviews to get `reviews.agent_id`; never access `finding.agent_id` |
| Provider secret missing before batch start | Batch created then immediately fails | AC-15: detect ConfigError from `container.llm(provider)` BEFORE inserting the batch row; return 422 instead |
| Engine error mid-batch | Batch hangs forever | Per-case try/catch records `pass=false` + error; batch always transitions to `done` (AC-14) |
| Orphaned `running` batches after restart | UI shows perpetual "running" state | Boot reaper (T3/app.ts) marks them `failed` with `error='orphaned by restart'` (AC-16) |
| EvalsTab and CaseEditor both need eval.json keys | T8 writes eval.json; T9 references those keys | T9 code references keys added by T8; both run in Wave 3 in parallel; T9 implementer documents the dependency on T8's eval.json keys — both must merge before integration testing |

---

## Verification per task

- **T1**: `pnpm -C server exec tsc --noEmit` — zero errors; `ls server/src/db/migrations/ | grep 0014` confirms migration file present; `grep evalRunBatches server/src/db/schema.ts` confirms entry in schema object; `grep EvalRunBatchRow server/src/db/rows.ts` confirms row type.

- **T2**: `pnpm -C server exec tsc --noEmit` — zero errors; `pnpm -C client exec tsc --noEmit` — zero errors; both `eval-scoring.ts` files exist and are byte-identical (`diff server/src/vendor/shared/contracts/eval-scoring.ts client/src/vendor/shared/contracts/eval-scoring.ts` returns empty).

- **T3**: `pnpm -C server exec tsc --noEmit` — zero errors; `pnpm -C server exec vitest run src/modules/eval/eval.it.test.ts` — passes or self-skips without Docker.

- **T4**: `pnpm -C server exec tsc --noEmit` — zero errors; `pnpm -C server exec vitest run src/modules/eval/scoring.test.ts` — all tests pass.

- **T5**: `pnpm -C server exec tsc --noEmit` — zero errors; `pnpm -C server exec vitest run src/db/seed-eval-cases.it.test.ts` — passes or self-skips without Docker.

- **T6**: `bash /Users/admin/dev-digest/scripts/verify-l06.sh` — exits 0 (or fails at steps that require Wave 2/3 output); `cat /Users/admin/dev-digest/package.json` shows `verify:l06` script.

- **T7**: `pnpm -C client exec tsc --noEmit` — zero errors; `useEvalCases`, `useEvalBatches`, `useEvalBatch`, `useStartEvalBatch`, `useCreateEvalCaseFromFinding`, `useRunEvalCase` all importable from `@/lib/hooks`.

- **T8**: `pnpm -C client exec tsc --noEmit` — zero errors; `pnpm -C client exec vitest run 'src/app/agents/\[id\]/_components/AgentEditor/_components/EvalsTab'` — all tests pass; navigating to `?tab=evals` does not hit error boundary.

- **T9**: `pnpm -C client exec tsc --noEmit` — zero errors; `pnpm -C client exec vitest run 'src/app/agents/\[id\]/eval-cases/_components/CaseEditor'` — all tests pass.

- **T10**: `pnpm -C client exec tsc --noEmit` — zero errors; `pnpm -C client exec vitest run 'src/app/repos/\[repoId\]/pulls/\[number\]/_components/FindingCard'` — all tests pass.
