# Implementation Plan: multi-agent-review

**Spec:** SPEC-05 (`specs/SPEC-05-2026-07-multi-agent-review-worktree-a.md`)

## Overview

Users currently run one agent at a time on a PR and have no way to compare what different agents flagged. This plan wires a multi-agent fan-out: extend the `RunRequest` contract with `agentIds[]`, fold per-agent run estimates into `GET /agents`, and build the agent-picker popover, a Configure run page, and a results page with Columns / Tabs views, live SSE updates, and a client-side "Where agents disagree" block.

## Execution mode: multi-agent

Three parallel implementer agents, two sequential waves. Wave 1 is a single foundational task (T1) that owns all files touching the existing PR page; Wave 2 runs two tasks in parallel (T2, T3) once T1 is complete.

## Requirements

| ID | Covers AC | Requirement | Acceptance criteria (measurable) |
|---|---|---|---|
| R1 | AC-21 | Extend `RunRequest` shared Zod contract with optional non-empty `agentIds: string[]`; extend `resolveTargets` / route handler to fan out per id; reject with 400 when none of `agentId`, `all:true`, `agentIds` is present | `POST /pulls/:id/review { agentIds: ["a","b"] }` returns `{ runs: [{ run_id, agent_id, agent_name }, …] }` with one entry per id; body `{}` returns 400 |
| R2 | AC-20 | Extend `AgentsService.list` to batch-query the last 3 `status='done'` `agent_runs` per agent, compute avg `duration_ms` and avg cost via `PriceBook.estimate`, and fold into the `GET /agents` response as `estimate: { duration_avg_ms, cost_avg_usd }` (nullable each) | `GET /agents` response includes `estimate` object; agent with 3 done runs returns numeric values; agent with 0 done runs returns `{ duration_avg_ms: null, cost_avg_usd: null }` |
| R3 | AC-1, AC-5, AC-18 | Replace `RunReviewDropdown` on the PR detail page with a multi-agent picker popover: checkboxes per enabled agent, pre-run estimates (or "~?"/"~$?"), pre-checked to all enabled agents, "Run multi-agent review (N)" button disabled when none checked or no enabled agents exist, plus a `/agents` CTA when list is empty | Picker renders checkboxes with estimate values; clicking "Run multi-agent review (2)" calls `POST /pulls/:id/review { agentIds: [...] }`; empty state shows CTA to `/agents` |
| R4 | AC-2, AC-6 | After a successful launch from either the picker or the Configure run page, navigate to `/multi-agent-review/results?pr=<prId>&runs=<r1,r2,...>` carrying all returned run ids | Navigation occurs with the correct query params; run ids match `runs[].run_id` from the server response |
| R5 | AC-22 | Add "Multi-Agent Review" nav entry in `client/src/vendor/ui/nav.ts` pointing to `/multi-agent-review`; assign `gKey: "m"` (free in SHORTCUTS); add `g m` to the SHORTCUTS list | `NAV` array contains the entry; `g m` shortcut fires navigation |
| R6 | AC-3, AC-4, AC-5, AC-6, AC-18, AC-19 | Build the Configure run page at `client/src/app/multi-agent-review/page.tsx`: PR selector (disabled/placeholder when no PRs), agent cards (name, description, estimated duration, estimated cost), summary line (time ≈ max of selected, cost = sum of selected), launch button; empty-agent state shows `/agents` CTA; empty-PR state disables selector | Configure run page renders disabled state without PR; selecting a PR renders cards with estimates; clicking launch POSTs and navigates to results URL |
| R7 | AC-7, AC-8, AC-9, AC-10, AC-11, AC-17, AC-23 | Build the results page at `client/src/app/multi-agent-review/results/page.tsx`: load runs from `GET /pulls/:prId/runs` filtered to URL run-id set, load findings from `GET /pulls/:prId/reviews` filtered to same run-id set, subscribe `useRunEvents` per run id; render Columns view (one column per run: agent name, live status, score badge, finding cards, "View trace"); failed/cancelled column renders error state; completed columns render immediately while in-progress columns stream | Results page renders one column per run id from URL; status badges update via SSE without reload; "View trace" opens the shared `RunTraceDrawer` |
| R8 | AC-12, AC-13, AC-14 | Add Tabs view (toggle from Columns): one tab per agent with summary banner (score, one-line summary, "View trace", time, cost); expanding a finding shows confidence, rationale, suggested fix, Accept, Dismiss, Learn (stub), Turn into eval case (stub); Accept/Dismiss call existing `/findings/:id/accept|dismiss` endpoints | Tabs toggle shows per-agent tabs; finding expand shows all fields; Accept/Dismiss update visual state |
| R9 | AC-15, AC-16 | Add "Where agents disagree" block below both views: pure client `groupFindingsByLocation` helper (same file + overlapping `startLine..endLine`); one cell per run-set agent (severity+title or "did not flag"); "Show only conflicts" toggle hides uniform groups | Block renders one group per overlapping location; "Show only conflicts" ON removes uniform groups; all-agree or zero-finding edge cases render empty state |
| R10 | AC-9, AC-10, AC-11 | Promote `RunTraceDrawer` (and its `_components` subtree: `TraceBody`, `PromptBlock`, `FindingsSection`, `ToolCallRow`, `PromptModalBody`, `TraceSection`, `atoms.tsx`) from `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/` to `client/src/components/RunTraceDrawer/`; update all import sites (PR detail page and the new results page) | Both PR page and results page import `RunTraceDrawer` from `client/src/components/RunTraceDrawer`; no dead copies remain at the old path |

### Descoped ACs

*(none — all 23 ACs are covered)*

### Open recommendations

- **Estimate query placement (accepted by spec):** `AgentsService.list` will issue one additional batched Drizzle query (GROUP BY `agent_id`, LIMIT 3 per group via window function or a lateral join). This is a minimal read addition consistent with the "no new route" stance — the spec explicitly allows it.
- **`RunRequest` is in `platform.ts` but `Agent` is in `knowledge.ts`:** both are in `server/src/vendor/shared/contracts/` and must be mirrored to `client/src/vendor/shared/contracts/`. **Status: noted as a Red flag in T1.**
- **Results URL shape (non-blocking per spec):** `/multi-agent-review/results?pr=<prId>&runs=<r1,r2,...>` — query params on a static route, no dynamic segments. Avoids collision with the Configure page at `/multi-agent-review`. Implementer encodes this.

## Affected packages / modules

- `server/` — `modules/reviews` (contract + service + repository), `modules/agents` (service + repository), `vendor/shared/contracts/platform.ts`, `vendor/shared/contracts/knowledge.ts`
- `client/` — `vendor/shared/contracts/` (mirror), `lib/hooks/agents.ts`, `lib/hooks/reviews.ts`, `vendor/ui/nav.ts`, `app/repos/[repoId]/pulls/[number]/` (picker + RunTraceDrawer removal), `app/multi-agent-review/` (new pages), `components/RunTraceDrawer/` (promoted shared location)

---

## Tasks (parallel units)

### T1 — Contract + estimates + PR-page refactor · type: backend+ui · covers: R1, R2, R3, R4, R5, R10

This task is the **foundation wave** (Wave 1). It owns every file that touches the existing PR page and both shared contract files, preventing concurrent edits with Wave 2.

- **Owned paths**:
  - `server/src/vendor/shared/contracts/platform.ts` (extend `RunRequest`)
  - `server/src/vendor/shared/contracts/knowledge.ts` (extend `Agent` with `estimate`)
  - `client/src/vendor/shared/contracts/platform.ts` (mirror)
  - `client/src/vendor/shared/contracts/knowledge.ts` (mirror)
  - `server/src/modules/reviews/routes.ts` (pass `agentIds` through to `resolveTargets`)
  - `server/src/modules/reviews/service.ts` (`resolveTargets` extended for `agentIds`)
  - `server/src/modules/agents/service.ts` (`list` extended with estimate batch query)
  - `server/src/modules/agents/repository.ts` (new `lastDoneRunsPerAgent` query)
  - `client/src/lib/hooks/agents.ts` (update `useAgents` return type to include `estimate`)
  - `client/src/lib/hooks/reviews.ts` (add `useRunMultiAgentReview` mutation that sends `agentIds`)
  - `client/src/vendor/ui/nav.ts` (add "Multi-Agent Review" entry + `gKey: "m"`)
  - `client/src/components/app-shell/hooks/useGlobalShortcuts.ts` (add `g m` shortcut)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx` (replace with multi-agent picker popover; keep same file path so `index.ts` re-export is undisturbed)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.test.tsx` (update tests)
  - `client/src/components/RunTraceDrawer/` (new shared location — all files moved from old path, directory created)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/` (delete all files; imports updated in PR detail page to point to shared location)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.test.tsx` (move test to `client/src/components/RunTraceDrawer/RunTraceDrawer.test.tsx`)
  - `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (update RunTraceDrawer import; wire `onRunsStarted` → navigate to results URL)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/RunStatus/RunStatus.tsx` (update RunTraceDrawer import if it imports from the old path — verify before touching)
  - `messages/en/prReview.json` (or equivalent i18n namespace — add picker strings)

- **Skills (mandatory)**: `onion-architecture`, `fastify-best-practices`, `zod`, `drizzle-orm-patterns`, `frontend-architecture`, `react-best-practices`, `next-best-practices`

- **Task**:
  1. **Shared contracts (server side):** In `platform.ts`, add `agentIds: z.array(z.string().uuid()).nonempty().optional()` to `RunRequest`. In `knowledge.ts`, extend `Agent` with `estimate: z.object({ duration_avg_ms: z.number().nullable(), cost_avg_usd: z.number().nullable() }).optional()`.
  2. **Mirror to client:** Apply identical changes to `client/src/vendor/shared/contracts/platform.ts` and `knowledge.ts`.
  3. **`resolveTargets` + route:** Add the `agentIds` branch to `ReviewService.resolveTargets`. In `routes.ts`, pass `agentIds` from the parsed body to `resolveTargets`. The existing 400 error from `resolveTargets` when no valid option is present already covers the "none of the three" case — verify the guard fires correctly.
  4. **Estimate batch query:** In `AgentsRepository`, add `lastDoneRunsPerAgent(workspaceId: string, agentIds: string[])` that returns the last 3 `status='done'` runs per agent (use a lateral subquery or `rank()` window function — do NOT do N+1 per agent). In `AgentsService.list`, call this query after fetching the agent list, compute avg duration and avg cost via `container.priceBook.estimate()`, and fold into the DTO as `estimate`.
  5. **`useRunMultiAgentReview` hook:** Add to `lib/hooks/reviews.ts` — a mutation that POSTs `{ agentIds: string[] }` to `/pulls/:prId/review` and returns `ReviewRunResponse`. The existing `useRunReview` stays untouched for backward compatibility.
  6. **Nav + shortcut:** Add `{ key: "multi-agent-review", label: "Multi-Agent Review", icon: "Cpu", href: "/multi-agent-review", gKey: "m" }` to the appropriate NAV group. Add `{ keys: "g m", label: "Go to Multi-Agent Review", group: "Navigation" }` to `SHORTCUTS`. Add the `g m` binding in `useGlobalShortcuts.ts`.
  7. **Promote `RunTraceDrawer`:** Move the entire `RunTraceDrawer/` folder (including `_components/TraceBody`, `PromptBlock`, `FindingsSection`, `ToolCallRow`, `PromptModalBody`, `TraceSection`, `atoms.tsx`, `helpers.ts`, `styles.ts`, `constants.ts`, `index.ts`, `RunTraceDrawer.tsx`, `RunTraceDrawer.test.tsx`) to `client/src/components/RunTraceDrawer/`. Delete the source folder at the old path. Update all import sites in the PR detail page and `RunStatus` (if it imports `RunTraceDrawer`).
  8. **Replace `RunReviewDropdown` with multi-agent picker:** Rewrite `RunReviewDropdown.tsx` in place as an agent-picker popover using `useAgents` (which now returns `estimate`) and `useRunMultiAgentReview`. Checkboxes for each enabled agent, pre-checked to all enabled; show `estimate.duration_avg_ms` as `~Xs` or `~?`, `estimate.cost_avg_usd` as `~$X.XX` or `~$?`. "Run multi-agent review (N)" button disabled when no agents checked or list empty. On success, navigate to `/multi-agent-review/results?pr=<prId>&runs=<r1,r2>`. Empty state (`agents.length === 0`) shows a link to `/agents`.
  9. **PR detail page wiring:** In `page.tsx`, update the `RunTraceDrawer` import to the new shared path; wire the picker's `onRunsStarted` callback to navigate to the results URL.

- **Acceptance**:
  - `POST /pulls/:id/review { agentIds: ["<uuid>","<uuid>"] }` returns two `run_id` entries (R1)
  - `POST /pulls/:id/review {}` returns 400 (R1)
  - `GET /agents` returns each agent with an `estimate` object; agents with 0 done runs return null fields (R2)
  - Picker popover renders with checkboxes and estimates; clicking launch navigates to results URL (R3, R4)
  - NAV constant contains "Multi-Agent Review" entry with `gKey: "m"` (R5)
  - No import of `RunTraceDrawer` from the old path remains in the PR page (R10)
  - `pnpm tsc --noEmit` passes in `server/`; `pnpm tsc --noEmit` passes in `client/`

- **Depends-on**: none (Wave 1)

- **Red flags**:
  - The `Agent` Zod contract lives in `knowledge.ts`, NOT `platform.ts` — ensure the correct file is extended and mirrored.
  - The estimate batch query must NOT do N+1 per agent. Use a single SQL query with a window function (e.g. `ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY ran_at DESC)`) filtered to `rn <= 3`. Check `server/AGENTS.md` — Drizzle pattern for lateral/window applies here; `drizzle-orm-patterns` skill is mandatory.
  - `RunRequest` is currently parsed with `RunRequest.parse(req.body ?? {})` in `routes.ts` (not via Fastify schema body validation) — extend both the Zod object AND keep the parse call. Do NOT add a Fastify body schema for this route (it deliberately uses a tolerant manual parse; see the route comment).
  - After the move, the `RunTraceDrawer` test file must also live at the new path. The PR page's `RunStatus` component must be checked for a direct import from the old path — read it before assuming.
  - The shared contracts are **dual-vendored**: any change to `server/src/vendor/shared/contracts/*.ts` MUST be mirrored identically to `client/src/vendor/shared/contracts/*.ts`. Failure to mirror causes a type mismatch between the API surface and the client consumers.
  - The `estimate` field on `Agent` should be `optional()` in the Zod schema so that old cached responses (without the field) do not fail validation on the client.
  - `pnpm` is the package manager for both `server/` and `client/`; `npm` is NOT used here.

---

### T2 — Configure run page · type: ui · covers: R6

- **Owned paths**:
  - `client/src/app/multi-agent-review/page.tsx` (Configure run page)
  - `client/src/app/multi-agent-review/layout.tsx` (layout if needed)
  - `client/src/app/multi-agent-review/_components/ConfigureRunPage/ConfigureRunPage.tsx`
  - `client/src/app/multi-agent-review/_components/ConfigureRunPage/ConfigureRunPage.test.tsx`
  - `client/src/app/multi-agent-review/_components/AgentEstimateCard/AgentEstimateCard.tsx`
  - `client/src/app/multi-agent-review/_components/AgentEstimateCard/AgentEstimateCard.test.tsx`
  - `messages/en/multiAgentReview.json` (i18n strings for the Configure run page)

- **Skills (mandatory)**: `frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`

- **Task**:
  Build the Configure run page at `client/src/app/multi-agent-review/page.tsx`. The page uses `useAgents` (already returns `estimate` after T1) and a PR selector backed by an existing hook for the PR list.

  Structure:
  - **Step 1 — PR selector:** a dropdown or combobox of all pull requests across the workspace's repos. Use the existing `usePulls` / core pull hooks (check `lib/hooks/core.ts` or `lib/hooks/index.ts` for the correct hook name). When no PRs exist, render a disabled selector with placeholder text.
  - **Step 2 — Agent selection panel:** disabled/empty-state when no PR selected. Once a PR is selected, render per-agent `AgentEstimateCard` (name, static `description`, `estimate.duration_avg_ms` formatted as `~Xs` or `~?`, `estimate.cost_avg_usd` formatted as `~$X.XX` or `~$?`). Checkboxes; pre-checked to all enabled agents. When no agents exist, render empty state with a `/agents` CTA and a disabled launch button.
  - **Summary line:** below the agent list, show `time ≈ max(selected duration_avg_ms)` and `cost = sum(selected cost_avg_usd)`. Show "~?" / "~$?" when any selected agent has null estimates.
  - **Launch button:** "Run multi-agent review (N)" — disabled when no agents checked, no PR selected, or agents list empty. On click, call `useRunMultiAgentReview` with `{ prId, agentIds: checkedIds }` and navigate to `/multi-agent-review/results?pr=<prId>&runs=<r1,r2,...>`.
  - Use `useTranslations("multiAgentReview")` for all user-facing strings; create `messages/en/multiAgentReview.json` with the required keys.

- **Acceptance**:
  - Page renders disabled PR selector with placeholder when no PR selected (AC-3, AC-19)
  - Selecting a PR renders per-agent cards with estimates (AC-4)
  - Agent with null estimates renders "~?" / "~$?" (AC-5)
  - No-agents state renders `/agents` CTA and disabled launch button (AC-18)
  - Clicking launch navigates to the results URL with correct `pr` and `runs` params (AC-6, R4)
  - `pnpm tsc --noEmit` passes in `client/`

- **Depends-on**: T1 (needs the extended `useAgents` + `useRunMultiAgentReview` hook)

- **Red flags**:
  - Do not reach for `fetch` directly; all API calls through hooks in `lib/hooks/`. Check `lib/hooks/index.ts` to find the existing PR-list hook before writing a new one.
  - The `multi-agent-review/` folder must use the Next.js App Router convention (`page.tsx`, optional `layout.tsx`). The page is a **Client Component** (`"use client"`) because it needs interactive state (PR selection, agent checkboxes).
  - `client/src/components/RunTraceDrawer/` is used by T3, NOT by T2 — do not import it here.
  - i18n: `messages/en/multiAgentReview.json` is a new namespace; ensure it is imported in the `next-intl` config if there is one (`client/src/i18n/`).

---

### T3 — Results page + groupFindingsByLocation · type: ui · covers: R7, R8, R9

- **Owned paths**:
  - `client/src/app/multi-agent-review/results/page.tsx` (Results page)
  - `client/src/app/multi-agent-review/results/_components/ResultsPage/ResultsPage.tsx`
  - `client/src/app/multi-agent-review/results/_components/ResultsPage/ResultsPage.test.tsx`
  - `client/src/app/multi-agent-review/results/_components/AgentColumn/AgentColumn.tsx`
  - `client/src/app/multi-agent-review/results/_components/AgentColumn/AgentColumn.test.tsx`
  - `client/src/app/multi-agent-review/results/_components/AgentTab/AgentTab.tsx`
  - `client/src/app/multi-agent-review/results/_components/AgentTab/AgentTab.test.tsx`
  - `client/src/app/multi-agent-review/results/_components/DisagreementBlock/DisagreementBlock.tsx`
  - `client/src/app/multi-agent-review/results/_components/DisagreementBlock/DisagreementBlock.test.tsx`
  - `client/src/app/multi-agent-review/results/_lib/groupFindingsByLocation.ts`
  - `client/src/app/multi-agent-review/results/_lib/groupFindingsByLocation.test.ts`

- **Skills (mandatory)**: `frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`

- **Task**:
  Build the results page and all its sub-components.

  **Data assembly (no new server routes):**
  - Parse `?pr=<prId>&runs=<r1,r2,...>` from the URL (`useSearchParams`).
  - Load `usePrRuns(prId)` → filter client-side to the URL run-id set → `RunSummary[]` (contains `status`, `score`, `cost_usd`, `duration_ms`, `findings_count`, `agent_name`, `error`).
  - Load `usePrReviews(prId)` → filter client-side to the URL run-id set → `ReviewRecord[]` (contains `run_id`, `findings[]`).
  - Subscribe `useRunEvents(runIds)` for live SSE status updates.
  - Note: `usePrRuns` and `usePrReviews` are existing hooks; no new hooks needed (the implementer should verify this against the current hook names in `lib/hooks/index.ts` before proceeding).

  **Columns view (default):**
  - One column per run id in URL set. Column header: agent name (from `RunSummary.agent_name`), live status badge (from SSE events or `RunSummary.status`), score badge. Body: finding cards (severity, title, file:line). Footer: "View trace" button → opens shared `RunTraceDrawer` at `client/src/components/RunTraceDrawer/` with `runId` + `findings` prop (the already-loaded `FindingRecord[]` for this run; no extra fetch).
  - Failed/cancelled column: render error state showing `RunSummary.error`; other columns remain fully functional (AC-17).
  - In-flight column: show live status; load findings for already-completed runs (AC-23).
  - Zero-findings column: explicit "No findings" empty state.

  **Tabs view:**
  - Toggle button (keyboard-operable, ARIA `role="tablist"`) switches between Columns and Tabs.
  - One tab per run, labelled by agent name. Tab content: summary banner (score, one-line summary from `ReviewRecord.summary`, "View trace" button, duration, cost); scrollable finding list.
  - Expanding a finding shows: title, category tag, file:line, confidence percentage, rationale, suggested fix, action buttons Accept (`useFindingAction({ action: "accept" })`), Dismiss (`useFindingAction({ action: "dismiss" })`), Learn (stub: `<button disabled title="TODO: Memory homework">Learn</button>`), Turn into eval case (stub: `<button disabled title="TODO: L06 evals">Turn into eval case</button>`).

  **`groupFindingsByLocation` pure helper** (`results/_lib/groupFindingsByLocation.ts`):
  - Signature: `groupFindingsByLocation(findings: { findingId: string; runId: string; file: string; startLine: number; endLine: number; severity: string; title: string }[], runIds: string[]) → GroupedLocation[]`
  - Group by `file` + overlapping `startLine..endLine` (intervals A and B overlap iff `A.start <= B.end && B.start <= A.end`).
  - Each group: `{ file, startLine, endLine, cells: Record<runId, { severity, title } | "did-not-flag"> }`.
  - A run-set agent with no overlapping finding in a group gets `"did-not-flag"`.
  - "Conflicts" = groups where not all cells are the same bucket (flagged vs "did-not-flag") — i.e., at least one agent flagged and at least one did not.
  - Zero-group edge case (all agree or zero findings): return `[]`.

  **"Where agents disagree" block (`DisagreementBlock`):**
  - Renders below the active view (Columns or Tabs).
  - "Show only conflicts" toggle (keyboard-operable, ARIA `role="switch"`) filters to conflict groups.
  - Empty state when `groups.length === 0` ("All agents agree — no conflicting locations" or when all agents agree with toggle ON).
  - Single-agent-selected edge case: render empty state ("No cross-agent data").

- **Acceptance**:
  - Results page renders one column per run id in URL; status updates via SSE without reload (AC-7, AC-23)
  - "View trace" opens shared `RunTraceDrawer` with the correct `runId` and findings prop; no extra findings fetch (AC-9)
  - Drawer defaults to log tab when `running=true`, trace tab when `running=false` (AC-10) — this is existing `RunTraceDrawer` behavior; verify it is preserved after T1's move
  - Failed run renders error state; others show results (AC-17)
  - Tabs view renders per-agent tabs with summary banner and finding cards (AC-12)
  - Expanded finding shows confidence, rationale, suggestion, all four buttons (AC-13)
  - Accept/Dismiss call existing endpoints and update UI (AC-14)
  - Disagreement block renders groups with flagged/did-not-flag cells (AC-15)
  - "Show only conflicts" toggle hides uniform groups (AC-16)
  - `groupFindingsByLocation` unit test: two agents with overlapping finding → one group with two cells; one agent has no overlap → "did-not-flag" cell (AC-15)
  - `pnpm tsc --noEmit` passes in `client/`

- **Depends-on**: T1 (needs the shared `RunTraceDrawer` at `client/src/components/RunTraceDrawer/`; needs `useRunMultiAgentReview` type for results URL shape confirmation)

- **Red flags**:
  - `client/src/components/RunTraceDrawer/` is created by T1 in Wave 1. T3 must NOT start until T1 is complete.
  - Do NOT import `RunTraceDrawer` from the old path `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/`.
  - The results page reads `?runs=r1,r2` — parse with `searchParams.get("runs")?.split(",") ?? []`. A `run_id` in the URL that belongs to a different workspace is naturally excluded because `listRunsForPull` is workspace-scoped (the run simply won't appear in the filtered list; render that column in "not found" error state).
  - The `usePrRuns` and `usePrReviews` hooks poll while runs are `status='running'`. This gives automatic live updates for the column status badges even without SSE — SSE is an additive real-time layer on top.
  - LLM-generated text (`rationale`, `suggestion`) must be rendered as `{text}` in JSX (escaped by React); never `dangerouslySetInnerHTML`. The `INJECTION_GUARD` in `wrapUntrusted` already guards these fields before they reach the DB, but the client must not bypass that by rendering raw HTML.
  - The Columns/Tabs toggle and "Show only conflicts" toggle must be keyboard-operable (Space/Enter) with appropriate ARIA attributes (`role="tablist"` / `role="switch"`) per AC accessibility requirement.
  - `groupFindingsByLocation` is a pure function (no I/O, no hooks). It must live in `_lib/`, not inside a component, so it is unit-testable without a DOM. Its unit test file must NOT end in `.it.test.ts` (no DB needed).

---

## Test intents

What must be tested — a statement, not a task. The `impl` skill will add these to the manual checklist.

- R1 → surface: server-it → `POST /pulls/:id/review` with `agentIds: [a, b]` creates two `agent_runs` and returns two run ids; body `{}` returns 400; body with `agentId` alone still works (AC-21 verification hint)
- R2 → surface: server-it → insert 5 `agent_runs` for an agent (3 done + 2 failed); assert `GET /agents` returns `estimate.duration_avg_ms` averaged over the 3 done rows; agent with 0 done runs returns `null` fields (AC-20 verification hint)
- R3 → surface: client → render the picker popover with mocked agent list including estimates; assert checkboxes and estimate values render; empty list renders `/agents` CTA (AC-1, AC-5, AC-18)
- R4 → surface: client → clicking "Run multi-agent review (2)" POSTs `agentIds` and navigates to results URL with returned run ids (AC-2)
- R5 → surface: client → the `NAV` constant includes a "Multi-Agent Review" entry with `href: "/multi-agent-review"` and `gKey: "m"` (AC-22)
- R6 → surface: client → Configure run page without PR renders agent panel disabled; selecting a PR renders agent cards with estimates and summary line (AC-3, AC-4, AC-5, AC-19)
- R7 → surface: client → results page (Columns) with mocked per-run data renders one column per run id; simulate SSE events for two run ids and assert status labels update (AC-7, AC-8, AC-23)
- R8 → surface: client → "View trace" opens shared `RunTraceDrawer` with correct `runId` and findings prop; no separate findings fetch triggered (AC-9)
- R9 → surface: client → results page with one run `status='failed'` renders error state in that column; others show results (AC-17)
- R10 → surface: client → toggling to Tabs view renders one tab per agent with summary banner; expanding a finding shows all fields and buttons (AC-12, AC-13)
- R11 → surface: client → Accept/Dismiss buttons on a finding call the correct endpoint and update visual state (AC-14)
- R12 → surface: client (unit, pure) → `groupFindingsByLocation`: two agents with overlapping finding on same file → one group with two flagged cells; agent with no overlapping finding → "did-not-flag" cell (AC-15)
- R13 → surface: client → "Show only conflicts" toggle ON hides uniform groups; mixed groups remain (AC-16)
- R14 → surface: client → drawer with `running=true` defaults to log tab; `running=false` defaults to trace tab with prompt blocks (AC-10); drawer with `failed` run renders error without crash (AC-11)
- R15 → surface: e2e (manual) → visit Configure run page, pick a PR, check two agents, click run, assert navigation to results URL (AC-6 verification hint)

## Sequencing & risks

**Wave 1 (T1 only):** T1 runs alone. It is deliberately coarse because it owns the only files that touch both shared contracts and the existing PR page. No other task can proceed until T1 completes, because T2 and T3 both import the extended hooks and the shared `RunTraceDrawer`.

**Wave 2 (T2 ∥ T3):** Once T1 is green (typecheck + existing tests), T2 and T3 run concurrently. Their owned paths are fully disjoint — T2 owns `multi-agent-review/page.tsx` and `_components/`, T3 owns `multi-agent-review/results/` and `_lib/`.

**DAG:**
```
T1 → T2
T1 → T3
```
Maximum wave width = 2 (Wave 2). Hard cap of 3 is satisfied.

**Risks:**
- The estimate batch query (T1) is the only non-trivial DB read addition. A naive approach (N+1 query per agent) would violate the < 500 ms latency budget stated in Non-functional requirements. Use a single query with a window function.
- `RunRequest` uses `.parse()` (not Fastify schema validation) in `routes.ts`. Adding `agentIds` to the Zod schema is sufficient; no Fastify schema change is needed and none should be attempted (the route comment documents this intentional pattern).
- The shared contract dual-vendor mirror is the most common source of subtle type drift. T1 must apply identical changes to both `server/src/vendor/shared` and `client/src/vendor/shared`.
- No migration is required. `multi_agent_runs` table already exists as a stub and is not modified. `agent_runs` is not modified.
- The spec leaves the results URL shape as non-blocking (`[NEEDS CLARIFICATION]`). The plan adopts `/multi-agent-review/results?pr=<prId>&runs=<r1,r2>` (query params on a static `results/page.tsx`). Implementers must not use a dynamic route segment for the run-id set (it would conflict with the static configure page layout and produce a segment-count mismatch).

## Verification per task/step

**T1 (Wave 1 exit gate):**
```bash
# From server/
cd /Users/admin/emdash/worktrees/dev-digest/emdash/multi-agent-review-gvxl9/server
pnpm tsc --noEmit

# From client/
cd /Users/admin/emdash/worktrees/dev-digest/emdash/multi-agent-review-gvxl9/client
pnpm tsc --noEmit

# Integration tests (requires Docker; self-skips if absent)
cd /Users/admin/emdash/worktrees/dev-digest/emdash/multi-agent-review-gvxl9/server
pnpm exec vitest run --reporter=verbose src/modules/reviews src/modules/agents

# Existing client unit tests (must remain green)
cd /Users/admin/emdash/worktrees/dev-digest/emdash/multi-agent-review-gvxl9/client
pnpm exec vitest run --reporter=verbose
```

**T2 (after T2 completes):**
```bash
cd /Users/admin/emdash/worktrees/dev-digest/emdash/multi-agent-review-gvxl9/client
pnpm tsc --noEmit
pnpm exec vitest run --reporter=verbose src/app/multi-agent-review
```

**T3 (after T3 completes):**
```bash
cd /Users/admin/emdash/worktrees/dev-digest/emdash/multi-agent-review-gvxl9/client
pnpm tsc --noEmit
pnpm exec vitest run --reporter=verbose src/app/multi-agent-review/results
```

**Full green (all waves complete — the `/impl` coverage gate and architecture-reviewer check these):**
```bash
# Server typecheck
cd /Users/admin/emdash/worktrees/dev-digest/emdash/multi-agent-review-gvxl9/server && pnpm tsc --noEmit

# Client typecheck
cd /Users/admin/emdash/worktrees/dev-digest/emdash/multi-agent-review-gvxl9/client && pnpm tsc --noEmit

# reviewer-core build (must not regress)
cd /Users/admin/emdash/worktrees/dev-digest/emdash/multi-agent-review-gvxl9/reviewer-core && npm run build

# All client unit tests
cd /Users/admin/emdash/worktrees/dev-digest/emdash/multi-agent-review-gvxl9/client && pnpm exec vitest run --reporter=verbose

# Server unit + integration tests (self-skips without Docker)
cd /Users/admin/emdash/worktrees/dev-digest/emdash/multi-agent-review-gvxl9/server && pnpm exec vitest run --reporter=verbose
```

**AC→evidence map for the coverage gate (`plan-verifier`):**

| AC | Evidence location |
|---|---|
| AC-1 | `RunReviewDropdown.tsx` (picker popover), `RunReviewDropdown.test.tsx` |
| AC-2 | `lib/hooks/reviews.ts` (`useRunMultiAgentReview`), `RunReviewDropdown.tsx` (navigate on success) |
| AC-3 | `ConfigureRunPage.test.tsx` (no-PR renders disabled state) |
| AC-4 | `ConfigureRunPage.test.tsx` (with-PR renders cards + summary), `AgentEstimateCard.tsx` |
| AC-5 | `RunReviewDropdown.test.tsx` + `AgentEstimateCard.test.tsx` (null estimate → "~?"/"~$?") |
| AC-6 | `ConfigureRunPage.test.tsx` (launch navigates to results URL) |
| AC-7 | `ResultsPage.test.tsx` (SSE event → column status update) |
| AC-8 | `ResultsPage.test.tsx` (Columns view columns), `AgentColumn.tsx` |
| AC-9 | `ResultsPage.test.tsx` ("View trace" → `RunTraceDrawer` with findings prop, no extra fetch) |
| AC-10 | `RunTraceDrawer.test.tsx` (running → log tab; done → trace tab) |
| AC-11 | `RunTraceDrawer.test.tsx` (failed run renders without crash) |
| AC-12 | `AgentTab.test.tsx` (Tabs view renders per-agent tabs with summary banner) |
| AC-13 | `AgentTab.test.tsx` (expanded finding fields + four buttons) |
| AC-14 | `AgentTab.test.tsx` (Accept/Dismiss call endpoints + visual update) |
| AC-15 | `groupFindingsByLocation.test.ts` + `DisagreementBlock.test.tsx` |
| AC-16 | `DisagreementBlock.test.tsx` ("Show only conflicts" toggle) |
| AC-17 | `ResultsPage.test.tsx` (failed column renders error; others render results) |
| AC-18 | `RunReviewDropdown.test.tsx` + `ConfigureRunPage.test.tsx` (empty agent list → CTA, disabled button) |
| AC-19 | `ConfigureRunPage.test.tsx` (empty PR list → disabled selector) |
| AC-20 | `server/src/modules/agents/service.ts` + `.it.test.ts` for `GET /agents` estimate computation |
| AC-21 | `server/src/modules/reviews/service.ts` (`resolveTargets`) + `.it.test.ts` for `POST /pulls/:id/review` |
| AC-22 | `client/src/vendor/ui/nav.ts` (`NAV` constant contains entry) |
| AC-23 | `ResultsPage.test.tsx` (done column renders immediately; running column streams SSE) |

**Architecture-reviewer check scope:** the reviewer will verify (a) no `agent_runs` Drizzle query leaks into `AgentsService` directly (must go through `AgentsRepository`), (b) no `process.env` in client code, (c) `RunTraceDrawer` is imported only from `client/src/components/RunTraceDrawer/` and not from the old path, (d) all untrusted text rendered as JSX text nodes (no `dangerouslySetInnerHTML`).
