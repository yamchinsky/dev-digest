# INSIGHTS — `client/`

Durable, surprising lessons that bite this module — things that *looked
obvious and weren't*. Append-only. New entries are added by the
`engineering-insights` skill. Read this file before solving a non-obvious
bug or making a "looks obvious" decision in `client/`.

## What Works
_None yet._

## What Doesn't Work

### pnpm 11 crashes in `runDepsStatusCheck` until `allowBuilds` placeholders are filled in `pnpm-workspace.yaml`
_2026-06-19_ · `client/pnpm-workspace.yaml`, `server/pnpm-workspace.yaml`

pnpm **11.x** moved build-script approval (native deps like `esbuild`, `sharp`, `ssh2`) into a per-package `pnpm-workspace.yaml` with an `allowBuilds:` map — it writes this file even with no real workspace, seeded with placeholder values `set this to true or false`. While placeholders remain, every `pnpm` invocation aborts inside `runDepsStatusCheck` (corepack `pnpm.mjs`). Fix = **edit the file, replace each placeholder with `true`/`false`** (we use `true` for `esbuild`/`sharp` in `client/` — they need their postinstall build); then `pnpm install` runs clean. `server/pnpm-workspace.yaml` is committed and legitimate, so this is expected per-package config, NOT a stray artifact.

> Updated 2026-06-19: this entry originally (mis)diagnosed the file as a stray artifact to delete. **That was wrong** — deleting it is futile (pnpm 11 regenerates it on the next run) and `server/`'s copy is committed. The real fix is filling in `allowBuilds`, above. Also note: corepack injects a `"packageManager": "pnpm@<ver>+sha512…"` line into `package.json` on run; that one IS unwanted here — revert just that line.

## Codebase Patterns

### Chip `color` prop styles only the leading icon — chip border/background come from `active`
_2026-06-19_ · `src/vendor/ui/primitives/Chip.tsx:35-40`

The `color` prop on `Chip` is applied via `<I size={13} style={color ? { color } : undefined}/>` — only to the icon. The chip's own border/background swap between `var(--accent)` and `var(--border)` based on `active`/`hover`, regardless of `color`. Severity-tinted chips (e.g. CRITICAL red icon) therefore keep the global accent visual language; don't reach for a "tint the whole chip" variant — that breaks the toolbar's accent uniformity. Matches the standalone design's `findings.jsx → FindingsPanel` 1-to-1.

### `<SeverityBadge compact />` is icon-ONLY — it drops the text label
_2026-06-28_ · `src/vendor/ui/primitives/Badge.tsx:80`, `src/components/diff-viewer/CodeLine/CodeLine.tsx`

`SeverityBadge` renders `{compact ? null : s.label}` — so `compact` shows just the severity icon, no word. Reaching for it to make an in-diff finding badge produced a badge so small it read as "no badge at all" against the code (the in-diff design wants a visible `icon + lowercase label` pill: blocker / warning / suggestion). When you need a labelled severity pill in a tight row, don't pass `compact`; build a small pill from the `SEV[severity]` tokens (`.c`, `.bg`, `.icon`) and your own label map — note the design uses **"blocker"** for `CRITICAL`, not `SEV.CRITICAL.label` ("Critical").

## Tool & Library Notes

### A `<button>` whose only child is an icon-only `SeverityBadge` is invisible to `getByRole("button", { name })`
_2026-06-28_ · `src/components/diff-viewer/CodeLine/CodeLine.tsx` (in-line finding badges), `SmartDiffViewer.test.tsx`

When a clickable wrapper `<button aria-label="…">` contains only `<SeverityBadge compact />` (which renders an SVG icon and `null` label, no text node), RTL computes the button's accessible name from its children and ends up empty — so `screen.getByRole("button", { name: "view warning finding" })` throws "Unable to find" even though the `aria-label` is present in the DOM. The `<I>` icons in `vendor/ui/primitives/Badge.tsx` carry no `aria-hidden`, so they don't contribute a name but the children-based name calc still wins over the wrapper's `aria-label`. Fix in tests: query these icon-only buttons with `screen.getByLabelText("View warning finding")` instead of `getByRole(..., { name })`.

> Updated 2026-06-28: the in-diff badge no longer uses `compact` — it renders a visible lowercase label ("blocker"/"warning"/"suggestion") next to the icon to match the design, so `getByRole("button", { name })` works again for it. The accessible-name-from-children quirk still applies to any *icon-only* button you build, so the lesson stands; it just no longer bites this specific badge.

## Recurring Errors & Fixes

### Adding a required field to a shared Zod contract rots inline test fixtures in both packages
_2026-06-18_ · see repo-root `INSIGHTS.md` → Recurring Errors & Fixes (cross-module; concrete client bite was `RunTraceDrawer.test.tsx:10`)

## Session Notes
_None yet._

## Open Questions
_None yet._
