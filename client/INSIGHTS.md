# INSIGHTS — `client/`

Durable, surprising lessons that bite this module — things that *looked
obvious and weren't*. Append-only. New entries are added by the
`engineering-insights` skill. Read this file before solving a non-obvious
bug or making a "looks obvious" decision in `client/`.

## What Works
_None yet._

## What Doesn't Work

### `SkillEditor.tsx` is only mounted at `/skills/new` (create) — the edit surface is `SkillsLab` → `SkillDetail` tabs
_2026-07-02_ · `src/app/skills/new/page.tsx`, `src/app/skills/_components/SkillsLab/SkillsLab.tsx`

Despite its name, `SkillEditor` is not where existing skills get edited — `/skills/[id]` renders `SkillsLab`, whose `DetailPane` tabs (`SkillDetail/ConfigTab` etc.) are the real edit surface. Anything added to `SkillEditor` behind an `isEdit` gate is dead code. This shipped an unreachable SPEC-01 feature; full post-mortem in the root `INSIGHTS.md` ("plan-verifier passes UI code that is never mounted").

### Smart Diff shows no severity badges when the PR has no findings — not a render bug
_2026-06-28_ · `GET /pulls/:id/smart-diff`, `src/components/diff-viewer/CodeLine/CodeLine.tsx`

In-diff severity pills only render for findings, and findings only exist after a review run. A freshly-opened PR (or one where no agent has been run) returns `smart-diff` with every file's `findings: []`, so the diff renders with zero badges — which looks identical to "the badge code is broken." When verifying badge/finding UI, FIRST check the data: `curl :3001/pulls/<prId>/smart-diff | jq` and confirm non-empty `findings`, or pick a PR that already has review runs (in the seeded DB, e.g. PR #10 had 8, PR #16 had 0). Don't debug the renderer until you've confirmed findings exist.

### pnpm 11 crashes in `runDepsStatusCheck` until `allowBuilds` placeholders are filled in `pnpm-workspace.yaml`
_2026-06-19_ · `client/pnpm-workspace.yaml`, `server/pnpm-workspace.yaml`

pnpm **11.x** moved build-script approval (native deps like `esbuild`, `sharp`, `ssh2`) into a per-package `pnpm-workspace.yaml` with an `allowBuilds:` map — it writes this file even with no real workspace, seeded with placeholder values `set this to true or false`. While placeholders remain, every `pnpm` invocation aborts inside `runDepsStatusCheck` (corepack `pnpm.mjs`). Fix = **edit the file, replace each placeholder with `true`/`false`** (we use `true` for `esbuild`/`sharp` in `client/` — they need their postinstall build); then `pnpm install` runs clean. `server/pnpm-workspace.yaml` is committed and legitimate, so this is expected per-package config, NOT a stray artifact.

> Updated 2026-06-19: this entry originally (mis)diagnosed the file as a stray artifact to delete. **That was wrong** — deleting it is futile (pnpm 11 regenerates it on the next run) and `server/`'s copy is committed. The real fix is filling in `allowBuilds`, above. Also note: corepack injects a `"packageManager": "pnpm@<ver>+sha512…"` line into `package.json` on run; that one IS unwanted here — revert just that line.

### A NAV entry's `key` needs an exact-match `shell.nav.<key>` in `shell.json` or the `nav-i18n.test.ts` guard fails
_2026-07-09_ · `client/src/vendor/ui/nav.ts`, `client/messages/en/shell.json`

Adding a sidebar NAV item requires a `shell.nav.<key>` string in `messages/en/shell.json` whose key is byte-identical to the item's `key` in `nav.ts` — hyphens included (`multi-agent-review`, not a shortened alias). The `nav-i18n.test.ts` guard enforces this and fails with no hint that i18n is the cause when the key is missing or aliased. When adding a nav entry, add the matching `shell.nav.<key>` in the same change.

## Codebase Patterns

### Chip `color` prop styles only the leading icon — chip border/background come from `active`
_2026-06-19_ · `src/vendor/ui/primitives/Chip.tsx:35-40`

The `color` prop on `Chip` is applied via `<I size={13} style={color ? { color } : undefined}/>` — only to the icon. The chip's own border/background swap between `var(--accent)` and `var(--border)` based on `active`/`hover`, regardless of `color`. Severity-tinted chips (e.g. CRITICAL red icon) therefore keep the global accent visual language; don't reach for a "tint the whole chip" variant — that breaks the toolbar's accent uniformity. Matches the standalone design's `findings.jsx → FindingsPanel` 1-to-1.

### `<SeverityBadge compact />` is icon-ONLY — it drops the text label
_2026-06-28_ · `src/vendor/ui/primitives/Badge.tsx:80`, `src/components/diff-viewer/CodeLine/CodeLine.tsx`

`SeverityBadge` renders `{compact ? null : s.label}` — so `compact` shows just the severity icon, no word. Reaching for it to make an in-diff finding badge produced a badge so small it read as "no badge at all" against the code (the in-diff design wants a visible `icon + lowercase label` pill: blocker / warning / suggestion). When you need a labelled severity pill in a tight row, don't pass `compact`; build a small pill from the `SEV[severity]` tokens (`.c`, `.bg`, `.icon`) and your own label map — note the design uses **"blocker"** for `CRITICAL`, not `SEV.CRITICAL.label` ("Critical").

### i18n namespaces are auto-discovered from `messages/<locale>/*.json` — there is no registry
_2026-07-02_ · `client/src/i18n/request.ts` (`loadMessages`)

`loadMessages()` scans the locale directory at request time and uses each filename (minus `.json`) as the namespace key. Adding a new namespace (`contextDocs.json`) requires ZERO code changes — no import, no provider edit, no layout change. Non-obvious because `NextIntlClientProvider` receives one merged object and nothing in the code lists the namespaces explicitly. Corollary: a filename typo silently creates a differently-named namespace.

### `vendor/shared` barrels use `.js` import suffixes — a scoped exception to the client's extensionless rule
_2026-07-02_ · `client/src/vendor/shared/index.ts`

The client convention is extensionless internal imports, but the dual-vendored `vendor/shared` barrels deliberately use `export * from './contracts/x.js'` so the files stay byte-identical with the server copy (which requires `.js` under ESM). Next.js resolves this fine. When adding a contract, keep the `.js` suffix inside `vendor/shared` and stay extensionless everywhere else.

### Prompt-format literals in UI must NOT be i18n-wrapped
_2026-07-02_ · `client/src/app/skills/_components/SkillEditor/SkillEditor.tsx` (SERIALIZES AS block)

Strings that mirror what the LLM actually receives (e.g. the `## Project context` heading in the skill editor's SERIALIZES AS preview) are prompt-format constants, not UI copy — wrapping them in `t()` would let locales corrupt the depicted prompt slot. Only the surrounding labels ("SERIALIZES AS", captions) are translatable. When previewing prompt fragments in UI, keep the fragment verbatim and translate around it.

### The vendored icon registry is a curated subset of lucide — grep `icons.tsx` before naming an icon
_2026-07-05_ · `src/vendor/ui/icons.tsx` (~82 exported names)

Icon names in `Button icon="…"` / `TABS` entries resolve against the vendored registry, NOT the full lucide catalogue: `PlusCircle` and `BarChart2` don't exist (`Plus` and `BarChart` do), and a wrong name fails at runtime, not typecheck-time in all call sites. Bit two SPEC-04 tasks independently. Before referencing any icon, grep `icons.tsx` for the exact export; extend the registry if the icon is genuinely missing.

### Workspace-wide PR list = `useRepos()` + `useQueries()` — there is no `useAllPulls()` hook
_2026-07-09_ · `client/src/app/multi-agent-review/_components/ConfigureRunPage/ConfigureRunPage.tsx`

The PR hooks fetch per-repo; there is no single hook that returns every PR across the workspace. Assemble it with `useRepos()` then a parallel `useQueries()` fan-out (imported directly from `@tanstack/react-query`, not `lib/hooks/`) — one query per repo, results flattened. Precedent already in `lib/hooks/evals.ts` and the Project Context `ContextTab.tsx`. Don't write a new `useAllPulls`; reuse this fan-out shape.

## Tool & Library Notes

### Swapped inline-style variants must not mix a `border` shorthand with a `borderBottom` longhand
_2026-07-03_ · `src/app/repos/[repoId]/onboarding-tour/_components/OnboardingTour/OnboardingTour.tsx` (`cardHeaderOpen/Closed`)

React warns "Removing a style property during rerender (borderBottom) when a conflicting property is set (border)" — and can mis-style — when a component toggles between two style objects where the base uses the `border` shorthand and only ONE variant adds a `borderBottom` longhand: the rerender REMOVES the longhand next to the shorthand. Nothing static catches this (tsc/vitest/review all passed); it surfaced only at runtime in dev. Rule for any open/closed–style variant pair: use longhands only (`borderTop/Right/Left: "none"`), and keep the SAME property present in both variants (e.g. `borderBottom: "1px solid transparent"` when closed) so no property disappears across rerenders.
_2026-07-02_ · `src/app/repos/[repoId]/onboarding-tour/_components/OnboardingTour/OnboardingTour.tsx` (`INCOMPLETE_STATUSES`)

TypeScript types a const tuple's `.includes()` parameter as the tuple's own literal union, so checking a value typed as a WIDER union (e.g. `"full" | "partial" | "degraded" | "failed"` against `["partial","degraded","failed"] as const`) is a compile error, not a runtime question. `new Set(["partial","degraded","failed"]).has(x)` compiles and reads the same. Recurs in any "badge visible for a subset of enum values" UI pattern driven by shared-contract enums.

### A `<button>` whose only child is an icon-only `SeverityBadge` is invisible to `getByRole("button", { name })`
_2026-06-28_ · `src/components/diff-viewer/CodeLine/CodeLine.tsx` (in-line finding badges), `SmartDiffViewer.test.tsx`

When a clickable wrapper `<button aria-label="…">` contains only `<SeverityBadge compact />` (which renders an SVG icon and `null` label, no text node), RTL computes the button's accessible name from its children and ends up empty — so `screen.getByRole("button", { name: "view warning finding" })` throws "Unable to find" even though the `aria-label` is present in the DOM. The `<I>` icons in `vendor/ui/primitives/Badge.tsx` carry no `aria-hidden`, so they don't contribute a name but the children-based name calc still wins over the wrapper's `aria-label`. Fix in tests: query these icon-only buttons with `screen.getByLabelText("View warning finding")` instead of `getByRole(..., { name })`.

> Updated 2026-06-28: the in-diff badge no longer uses `compact` — it renders a visible lowercase label ("blocker"/"warning"/"suggestion") next to the icon to match the design, so `getByRole("button", { name })` works again for it. The accessible-name-from-children quirk still applies to any *icon-only* button you build, so the lesson stands; it just no longer bites this specific badge.

### TanStack Query v5 has no per-query `onSuccess` — status-transition side effects need a `useEffect` watching `query.data`
_2026-07-05_ · `src/lib/hooks/evals.ts` (`useEvalBatch`)

Reacting to a polled query's status flip (eval batch `running` → `done` must invalidate the history list) can't hook `onSuccess` — v5 removed it from `useQuery`. The sanctioned shape is a `useEffect` watching `query.data?.batch.status` that fires the invalidation once on transition. This is a legitimate external-side-effect `useEffect`, easy to misread as the "derived state in effects" anti-pattern — don't reflexively remove it in review.

### `FormField` renders label and input unlinked — RTL `getByLabelText` can't find its children
_2026-07-05_ · `src/vendor/ui/kit/FormField.tsx`

`FormField` renders `<label>` without `htmlFor` and doesn't inject an `id` into the child input, so the accessible label↔control association never forms and `getByLabelText("Start line")` throws for FormField-wrapped inputs. Workarounds: put `aria-label` directly on the input, or query via `getByRole` with `name`. A global fix is extending FormField to accept/propagate `htmlFor`+`id` — until then, don't write `getByLabelText` against these fields.

### Recharts `ResponsiveContainer` logs width(0)/height(0) to stderr in every jsdom chart test — cosmetic
_2026-07-05_ · `EvalsTab.test.tsx` and any test rendering a `charts/` component

jsdom has no layout engine, so `ResponsiveContainer` measures 0×0 and warns on every render; assertions still pass and the stubbed `ResizeObserver` in `src/test/setup.ts` doesn't silence it. Treat the warning as noise, not a broken test. The only real silencer is mocking `recharts` in test setup — do that only if the noise starts hiding real failures.

### Client tsconfig has `noUncheckedIndexedAccess` — array/record index access is `T | undefined`
_2026-07-09_ · `client/tsconfig.json`, bit `src/app/multi-agent-review/results/_lib/groupFindingsByLocation.ts`

`noUncheckedIndexedAccess: true` makes every `arr[i]` / `record[key]` yield `T | undefined` even inside a `for` loop or right after a `.length` check. Component code must narrow explicitly (`const g = groups[0]; if (!g) return`), and tests must add `!` after a `toHaveLength(n)` guard (`expect(groups).toHaveLength(1); groups[0]!.cells`). It reads like a spurious type error in correct code — it's the config, not the logic. Bit T3 repeatedly.

### `vi.doMock` after a static `import` of the module under test is a silent no-op
_2026-07-09_ · `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.test.tsx`

Calling `vi.doMock("@/lib/hooks/agents", …)` inside an `it()` after the component was already statically imported does nothing — the binding is fixed at import time, so the test silently runs against the module-level `vi.mock` and asserts the wrong branch (an "empty agents" test actually ran with two agents and still passed). The coverage gate flagged it as passing-but-ineffective. Use a module-level `vi.mock` factory delegating to a `vi.fn()` and switch behaviour per-test with `mockReturnValue`.

### next-intl `t()` rejects a computed/template key — it types the argument off a literal union of message paths
_2026-07-09_ · `client/src/app/ci-runs/_components/CiRunsPage`

`useTranslations()`'s `t()` types its argument as the literal union of keys in the namespace JSON, so a dynamic key like `t(`runs.status.${status}`)` fails `tsc` (and would defeat tree-shaking anyway). Map the dynamic value to a literal key explicitly — a small `switch`/lookup that calls `t('runs.status.passed')`, `t('runs.status.failed')`, … per branch. Applies to any status/enum you render through i18n.

## Recurring Errors & Fixes

### A body-less `api.post()` against a route with `body: z.object({})` 422s — bit twice (#31, CI Runs Refresh)
_2026-07-10_ · `src/lib/hooks/ci.ts` `useSyncCiRuns` vs `server/src/modules/ci/routes.ts` `POST /ci-runs/sync`

`api.post(path)` without a body intentionally sends no JSON body and no content-type (the helper comment even lists "refresh" as a body-less example) — that is fine ONLY for routes with no body schema. A route that declares `body: z.object({})` receives `null` and 422s ("Expected object, received null"), which surfaces as a mutation error toast ("Request validation failed") with no console error. Bit `useCreateEvalCaseFromFinding` (#31) and now `useSyncCiRuns` (CI Runs Refresh button). Rule: if the server route declares ANY body schema — even the empty object — the hook must pass `{}` explicitly. When adding a POST hook, check the route's `body:` schema first.

### Adding a required field to a shared Zod contract rots inline test fixtures in both packages
_2026-06-18_ · see repo-root `INSIGHTS.md` → Recurring Errors & Fixes (cross-module; concrete client bite was `RunTraceDrawer.test.tsx:10`)

### The diff tab has TWO renderers — a per-file affordance added to only one silently no-ops on the other
_2026-07-03_ · `pulls/[number]/_components/DiffTab/DiffTab.tsx` (branch at `smartDiff ? <SmartDiffViewer> : <DiffViewer>`)

`DiffTab` renders `SmartDiffViewer` (the PRIMARY path — grouped smart order + flat original order inside it) and falls back to the flat `DiffViewer` only while smart-diff loads or errors. Any per-file affordance (stable scroll ids, `defaultOpen` targets, badges, summaries) must be implemented in BOTH components — and in BOTH order modes of SmartDiffViewer. Bit us in SPEC-03: the deep-link `?tab=diff&file=` scroll wrappers were first added to `DiffViewer` only, so clicks from PrBriefCard no-op'd on the primary path (`getElementById` → null, optional chaining swallowed it — no error, no warning). Same fails-open family as the tab/nav two-registry entries below.

### Editor tabs have TWO registries — the render list AND a page-level `VALID_TABS` URL whitelist; missing the second makes the tab a silent no-op
_2026-07-02_ · `src/app/agents/[id]/page.tsx:15` vs `_components/AgentEditor/constants.ts`, same pattern in `skills/_components/SkillsLab/SkillsLab.tsx:44`

Tab state lives in `?tab=`, and the page validates the param against its own `VALID_TABS` array before passing it down — separate from the `TABS`/`TAB_DEFS` list that renders the tab bar. Adding a tab only to the render list produces a tab that LOOKS clickable but snaps back to `config`: the click writes `?tab=context` to the URL, the whitelist rejects it, and the fallback renders. No error, no console warning — bit us twice in SPEC-01 (agent Context tab shipped this way; the skills Context tab would have too if both spots in `SkillsLab.tsx` weren't updated together). When adding an editor tab, grep for `VALID_TABS` next to the page that owns the `?tab=` param.

### A test that renders a component without `QueryClientProvider` breaks when ANY new hook is imported into that component
_2026-07-05_ · `FindingsPanel.test.tsx` (`vi.mock("@/lib/hooks/evals", …)` beside the existing reviews mock)

`FindingsPanel.test.tsx` wraps only `NextIntlClientProvider`, so every TanStack hook the component uses must be `vi.mock`ed or the render throws "No QueryClient set". Consequence: wiring one more hook into the panel (eval-case creation in SPEC-04) requires a matching mock in a test file the feature task doesn't own — an invisible cross-file dependency. When adding a hook to a widely-tested component, grep its test for the mock list; longer-term fix is a shared render helper with a real test QueryClient.

### The `VALID_TABS` two-registry trap bit a THIRD time (SPEC-06 CI tab) — whitelist is now derived from `TABS`
_2026-07-10_ · `src/app/agents/[id]/page.tsx` (see the 2026-07-02 entry above for the mechanism)

The Export-to-CI worktree shipped `CiTab` + `ExportWizard` fully tested, but never added `"ci"` to the page's `VALID_TABS` — so `?tab=ci` silently fell back to Config and the ENTIRE feature was unreachable in the running app (no wizard → no `ci_installations` row → CI Runs permanently empty; the downstream symptom looked like an ingest bug, not a nav bug). Component tests can't catch this: they mount `CiTab` directly, bypassing the page whitelist. Durable fix applied: `VALID_TABS = TABS.map(t => t.key)` derived from the editor's tab registry — one registry, drift impossible. If another page grows a `?tab=` whitelist, derive it the same way instead of copying the array.

### A UI filter token leaking into a Zod-validated query param = silent 422 = permanent empty state; hook-mocking tests cement the wrong wire format
_2026-07-10_ · `src/app/ci-runs/_components/CiRunsPage` vs `server/src/modules/ci/routes.ts` `CiRunsQuery.since`

`CiRunsPage` sent its UI window token (`since=7d`) straight to `GET /ci-runs`, whose schema is `z.string().datetime({ offset: true })` → 422 on every load. Two policies make this invisible: query-side 4xx errors don't toast (by design), and the page only branches on `isLoading`/empty — so a failing query renders as a plausible "no runs yet" empty state forever. The component test asserted `filters.since === "7d"` against a mocked hooks layer, so it *protected the bug*: jsdom tests that mock `@/lib/hooks/*` verify UI→hook wiring only, never the wire format — cross-check any new query param against the route's Zod schema by hand (or hit the live route once). Convert UI tokens to contract values at the page/hook boundary (`useMemo` → ISO string). Curl-repro gotcha: an unencoded `+00:00` offset in a query string decodes as a space and 422s even when the value is valid — test with the `Z` suffix or `--data-urlencode`.

### Phantom `POST /graphql 404` spam in the Next dev console comes from the Apollo Client Devtools extension
_2026-07-10_ · Next dev console (port 3000); no graphql anywhere in the repo

Bursts of `POST /graphql 404` right after a page load look like an app bug but are the Apollo Client Devtools Chrome extension probing every page for a GraphQL endpoint. Diagnosis path that settles it: `grep -ri graphql` over the repo (zero hits in code), `lsof -nP -i :3000` (only Chrome connections), and the burst-on-tab-reload timing. Verify by opening the studio in incognito (extensions off) — the spam disappears. Harmless noise; disable the extension for localhost if it bothers.

## Session Notes
_None yet._

## Open Questions
_None yet._
