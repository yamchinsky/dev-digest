# Development Plan: intent-layer

## Overview
Add an "intent cascade" (course lesson L03): a separate, cheap LLM call derives a
PR's intent/motivation and scope from cheap signals (title, body, linked-issue
body, changed-file list with hunk headers — **no diff bodies**), persists it
one-to-one per PR, surfaces it as an Intent card on the PR detail page with a
manual recompute button, and injects the stored intent + a scope-discipline rule
into every review agent's prompt. The intent call runs as a visible, separately
budgeted step inside the review run so the logs show the cheap intent call and
the main review call side by side.

## Requirements
| ID | Requirement | Acceptance criteria (measurable) |
|---|---|---|
| R1 | Cheap, separate intent classifier call | A `POST /pulls/:id/intent` derives an `Intent` via a SECOND `completeStructured` call distinct from the review call, using the model resolved by `resolveFeatureModel(container, workspaceId, 'review_intent')`. The default resolves to `openrouter` / `deepseek/deepseek-v4-flash`. A server unit test asserts the resolved model is the cheap default when no override is set. |
| R2 | Intent input excludes diff bodies | The user message sent to the intent LLM contains the PR title, body, linked-issue title+body (when present), and a changed-file list with reconstructed `@@ … @@` hunk headers ONLY. It contains NO added/removed/context line content. A unit test feeds a `UnifiedDiff` with line bodies and asserts the produced input string contains the `@@` headers and file paths but none of the changed-line text. |
| R3 | Token-budget logging for the intent call | The intent step emits a run-log line (and the intent endpoint returns) `tokensIn` / `tokensOut` for the intent call, plus a line noting that diff bodies were omitted (the token-saving claim). When run inside a review, the intent step is a distinct logged step in the run trace, separate from the review call's stats. |
| R4 | Per-PR persistence (one-to-one) | A derived intent is stored in `pr_intent` (PK `prId`) via `upsertIntent`; re-deriving the same PR updates the row in place (no duplicates). `GET /pulls/:id/intent` returns the stored `Intent` or a 404/empty signal when none exists. |
| R5 | Manual recompute | `POST /pulls/:id/intent` re-derives and overwrites the stored intent for that PR. A second call after the PR changes returns the freshly derived intent and the persisted row reflects it. |
| R6 | Injection into the review prompt | The stored intent (when present) is threaded `run-executor → reviewPullRequest(ReviewInput) → assemblePrompt(PromptParts)` and rendered as a fenced `wrapUntrusted('derived-intent', …)` block plus a scope-discipline rule: "Do not comment outside the stated intent/scope; if you spot a serious problem out of scope, emit ONE signal finding, not twenty." The `PromptAssembly.intent` trace field is populated. A reviewer-core unit test asserts the block + rule appear when intent is supplied and the section is omitted (no behavior change) when it is absent. |
| R7 | Intent derivation visible inside the review run | When a review runs, the executor best-effort derives (or loads) the intent in the shared pre-work phase and logs it as its own trace step. On intent-derivation failure the run **warns and continues** (does not fail the agent runs). The run log shows the cheap intent call and the main review call as two steps with two models/budgets. |
| R8 | Intent card on the PR page | `OverviewTab` renders an Intent card showing `intent`, `in_scope`, `out_of_scope`, the model that produced it, and a recompute button. When no intent exists yet it shows an empty state with a "derive" affordance. An RTL test covers: empty state, populated state, and clicking recompute fires the mutation. |
| R9 | Settings default = cheap model | The `review_intent` registry default is `openrouter` / `deepseek/deepseek-v4-flash` in BOTH the shared source of truth (`server/src/vendor/shared/contracts/platform.ts`) and the client mirror (`client/src/constants/feature-models.ts`). Settings → Models renders `review_intent` defaulting to the cheap model and persists a user override into `settings.feature_models`. |
| R10 | Contracts stay in sync | Any new field added to a shared contract (`PromptAssembly.intent` in `trace.ts`) is mirrored identically in `client/src/vendor/shared/contracts/trace.ts`. A typecheck of both packages passes. |

## Affected packages / modules
- **shared contracts** (dual-vendored): `server/src/vendor/shared/contracts/{platform,trace}.ts` + mirrors `client/src/vendor/shared/contracts/trace.ts`. `Intent` already exists in `brief.ts` (no change needed).
- **server `reviews` module**: `service.ts`, `routes.ts`, `run-executor.ts`, a new `intent.ts` helper, repository delegation already present (`upsertIntent`/`getIntent`).
- **reviewer-core**: `prompt.ts` (new `intent` slot + rendering), `review/run.ts` (`ReviewInput.intent`), public surface `index.ts` (new pure diff→hunk-header formatter).
- **client**: new `IntentCard/` colocated component under the PR detail page, a new TanStack Query hook (GET + recompute mutation), i18n strings, and the feature-models mirror constant.
- **No DB migration**: the `pr_intent` table and `settings.feature_models` JSONB already exist.

## Tasks (parallel units)
Each task = one `implementer` instance, running in the same shared working tree.
Owned paths across tasks are disjoint — no file appears in two tasks. Dependencies
form a DAG.

### T1 — Shared contract `intent` slot + registry defaults · type: backend · covers: R9, R10
- **Owned paths**:
  - `server/src/vendor/shared/contracts/platform.ts`
  - `server/src/vendor/shared/contracts/trace.ts`
  - `client/src/vendor/shared/contracts/trace.ts`
  - `client/src/constants/feature-models.ts`
- **Skills (mandatory)**: `zod`, `onion-architecture` (shared-contract placement), `typescript-expert`.
- **Task**:
  1. In `platform.ts` change the `review_intent` `FEATURE_MODELS` entry: `defaultProvider: 'openrouter'`, `defaultModel: 'deepseek/deepseek-v4-flash'` (lines ~52-58). Leave the `FeatureModelId` enum unchanged (`review_intent` already present).
  2. In `client/src/constants/feature-models.ts` mirror the exact same `review_intent` default (lines ~22-27) so the client registry matches the server source of truth.
  3. Add an optional `intent` field to `PromptAssembly` in `server/src/vendor/shared/contracts/trace.ts`: `intent: z.string().nullish()` (mirror the existing `callers` / `repo_map` / `pr_description` style + comment). Then mirror the **identical** change in `client/src/vendor/shared/contracts/trace.ts`.
  4. Do NOT touch `Intent` in `brief.ts` — it already has `{ intent, in_scope, out_of_scope }`.
- **Acceptance**: R9 (both registries show the cheap default for `review_intent`); R10 (both `trace.ts` files declare `intent?` on `PromptAssembly`; `pnpm -C server exec tsc --noEmit` and `pnpm -C client exec tsc --noEmit` pass).
- **Depends-on**: none.
- **Red flags**: The two `trace.ts` files MUST end up byte-for-byte equivalent for the `PromptAssembly` shape — webpack can't import shared runtime values, so the mirror is load-bearing. Keep `intent` `nullish` so existing persisted traces (no `intent`) still parse.

### T2 — reviewer-core: prompt `intent` slot + pure hunk-header formatter · type: backend · covers: R6, R2 (formatter half)
- **Owned paths**:
  - `reviewer-core/src/prompt.ts`
  - `reviewer-core/src/review/run.ts`
  - `reviewer-core/src/index.ts`
  - `reviewer-core/src/intent-input.ts` (new — pure formatter)
- **Skills (mandatory)**: `onion-architecture` (reviewer-core purity), `typescript-expert`, `zod`.
- **Task**:
  1. Add `intent?: string` to `PromptParts` in `prompt.ts`. In `assemblePrompt`, when present and non-empty, push a section `## Derived intent / scope\n${wrapUntrusted('derived-intent', intent)}` rendered BEFORE `## Diff to review` (after `## PR description`). Append the scope-discipline rule line to the same section (or to the section header text): "Stay within the stated intent/scope; if you spot a serious out-of-scope problem, emit ONE signal finding, not many." Set `assembly.intent = parts.intent ?? null` on the returned `PromptAssembly`. Empty/undefined → section omitted, `assembly.intent = null` (no behavior change — mirror the `callers` slot exactly).
  2. Add `intent?: string` to `ReviewInput` in `review/run.ts` and pass it through into the `promptParts` object that feeds `assemblePrompt` (both the whole-diff assembly default and the per-chunk assemble call).
  3. New pure module `reviewer-core/src/intent-input.ts`: export `formatChangedFilesWithHunkHeaders(diff: UnifiedDiff): string`. For each file emit the path then one `@@ -oldStart,oldLines +newStart,newLines @@` line per hunk — reconstructed from `DiffHunk` fields. It MUST NOT include `diff.raw`, line bodies, or `newLineNumbers` content. Re-export it (and its return contract) from `reviewer-core/src/index.ts`.
  4. The INJECTION_GUARD already names "derived intent/scope" (`prompt.ts:18`) — no change needed there.
- **Acceptance**: R6 (unit test in reviewer-core: intent supplied → block + scope rule present in the user message and `assembly.intent` set; intent absent → section omitted and `assembly.intent === null`); R2-formatter (unit test: a `UnifiedDiff` carrying hunk bodies yields a string with `@@` headers + paths and none of the changed-line text).
- **Depends-on**: T1 (needs `PromptAssembly.intent` in shared contracts).
- **Red flags**: reviewer-core stays PURE — no `process.env`, no I/O, no Drizzle/Octokit/fs; npm not pnpm; build is `tsc --noEmit`. The new symbol is invisible unless re-exported from `src/index.ts`. Do NOT route the intent LLM call through `reviewPullRequest` — that call stays the single review call; the intent call is a separate cheap call owned by the server (T3).

### T3 — server intent service + endpoints · type: backend · covers: R1, R2 (call half), R3, R4, R5
- **Owned paths**:
  - `server/src/modules/reviews/intent.ts` (new — intent derivation logic)
  - `server/src/modules/reviews/service.ts`
  - `server/src/modules/reviews/routes.ts`
- **Skills (mandatory)**: `onion-architecture`, `fastify-best-practices`, `zod`, `drizzle-orm-patterns` (read-only — persistence is via the existing repo delegate), `security`.
- **Task**:
  1. New `server/src/modules/reviews/intent.ts`: a pure-ish helper `deriveIntent(container, workspaceId, pull, repo, diff, opts)` that
     (a) resolves provider+model via `resolveFeatureModel(container, workspaceId, 'review_intent')` (import from `../settings/feature-models.js`) — NOT a hardcoded model (unlike conventions' `service.ts:119` TODO);
     (b) loads the linked issue live the same way the PR detail does (reuse `container.github()` resolve, or accept a `linkedIssue` arg the caller already has — prefer passing it in to avoid an extra network call beyond import);
     (c) builds the user message with `formatChangedFilesWithHunkHeaders(diff)` (from `@devdigest/reviewer-core`, T2) + title + body + linked-issue title/body — and NOTHING from the diff bodies;
     (d) calls `llm.completeStructured({ model, schema: Intent, schemaName: 'Intent', messages, maxRetries: 1 })` and returns `{ intent, provider, model, tokensIn, tokensOut }`. Wrap LLM/provider errors in `ExternalServiceError`; `ConfigError` passes through (mirror conventions' pattern). Define the system prompt inline (a short "classify intent + scope" instruction).
  2. In `service.ts` add `getIntent(workspaceId, prId)` (NotFound on missing PR; returns `repo.getIntent(prId)`) and `recomputeIntent(workspaceId, prId)` which loads pull+repo (mirror `runReview`), loads the diff via `loadDiff(...)` (import from `./diff-loader.js`), calls `deriveIntent`, persists via `repo.upsertIntent(prId, intent)`, and returns `{ intent, provider, model, tokensIn, tokensOut }`.
  3. In `routes.ts` add two routes (both `{ schema: { params: IdParams } }`, `getContext` at the top): `GET /pulls/:id/intent` → `service.getIntent(...)` (return the `Intent` plus the producing model when known); `POST /pulls/:id/intent` → `service.recomputeIntent(...)` with a tight per-route `rateLimit` (mirror the review route's `max: 10`). Declare an inline Zod response schema for the intent response (so the model + token fields are part of the contract); the route handler does only `getContext → service.call → return`.
- **Acceptance**: R1 (test: `deriveIntent` resolves the cheap default model when no override; uses `completeStructured` with `schema: Intent`); R2-call (test: the messages array passed to the mock LLM contains hunk headers + paths but no diff-line bodies); R3 (response/log includes `tokensIn`/`tokensOut`); R4 (`GET` returns persisted intent; `upsertIntent` updates in place — covered by T7 integration test); R5 (second `POST` overwrites). Server typecheck passes: `pnpm -C server exec tsc --noEmit`.
- **Depends-on**: T1 (registry default + `resolveFeatureModel` semantics), T2 (`formatChangedFilesWithHunkHeaders` export).
- **Red flags**: Onion: routes never touch Drizzle/Octokit directly — the service orchestrates and the existing `ReviewRepository.upsertIntent/getIntent` does the DB write (already delegated to `repository/pull.repo.ts`). Do NOT call the LLM through `reviewPullRequest`. Resolve the LLM via `container.llm(provider)` (never `new …Provider`). The linked-issue fetch must add NO network call beyond what import already does — prefer reusing already-imported data; if you must resolve live, do it once and best-effort (catch → omit). `Intent` is imported from `@devdigest/shared` — do not redefine it.

### T4 — run-executor pre-work intent wiring · type: backend · covers: R6 (injection from run), R7
- **Owned paths**:
  - `server/src/modules/reviews/run-executor.ts`
- **Skills (mandatory)**: `onion-architecture`, `fastify-best-practices` (run lifecycle), `typescript-expert`.
- **Task**:
  1. In `executeRuns`, in the shared pre-work phase (after `loadDiff`, around lines 95-105, where the comment already anticipates "shared pre-work (diff + intent)"), add a best-effort intent step using `runLog.step('Deriving PR intent', …, { kind: 'tool' })`. It should: try `this.repo.getIntent(pull.id)`; if absent, call the intent derivation (reuse T3's `deriveIntent` via a small private method OR call `ReviewService`'s path — prefer a private executor method that calls `deriveIntent` so the executor stays self-contained). Log the intent's model + `tokensIn`/`tokensOut` and a "diff bodies omitted to save tokens" note. On ANY failure: `runLog.warn(...)` and continue with `intent = undefined` (do NOT `failAll`).
  2. Thread the resolved intent string into `runOneAgent(...)` (add a param) and pass it to `reviewPullRequest({ ..., ...(intent ? { intent } : {}) })` (mirror the `prDescription` omit-when-empty pattern at lines 218-220). Use the stored `Intent.intent` text as the prompt block; you may also append in/out-of-scope bullets into the same string.
  3. The intent step runs ONCE in pre-work (shared across all agents in the run), so its events land in every queued run's buffer (same as the diff-load step) and appear in each persisted trace.
- **Acceptance**: R7 (run trace/log shows a distinct "Deriving PR intent" step with the cheap model + token counts, separate from the review call; intent-derivation failure leaves the agent runs running and the log shows a warning); R6-from-run (when an intent exists/derives, `reviewPullRequest` receives `intent` → the prompt block + `prompt_assembly.intent` are populated in the persisted trace). Server typecheck passes.
- **Depends-on**: T2 (`ReviewInput.intent`), T3 (`deriveIntent` helper).
- **Red flags**: Pre-work failures historically call `failAll` (fails every run). Intent derivation must NOT use that path — it is best-effort and must `warn + continue`. Do not break the existing diff-load pre-work, the per-agent failure isolation, or the boot reaper (`reapStaleRunningRuns`). The `forRun` narrowing + buffer-to-trace flow must still include the new step.

### T5 — client IntentCard + hook + i18n · type: ui · covers: R8, R5 (UI half)
- **Owned paths**:
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/` (entire new folder: `IntentCard.tsx`, `index.ts`, `styles.ts` if needed)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
  - `client/src/lib/hooks/intent.ts` (new)
  - `client/src/lib/hooks/index.ts`
  - `client/messages/en/intent.json` (new)
- **Skills (mandatory)**: `frontend-architecture`, `react-best-practices`, `next-best-practices`, `zod` (consume shared `Intent` type only).
- **Task**:
  1. New hook file `client/src/lib/hooks/intent.ts` in the `reviews`-adjacent style: `useIntent(prId)` → `api.get<IntentResponse>(\`/pulls/${prId}/intent\`)` with `enabled: prId != null` (the global query policy keeps a 404 "no intent yet" silent so the card renders its empty state); `useRecomputeIntent(prId)` → `api.post<IntentResponse>(\`/pulls/${prId}/intent\`, {})` with `onSuccess: qc.invalidateQueries({ queryKey: ['intent', prId] })`. Mirror `useConventions`/`useExtractConventions` in `conventions.ts`. Re-export both from `hooks/index.ts`. Type the response from `@devdigest/shared` (`Intent`) plus the model field.
  2. New `IntentCard/IntentCard.tsx` (colocated, mirror `FindingCard/` layout: `IntentCard.tsx` + `index.ts` + `IntentCard.test.tsx` (T6 owns the test) + `styles.ts` only if needed). Use vendored `@devdigest/ui` primitives (Card/Badge/Button/Icon — do not introduce a new UI lib). Props: `prId`. It calls `useIntent` + `useRecomputeIntent`. Render: derived intent text, in-scope list, out-of-scope list, the producing model (badge), and a recompute button (shows pending state). Empty state when no intent: a short message + a "Derive intent" button wired to the same recompute mutation. All user-facing strings via `useTranslations('intent')`.
  3. Add the `intent` block to `OverviewTab.tsx`: render `<IntentCard prId={prId} />` above/below the existing description. OverviewTab currently takes `prBody`; add a `prId` prop (the page already has the id via the route — pass it through). Keep OverviewTab thin.
  4. `client/messages/en/intent.json`: a new namespace with keys for title, empty-state, recompute button, in-scope/out-of-scope labels, "produced by {model}".
- **Acceptance**: R8 (RTL test in T6 covers empty/populated/recompute-click); R5-UI (clicking recompute fires the POST and the card refetches). `pnpm -C client exec tsc --noEmit` and `pnpm -C client exec next lint` (or the repo's client lint) pass.
- **Depends-on**: T1 (client mirror types/registry), T3 (the `/pulls/:id/intent` endpoints the hook calls). Can scaffold the component/hook against the contract before T3 lands, but its green test (T6) depends on the endpoint contract being final.
- **Red flags**: Data fetching ONLY via the hook → `services/api.ts` (never `fetch`/`useEffect(fetch)` in the component). Don't double-toast: the global mutation-error toast already fires; only add a surgical inline handler if needed. Import `Intent` from `@devdigest/shared` — don't redefine it. `OverviewTab.tsx` is shared with T6 (test) — T6 only ADDS a sibling test file, never edits `OverviewTab.tsx`; T5 owns all edits to it.

### T6 — tests: client RTL · type: ui · covers: R8
- **Owned paths**:
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.test.tsx` (new)
  - `client/src/lib/hooks/intent.test.ts` (new, optional if the component test covers the hook flow)
- **Skills (mandatory)**: `react-testing-library`, `react-best-practices`.
- **Task**: One or two flow tests for `IntentCard` (jsdom, `fetch` mocked via `src/test/setup.ts`, wrap with `NextIntlClientProvider` using `messages/en/intent.json` and a QueryClient provider): (1) empty state renders when GET returns 404/empty and clicking "Derive intent" fires the POST; (2) populated state renders intent + in-scope/out-of-scope + model badge, and clicking recompute fires the POST and re-renders. Assert on user-visible text/roles, not internals.
- **Acceptance**: R8 (tests pass: `pnpm -C client exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/IntentCard`).
- **Depends-on**: T5 (the component + hook + i18n namespace must exist).
- **Red flags**: Per `../TESTING.md` client tests are hermetic (no real API/DB). Do NOT recreate the e2e browser journey as a jsdom test. T6 must NOT edit `IntentCard.tsx`/`OverviewTab.tsx` — only add the test file(s).

### T7 — tests: server unit + integration · type: backend · covers: R1, R2, R3, R4, R5, R7
- **Owned paths**:
  - `server/src/modules/reviews/intent.test.ts` (new — hermetic unit, `MockLLMProvider`)
  - `server/src/modules/reviews/intent.it.test.ts` (new — testcontainers: persistence/upsert/recompute)
- **Skills (mandatory)**: `onion-architecture` (test layering), `drizzle-orm-patterns`, `zod`, `typescript-expert`.
- **Task**:
  1. Hermetic unit (`intent.test.ts`): inject `MockLLMProvider` via `ContainerOverrides`. Assert: (R1) the resolved model is `deepseek/deepseek-v4-flash` when no `feature_models` override is set; (R2) the messages array sent to the mock contains the `@@` hunk headers + file paths and NONE of the diff-line bodies; (R3) the returned `tokensIn`/`tokensOut` are surfaced. Also unit-test `formatChangedFilesWithHunkHeaders` here OR rely on the reviewer-core test in T2 (note the split so it isn't duplicated — prefer the formatter test in T2's reviewer-core suite).
  2. Integration (`intent.it.test.ts`, testcontainers Postgres per `../TESTING.md`): seed a PR, call `recomputeIntent` twice (R5) and assert the `pr_intent` row updates in place (R4 — single row, latest values); assert `getIntent` returns the persisted `Intent`.
  3. (Optional, if feasible without flaking) a run-executor test asserting intent-derivation failure does not fail the agent runs (R7) — otherwise leave R7 to manual verification and note it.
- **Acceptance**: `pnpm -C server exec vitest run src/modules/reviews/intent.test.ts` (unit) and `pnpm -C server exec vitest run src/modules/reviews/intent.it.test.ts` (integration) pass.
- **Depends-on**: T3 (service/helper under test), T4 (for the optional R7 executor test), T2 (formatter, if asserted here).
- **Red flags**: `*.it.test.ts` is the DB-backed convention — keep DB tests in the `.it.` file and hermetic tests out of it. Use `server/src/adapters/mocks.ts` (`MockLLMProvider`) not ad-hoc stubs. `server/package.json` is `skip-worktree` — invoke vitest directly via `pnpm exec`, don't add committed test scripts.

### T8 — docs (optional) · type: ui · covers: (documentation only — no R-ID)
- **Owned paths**:
  - `docs/agent-prompts/` is for built-in reviewer prompts — NOT this. If documented, place a how-it-works note under `client/docs/` or `server/README.md`'s API map via the `doc-writer` skill; do NOT edit module code.
- **Skills (mandatory)**: `doc-writer`.
- **Task**: Document the intent cascade (cheap call → persist → inject) with a small Mermaid diagram of the run-time two-call flow. Optional; can be dropped without affecting acceptance.
- **Acceptance**: A doc lands in the correct Diátaxis location with a captioned diagram.
- **Depends-on**: T3, T4, T5 (document the shipped behavior).
- **Red flags**: Docs only — never touch product code from this task. Pick a path that collides with no other task.

## Sequencing & risks
- **Topological order**: T1 → T2 → T3 → T4; T1 → T5 → T6; (T3, T4, T2) → T7; (T3, T4, T5) → T8.
- **Truly parallel after T1**: T2 (reviewer-core) and T5 (client UI scaffold) can run concurrently. T3 needs T2's formatter export; T4 needs T2 + T3. T6 follows T5; T7 follows T3/T4. So a practical wave plan is:
  - Wave 1: **T1** (alone — every other task imports its contract/registry changes).
  - Wave 2: **T2** + **T5** (parallel; T5 codes against the agreed endpoint contract).
  - Wave 3: **T3**.
  - Wave 4: **T4** + **T6** (parallel).
  - Wave 5: **T7** + **T8** (parallel).
- **Decisions needing human confirmation**:
  - Placement of `formatChangedFilesWithHunkHeaders`: this plan puts it in reviewer-core as a pure export (reusable, trivially unit-testable, and reviewer-core already owns `UnifiedDiff` handling). Alternative: a server-only helper in `reviews/intent.ts`. Confirm reviewer-core is acceptable (it stays pure — pure function, no I/O).
  - The intent system prompt wording and the exact scope-discipline rule text — short stubs are specified; confirm final copy.
- **Migrations**: NONE. `pr_intent` (PK `prId`, cascade) and `settings.feature_models` (JSONB) already exist (`server/src/db/schema/reviews.ts:48-55`, `platform.ts:95`). If any schema change is later introduced it needs `pnpm -C server db:generate` + a committed migration, and `pnpm -C server db:migrate` is **manual** (never on boot) — but this feature requires neither.

## Verification per task
- **T1**: `pnpm -C server exec tsc --noEmit` AND `pnpm -C client exec tsc --noEmit` (both green; both `trace.ts` files declare `PromptAssembly.intent`, both registries show the cheap `review_intent` default).
- **T2**: `cd reviewer-core && npm run build` (= `tsc --noEmit`) AND `npm test` (new prompt + formatter unit tests green). (npm, NOT pnpm.)
- **T3**: `pnpm -C server exec tsc --noEmit` (green; routes/service compile, no Drizzle/Octokit leak into routes).
- **T4**: `pnpm -C server exec tsc --noEmit` (green; executor compiles with the new intent step + `ReviewInput.intent`).
- **T5**: `pnpm -C client exec tsc --noEmit` AND the client lint task (green; IntentCard + hooks + i18n compile, no `fetch` in components).
- **T6**: `pnpm -C client exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/IntentCard` (green).
- **T7**: `pnpm -C server exec vitest run src/modules/reviews/intent.test.ts` (hermetic, green) AND `pnpm -C server exec vitest run src/modules/reviews/intent.it.test.ts` (testcontainers, green).
- **T8**: doc renders; no code diff in any owned product-code path.

## Open questions
1. **Linked-issue depth in the intent input**: `linked_issue` is resolved live by Octokit (`octokit.ts:127-135`) and returned on `PrDetail` but NOT persisted. For the run-executor path (T4) the executor has `pull` but not the live `PrDetail`. Confirm: is it acceptable for the intent input to use the linked-issue body only when it is cheaply available (e.g. a single best-effort `container.github()` resolve guarded by try/catch), or must the executor avoid the extra GitHub call entirely and use only title+body+file-list when no issue body is already in hand? The plan assumes "best-effort, guarded, no failure on miss."
2. **Final intent system-prompt + scope-rule copy** (stubs specified) — confirm wording, especially the "ONE signal finding, not twenty" out-of-scope rule.
3. **Formatter home** (reviewer-core vs server helper) — see Sequencing decisions; plan picks reviewer-core.
