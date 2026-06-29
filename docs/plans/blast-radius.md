# Development Plan: blast-radius

## Context (why)

Every reviewer's first question is "what could these changes break?" — invisible from the
diff alone. **Blast Radius** answers it: for a PR it maps **changed symbols → who calls them
downstream → which HTTP endpoints/crons are affected**. It is **deterministic and token-free** —
it READS the pre-built **repo-intel** index (built at clone time), never re-parses and never
calls an LLM. It also turns the existing `get_blast_radius` MCP **stub** into a real tool.

**~70% already exists** (confirmed by exploration) — this plan is mostly *wiring + shaping +
one Overview card*, not new analysis:
- `container.repoIntel.getBlastRadius(repoId, changedFiles)` (`server/src/modules/repo-intel/service.ts:220`) already returns `{ changedSymbols, callers (cross-file, ranked DESC, **capped 20/symbol**), impactedEndpoints, factsByFile (endpoints+crons per file), degraded, reason }`.
- `container.repoIntel.getIndexState(repoId)` (`service.ts:189`) → `status ∈ full|partial|degraded|failed` → the partial/degraded badge.
- `BlastRadius` Zod contract already defined (`server/src/vendor/shared/contracts/brief.ts:40` + client copy): `{ changed_symbols[], downstream[{symbol, callers[{name,file,line}], endpoints_affected[], crons_affected[]}], summary }`.
- Changed files: `getPrFiles(prId)` from the `prFiles` table (`server/src/modules/reviews/repository/pull.repo.ts:29`).
- Token-free GET precedent: `GET /pulls/:id/smart-diff` (`reviews/routes.ts:171`) — plain read, **no run-logger / no run_traces row**.
- Client: `useSmartDiff` hook shape (`client/src/lib/hooks/smart-diff.ts`), `githubBlobUrl()` (`client/src/utils/github-urls.ts`) for click-caller→code, `EmptyState`/`Badge`, **`messages/en/blast.json` already has `stat.symbols/callers/endpoints/crons` + `view.tree/view.graph`**.
- MCP stub: `mcp/src/tools/get-blast-radius.ts` + `mcp/src/schemas.ts`.

## Decisions (from the user)
1. **Placement: a card in the Overview tab** (right column, per the design screenshot) — NOT a separate tab.
2. **Views: Tree + Graph** both, with the toggle.
3. **Summary: deterministic string, ZERO LLM** — the whole feature stays token-free.
4. **"Prior PRs touching these files": include** (bonus) — query other PRs whose `prFiles` overlap the changed files.
5. *(default, not asked)* **Endpoint mapping = file-scope** (endpoints of the caller files, which `getBlastRadius` already provides — satisfies the "≥1 endpoint" criterion). A full depth-2 import-graph traversal to routes (`file_edges`) is noted as a later enhancement.

## Architecture (onion)
New server module `blast/` is an **application/use-case** layer that reads other modules' data
**only via the Container facade** (`container.repoIntel.*`) and its own repository for `prFiles`/
`pull_requests`/prior-PR lookups — it never imports another module's service. The endpoint is a
**plain token-free GET** (no RunLogger, no run row). The MCP tool is an outbound API client of it.

## Requirements
| ID | Requirement | Acceptance |
|---|---|---|
| R1 | New `blast/` module + `GET /pulls/:id/blast` (token-free, no LLM, no run row) | route returns 200 `BlastRadius`; no `run_traces` row; logs show only index reads |
| R2 | Service: `getPrFiles` → `repoIntel.getBlastRadius` + `getIndexState` → pure transform → contract | callers grouped per changed symbol; endpoints_affected/crons_affected filled from `factsByFile`; callers capped 20, ranked |
| R3 | Contract extension (both vendored copies, in sync) | add `status` (index state enum) + optional `degraded_reason` + `prior_prs[]` to `BlastRadius`; new fields optional/`.default([])` (backward-compatible) |
| R4 | Partial/degraded handled honestly | `status≠full` → response carries status + reason; UI shows a **badge with explanation, never an empty screen** |
| R5 | Empty state when no data | index missing / no changed files / `REPO_INTEL_ENABLED=false` → graceful empty card (and MCP `isError:false` empty) |
| R6 | MCP `get_blast_radius` becomes real | stub → resolve `repo`+`prNumber` → `GET /pulls/:id/blast` → returns real `BlastRadius` (structuredContent + text, untrusted text wrapped); output schema updated |
| R7 | Overview **BlastRadiusCard** | header counts (symbols/callers/endpoints/crons); per symbol → callers `file:line` (clickable) → endpoint/cron badges; partial/degraded badge; empty state; Prior-PRs section |
| R8 | Tree **and** Graph views | `view.tree`/`view.graph` toggle; Tree = nested list (per design), Graph = node-link (symbols→callers→endpoints) |
| R9 | Click caller `file:line` opens code at that line | caller renders a `githubBlobUrl(...#Lnn)` link (same util as `FindingCard`) |
| R10 | Zero LLM calls | no model invocation anywhere in the path; summary is computed |
| R11 | Both markdown docs exist | `docs/plans/blast-radius.md` + `docs/blast-radius.md` (explanation + Mermaid) |
| R12 | Demo works | on an **indexed** repo, a shared-helper PR shows **≥2 callers & ≥1 endpoint**; response is fast |

## Tasks (file-disjoint; DAG)

### T1 — Contract extension · R3 · skills: zod, onion-architecture
- **Paths**: `server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts` (keep the two copies identical).
- Extend `BlastRadius`: add `status: z.enum(['full','partial','degraded','failed'])`, `degraded_reason: z.string().nullable().default(null)`, `prior_prs: z.array(z.object({ number: z.number().int(), title: z.string(), pull_id: z.string() })).default([])`. Keep additive/defaulted so existing consumers don't break.
- **Accept**: both copies compile; `z.infer` matches; `server tsc` + `client tsc` clean.

### T2 — Server `blast/` module + route · R1,R2,R4,R5,R12 · skills: onion-architecture, fastify-best-practices, drizzle-orm-patterns, zod · depends: T1
- **Paths**: `server/src/modules/blast/{routes,service,repository,compose}.ts`, `server/src/modules/index.ts`.
- `routes.ts`: `GET /pulls/:id/blast` (`IdParams`, response schema = `BlastRadius`), handler = `getContext → service.blastForPull(workspaceId, prId) → return`. No RunLogger.
- `repository.ts`: read the pull row (→ `repoId`, repo-relative changed-file paths) + `prFiles` (reuse the `getPrFiles` query shape) + the **prior-PRs** query (other pulls in the repo whose `prFiles` intersect the changed paths, newest first, small limit).
- `service.ts`: resolve `repoId` → `container.repoIntel.getBlastRadius(repoId, changedFiles)` + `getIndexState(repoId)` → pass to `compose.ts`.
- `compose.ts` (pure): map `BlastResult` → `BlastRadius` — group `callers` by their changed symbol, attach `endpoints_affected`/`crons_affected` from `factsByFile` of each caller's file, set `status`/`degraded_reason`, build the **deterministic `summary`** (e.g. `"2 symbols · 14 callers · 3 endpoints (index: full)"`), attach `prior_prs`. Empty/degraded → valid contract with empty arrays + status.
- **Accept**: `GET /pulls/:id/blast` returns the contract on an indexed PR; degraded/empty return 200 with status (not error); no run row created.

### T3 — MCP tool (stub → real) · R6 · skills: zod, security, typescript-expert · depends: T1, T2
- **Paths**: `mcp/src/tools/get-blast-radius.ts`, `mcp/src/schemas.ts` (`getBlastRadiusOutputShape`), `mcp/src/api/client.ts` (add `getBlast(pullId)`), `mcp/src/types.ts`.
- Handler: `resolvePullId(repo, prNumber)` → `getBlast(pullId)` → return `structuredContent` (the `BlastRadius`) + mirrored text summary; wrap untrusted file/symbol/title text via `wrapUntrusted`; empty index → `isError:false` graceful message. Update output schema from `{implemented,message}` to the real shape.
- **Accept**: `mcp` typecheck 0; via stdio client, `get_blast_radius` returns a real map (counts + symbols), not the stub.

### T4 — Client data hook + Overview card (Tree) · R7,R9 · skills: frontend-architecture, react-best-practices, next-best-practices · depends: T1 (types)
- **Paths**: `client/src/lib/hooks/blast.ts` (+ `lib/hooks/index.ts`), `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.tsx` (+ subparts), integrate into `OverviewTab.tsx` (right column), `messages/en/blast.json` (add any missing keys).
- `useBlast(prId)` mirrors `useSmartDiff` (queryKey `["blast", prId]`, `GET /pulls/:id/blast`).
- Card (Tree): header counts (`stat.*`); per changed symbol → caller rows `file:line` as `githubBlobUrl` links (reuse `client/src/utils/github-urls.ts` + `MonoLink`) → endpoint/cron `Badge`s; **partial/degraded `Badge` with reason**; `EmptyState` when no data; **Prior-PRs** collapsible.
- **Accept**: card renders in Overview; clicking a caller opens the GitHub blob at the line; partial/empty states render (no blank screen); `client tsc` clean.

### T5 — Graph view + toggle · R8 · skills: react-best-practices, frontend-architecture · depends: T4
- **Paths**: `BlastRadiusCard/` (add `GraphView` + the `view.tree`/`view.graph` toggle).
- Node-link layout symbols → callers → endpoints (reuse a vendored `charts/` primitive if one fits, else a lightweight SVG); nodes clickable to the same `githubBlobUrl`.
- **Accept**: toggle switches Tree/Graph; Graph shows the same data; clicks navigate to code.

### T6 — Tests · all · skills: test-writer, react-testing-library · depends: T2,T3,T4,T5
- Server (`blast/*.test.ts` + a route smoke): `compose` mapping (callers grouped/ranked/capped 20, endpoints+crons per symbol, deterministic summary, degraded/empty), prior-PRs query. Client: `BlastRadiusCard` render, caller→href, Tree/Graph toggle, partial/empty. MCP: handler happy + empty/degraded.
- **Accept**: `server` + `client` + `mcp` suites green; typecheck clean.

### T7 — Docs (both markdown) · R11 · skills: doc-writer, mermaid-diagram · depends: none (parallel)
- `docs/plans/blast-radius.md` (this plan) + `docs/blast-radius.md` (Diátaxis *explanation*: the repo-intel read pipeline + a **Mermaid** diagram changedFiles → symbols → callers(rank≤20) → endpoints; the token-free/zero-LLM property; partial/degraded handling).
- **Accept**: both files exist; links resolve; diagram renders.

**DAG**: `T1 → {T2, T4}` · `T2 → T3` · `T4 → T5` · `{T2,T3,T4,T5} → T6` · `T7` parallel.

## Migrations
**None** — reads existing repo-intel tables (`symbols`, `references`, `file_edges`, `file_facts`, `file_rank`, `repo_index_state`) and `prFiles`/`pull_requests`. The contract extension is code-only.

## Verification (end-to-end)
- **Token-free**: hit `GET /pulls/:id/blast`; confirm NO `run_traces` row and logs show only index reads (no parse/LLM events) — mirror the smart-diff read.
- **Demo (acceptance R12)**: needs an **indexed** repo. The design uses `acme/payments-api #482` (`rateLimit()`/`bucketKey()`); **first confirm repo-intel indexed that repo** (`repo_index_state.status`). If it is not indexed, either trigger `POST /repos/:id/resync` or use a `yamchinsky/dev-digest` PR that changes a shared helper. Expect **≥2 callers & ≥1 endpoint**, and a partial/degraded badge when the index is incomplete.
- **Click-to-code**: click a caller `file:line` → opens the file at that line (`githubBlobUrl`).
- **MCP**: via the stdio client, `get_blast_radius {repo, prNumber}` returns the real map (counts + symbols), not the stub.
- **Zero LLM**: grep the path for any `container.llm`/model call — there must be none.
- **Suites + typecheck** green; **both docs exist**.

## Out of scope (stretch, not in this plan)
Pre-push CLI `devdigest review --mode working` (review the working copy before push, catch a planted secret, 5-process matrix, cheap-model map summary) — separate follow-up.
