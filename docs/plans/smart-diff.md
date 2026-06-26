# Development Plan: smart-diff

## Overview
Smart Diff (L03, second half) lays out a PR's changed files by **risk** so the reviewer's
eye lands on business logic first: classify each file into **core / wiring / boilerplate**,
compose with the latest review's findings into the existing `SmartDiff` contract, and render
grouped (core→wiring→boilerplate) with a **Smart order / Original order** toggle, finding
indicators, and click-to-line. **Hard invariant: NO new LLM call** — Smart Diff deterministically
composes `prFiles` + persisted findings already in the DB. Layout works right after import;
finding overlays appear after the first Run Review. No migration; the `SmartDiff` Zod contract
already exists (`server/src/vendor/shared/contracts/brief.ts:81-113`).

## Requirements
| ID | Requirement | Acceptance criteria (measurable) |
|---|---|---|
| R1 | Deterministic path classifier | `classifyPath(path): SmartDiffRole` with precedence **boilerplate > wiring > core**. EVERY lockfile basename (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `npm-shrinkwrap.json`, `Cargo.lock`, `poetry.lock`, `Gemfile.lock`, `composer.lock`, `go.sum`) → `boilerplate`. All patterns/thresholds live in `smart-diff.constants.ts` (no numeric/string literals inline in `smart-diff.ts`). Unit-tested table-driven. |
| R2 | `composeSmartDiff` builds the contract | Pure function: groups ordered core→wiring→boilerplate; each `SmartDiffFile` has `pseudocode_summary: null`, `additions`, `deletions`, and `finding_lines` = sorted+deduped **start-lines** of findings whose `file === path`; files in a group sorted by descending `additions+deletions`. `split_suggestion`: `total_lines = Σ(add+del)`; `too_big = total_lines > SPLIT_TOO_BIG_LINES`; `proposed_splits` = core files grouped by top-level path segment (sorted desc by lines), emitted ONLY when `too_big` AND ≥2 distinct top-dirs, else `[]`. Unit-tested. |
| R3 | `GET /pulls/:id/smart-diff` route | Returns `SmartDiff` (zod response schema). Reads DB only via `getPrFiles(prId)` + the latest `kind==='review'` from `reviewsForPull(prId)` (findings, or `[]`). `getContext` + `IdParams`. NotFound on missing PR. |
| R4 | Token-free (no new model call) | `smartDiffForPull` imports no `container.llm`, no `reviewPullRequest`, and does NOT call `loadDiff` (reads `prFiles` directly). IT test runs with no LLM mock and still returns a SmartDiff; the route never appears as a model/prompt step in a run trace. |
| R5 | Client data hook | `useSmartDiff(prId)` (TanStack) → `GET /pulls/:id/smart-diff`, `queryKey ['smart-diff', prId]`, `enabled: prId!=null`; re-exported from `hooks/index.ts`. No raw `fetch`. |
| R6 | Grouped viewer + toggle (per design) | `SmartDiffViewer`: header "N files · +X −Y" + segmented **Smart order** (default) / **Original order** toggle. Smart = three groups with role label/description/color + "N files" (core="Core logic"/accent, wiring="Wiring"/warn, boilerplate="Boilerplate"/muted). `SplitBanner` shown when `too_big` listing `proposed_splits` (informational; no generate action). Original = flat path-sorted. |
| R7 | Collapse rule | A file card's `defaultOpen = finding_lines.length > 0`. Files without findings (incl. lock-files / boilerplate) are **collapsed by default**; files with findings auto-expand. |
| R8 | Finding indicator → diff line | Each file with findings shows a clickable finding indicator (dot + count). Clicking it **expands the card if collapsed, then scrolls** to the first finding line (`dl:${path}:RIGHT:${finding_lines[0]}`). Requires a per-line `data-line-key`/`id` on `CodeLine` and a controllable-open `FileCard`. |
| R9 | Mount in DiffTab + i18n | `DiffTab` renders `SmartDiffViewer` (Smart default), feeding it `useSmartDiff` + the patches from `usePullDetail`; on query loading/error it falls back to the flat `DiffViewer`. Strings via `useTranslations('smartDiff')` (`messages/en/smartDiff.json`). |
| R10 | `verify:l03` green | `scripts/verify-l03.sh` (shell-only; run `bash scripts/verify-l03.sh`) runs server+client typecheck, reviewer-core build, and the L03 server+client suites (intent + smart-diff); exit 0 when all green. No root/`server`/`client` package.json script changes. |

## Affected modules
- **server `reviews` module**: new `smart-diff.ts` (pure classifier+composer) + `smart-diff.constants.ts`; `service.ts` (+`smartDiffForPull`); `routes.ts` (+route). Reuses `getPrFiles` / `reviewsForPull` (no new repo methods, no migration).
- **shared contracts**: none — consume the existing `SmartDiff`.
- **client `diff-viewer`**: additive props on `FileCard` + a `data-line-key` on `CodeLine`; new `SmartDiffViewer/`; new `useSmartDiff` hook; `DiffTab` mount; `messages/en/smartDiff.json`.
- **tooling**: `scripts/verify-l03.sh`.

## Tasks (disjoint owned paths)
### T1 — Classifier + composer (pure) · backend · R1, R2
- **Owned paths**: `server/src/modules/reviews/smart-diff.ts` (new), `server/src/modules/reviews/smart-diff.constants.ts` (new)
- **Skills**: `typescript-expert`, `onion-architecture` (purity), `zod`.
- **Acceptance**: every `LOCKFILES` entry → boilerplate; precedence boilerplate>wiring>core; `composeSmartDiff` orders groups core→wiring→boilerplate, joins `finding_lines` by `file===path` (start-lines, deduped/sorted), builds `split_suggestion` per R2. No literals in `smart-diff.ts`. `pnpm -C server exec tsc --noEmit` green.
- **Depends-on**: none.

### T2 — Service method · backend · R3, R4
- **Owned paths**: `server/src/modules/reviews/service.ts`
- **Skills**: `onion-architecture`, `fastify-best-practices`, `typescript-expert`.
- **Acceptance**: `smartDiffForPull(workspaceId, prId)` reads `getPull`+`getPrFiles`+`reviewsForPull` (latest `kind==='review'`) only; calls `composeSmartDiff`; NotFound on missing PR; NO `container.llm`/`reviewPullRequest`/`loadDiff`. Typecheck green.
- **Depends-on**: T1.

### T3 — Route · backend · R3
- **Owned paths**: `server/src/modules/reviews/routes.ts`
- **Skills**: `fastify-best-practices`, `zod`, `onion-architecture`, `security`.
- **Acceptance**: `GET /pulls/:id/smart-diff` with `{ schema: { params: IdParams, response: { 200: SmartDiff } } }`; handler getContext→service→return; no Drizzle/Octokit in route. Typecheck green.
- **Depends-on**: T2.

### T4 — diff-viewer primitives (data-line-key + controllable FileCard) · ui · R8 (DOM half)
- **Owned paths**: `client/src/components/diff-viewer/CodeLine/CodeLine.tsx`, `client/src/components/diff-viewer/FileCard/FileCard.tsx`
- **Skills**: `react-best-practices`, `frontend-architecture`, `typescript-expert`.
- **Acceptance**: each rendered `CodeLine` carries a stable file-namespaced `data-line-key`/`id` (`dl:${path}:RIGHT:${n}` via `keysForLine`); `FileCard` accepts optional `open`/`onToggle`/`defaultOpen` + a header `badge` slot and is behavior-identical when those are absent (DiffViewer/DiffTab unaffected). Client typecheck + existing diff-viewer tests green.
- **Depends-on**: none.

### T5 — Hook + SmartDiffViewer + mount + i18n · ui · R5, R6, R7, R8 (handler), R9
- **Owned paths**: `client/src/lib/hooks/smart-diff.ts` (new), `client/src/lib/hooks/index.ts`, `client/src/components/diff-viewer/SmartDiffViewer/` (new: `SmartDiffViewer.tsx`, `index.ts`, `styles.ts`), `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`, `client/messages/en/smartDiff.json` (new)
- **Skills**: `frontend-architecture`, `react-best-practices`, `next-best-practices`, `zod`.
- **Acceptance**: `useSmartDiff` fetches the route; SmartDiffViewer renders the Smart/Original toggle (Smart default), three ordered groups with role headers, `SplitBanner` when too_big; file cards `defaultOpen=finding_lines.length>0`; clicking a finding indicator expands a collapsed file then scrolls to the line. DiffTab mounts it with flat-DiffViewer fallback on load/error. Data ONLY via the hook. `pnpm -C client exec tsc --noEmit` + lint green.
- **Depends-on**: T4 (consumes the new FileCard props + data-line-key). May scaffold against the contract before T3 lands.

### T6 — Server tests · backend · R1, R2, R3, R4
- **Owned paths**: `server/src/modules/reviews/smart-diff.test.ts` (new, hermetic), `server/src/modules/reviews/smart-diff.it.test.ts` (new, testcontainers)
- **Skills**: `typescript-expert`, `zod`, `drizzle-orm-patterns`, `onion-architecture`.
- **Acceptance**: unit asserts lockfile-always-boilerplate, precedence, group order, finding-line join, split threshold; IT seeds repo+PR+prFiles+`review`-kind row+findings (reuse `seedRepoAndPr` from `intent.it.test.ts`) and asserts `smartDiffForPull` output + that a `review`-kind review wins over a `summary` one + runs with NO LLM mock. `pnpm -C server exec vitest run …smart-diff.test.ts …smart-diff.it.test.ts` green.
- **Depends-on**: T1, T2.

### T7 — Client RTL · ui · R6, R7, R8
- **Owned paths**: `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.test.tsx` (new)
- **Skills**: `react-testing-library`, `react-best-practices`.
- **Acceptance**: cases — empty; grouped order (3 headers core→wiring→boilerplate); boilerplate/lockfile file collapsed by default (no findings) while a finding file is expanded; clicking the finding indicator expands a collapsed file and calls `scrollIntoView` on the right node (mock `Element.prototype.scrollIntoView`). Test only adds the file. `pnpm -C client exec vitest run src/components/diff-viewer/SmartDiffViewer` green.
- **Depends-on**: T5.

### T8 — verify:l03 script · tooling · R10
- **Owned paths**: `scripts/verify-l03.sh` (new)
- **Skills**: `typescript-expert`.
- **Acceptance**: `bash scripts/verify-l03.sh` runs server tsc, client tsc, reviewer-core build, and the L03 server (intent + smart-diff) + client (IntentCard + SmartDiffViewer) suites; exits 0 when all green; non-zero on any failure (`set -euo pipefail`). Touches no package.json.
- **Depends-on**: T6, T7.

## Sequencing (waves)
- **W1**: T1 ∥ T4
- **W2**: T2 ∥ T5
- **W3**: T3 ∥ T6 ∥ T7
- **W4**: T8

## Verification
- `bash scripts/verify-l03.sh` → green.
- App: open a large PR with a lock-file → Smart order default, core group on top, lock-file collapsed in boilerplate; Run Review → finding files expand + indicator; click indicator → scroll to line; toggle Original order → flat list; run trace shows no new LLM step for Smart Diff.
- Ship: self-review (pr-self-review) → PR to `yamchinsky/dev-digest`.
