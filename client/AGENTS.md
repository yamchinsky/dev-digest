# AGENTS.md — `client/` conventions

Module-scoped rules for `@devdigest/web`. **The UI route map, the
`src/lib/hooks/*` → `src/services/api.ts` layout, and the `g`-then-key shortcut
chrome live in `README.md`** — this file holds the "how we write UI here"
conventions.

**Read `README.md`** before reasoning about page structure, the API surface a
page leans on, or which hook namespace owns which contract.

**Read `docs/`** for deep dives that don't fit in `README.md` (page-level
state machines, shortcut chart, design tokens, theme cookbook). Empty until
topics get written.

**Read `specs/`** when you touch a UI-consumed DTO, an i18n namespace, or a
test fixture (agents/findings/runs).

**Read `INSIGHTS.md`** before solving a non-obvious bug — durable, surprising
lessons that bit this module.

**Read `../TESTING.md`** before adding **any** test in this package.

**Read `../AGENTS.md`** for repo-wide globals (no workspace, mixed
pnpm/npm, …) that apply here too.

**Read `src/providers/index.tsx`** before touching the QueryClient defaults, the
global error/toast policy, or the theme/repo context wiring — those are
shared by every page.

**Read `src/lib/hooks/index.ts`** to discover existing hooks before writing a
new one. The hook namespaces (`core`, `agents`, `reviews`, `repo-intel`,
`trace`) map 1:1 to the server modules; keep that split.

## Data fetching: TanStack Query only

All API calls go through hooks in `src/lib/hooks/*`. **Never** `fetch` from a
component, and never `useEffect(fetch…)`. Inside hooks, use `apiFetch` / `api`
from `src/services/api.ts` — they normalize the server's `ApiErrorBody` envelope
into `ApiError` (with `status`, `code`, `details`) so the global error policy
works.

Add a hook to the namespace that matches the server module
(`agents/routes.ts` → `hooks/agents.ts`, etc.) and re-export from
`hooks/index.ts`.

## Error UX: don't reinvent the global policy

`providers.tsx` already wires global error surfacing:

- **Mutations always toast** on error (they're user actions).
- **Queries toast only on status `0` or `5xx`** — expected `4xx` (e.g. a `404`
  "no tour yet") stays silent so pages can render an inline empty state.

Don't sprinkle per-component `onError: notify.error(…)` for the same paths —
it double-toasts. **Do** add per-component handlers for surgical UX (e.g. a
specific `409` → "already exists" inline message); just skip the generic toast
when the global one already covers it.

## Page/feature colocation

Pages (`src/app/**/page.tsx`) are thin. Feature components live in
**sibling** `_components/<Name>/<Name>.tsx` with their tests next to them
(`<Name>.test.tsx`). The `_components` prefix keeps Next.js from routing the
folder. Don't dump shared cross-page widgets there — those go in
`src/components/` or `src/vendor/ui` if reusable.

## UI primitives are vendored

Reach for `@devdigest/ui` (`src/vendor/ui`) — `kit/`, `primitives/`, `shell/`,
`charts/`, `command-palette/`, icons. Don't pull in a new third-party UI lib
to recreate a primitive that already exists; if a primitive is missing,
extend the vendored set instead.

## Shared contracts

DTO and enum types come from `@devdigest/shared` (`src/vendor/shared`) — same
Zod contracts the server uses. **Don't** redefine `Agent`, `Finding`,
`Verdict`, `Provider`, etc., locally; import them.

## i18n via next-intl

User-facing strings go in `messages/<locale>/<namespace>.json` and are read
through `useTranslations(...)`. Don't hardcode English in JSX. New namespaces
land alongside the existing files (currently `en/` is the only locale, but the
structure is locale-pluggable).

## Theme & density on `<html>`

`<html data-theme="…" data-density="…">` is set by `themeNoFlashScript`
before paint (avoids FOUC). Toggle via the `ThemeProvider` API, never via a
post-mount `useEffect` flip — that re-introduces FOUC.

`suppressHydrationWarning` is intentionally on `<html>` and `<body>` because
browser extensions (Grammarly, translators) inject attributes pre-hydrate.
Don't propagate `suppressHydrationWarning` deeper unless you have a documented
reason — real mismatches in descendants must stay reported.

## Shortcuts: extend, don't hand-roll

Global `g`-then-key shortcuts live in
`src/components/app-shell/hooks/useGlobalShortcuts.ts`. Add new bindings
there, not inside a feature component. Single-key handlers inside a component
must check input focus / modifier state so they don't fight the global system.

## Auto-refresh: respect the defaults

QueryClient defaults: `retry: 1`, `staleTime: 30s`, `refetchOnWindowFocus:
false`. Pages that **need** live updates (e.g. PR list status) opt in
explicitly (`refetchInterval: 60_000, refetchOnWindowFocus: true`). Don't
flip the global defaults — opt in per-query.

## Active repo: one source of truth

`RepoProvider` (`src/providers/repo-context.tsx`) holds the active repo for chrome
that lives outside a route. **Inside** a `repos/[repoId]/...` page, prefer the
route param; outside, use the context. Don't read both for the same piece of
state in the same component — that creates "they disagree" bugs.

## Tests: vitest + jsdom, hermetic

`fetch` is mocked in `src/test/setup.ts` — no real API or DB. Component tests
live next to the component as `*.test.tsx`. When a test needs i18n, wrap with
`NextIntlClientProvider` using the JSON from `messages/en/...`.

The deterministic browser journeys (real stack, seeded DB, no LLM) live in
`../e2e/` and are covered by `e2e-web.yml` — don't try to recreate them as
jsdom tests.

## Imports: no `.js` suffix here

Unlike the server, **the client does not require `.js` suffixes** on internal
TypeScript imports — Next.js / vite resolve `.ts` and `.tsx` natively. Keep
imports extensionless inside `client/`.

## How to grow this file

- **New convention?** → add a section here.
- **One-off surprise / "looked obvious and wasn't"?** → append an entry to
  `INSIGHTS.md`.
- **Topic outgrowing this file?** → promote to `docs/<topic>.md` and link it
  from the `Read … when …` block above.
- **New contract / fixture?** → add it under `specs/` with a short doc.
