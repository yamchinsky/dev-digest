# INSIGHTS — repo

Durable, surprising lessons that bite across modules — things that *looked
obvious and weren't*. Append-only. New entries are added by the
`engineering-insights` skill. Read this file before solving a non-obvious
bug or making a "looks obvious" decision that spans modules. Module-level
findings live in `<module>/INSIGHTS.md`.

Keep under ~200 entries; split per sub-domain if it grows past that.

## What Works
_None yet._

## What Doesn't Work
_None yet._

## Codebase Patterns
_None yet._

## Tool & Library Notes

### `DevDigest Design (standalone).html` is a custom base64+gzip bundle — `file://` crashes the runtime
_2026-06-19_ · `~/Desktop/dev-digest-mats/DevDigest Design (standalone).html` (`repo-wide` tooling)

The standalone design artefact is a single 1.7 MB HTML that *looks* static but is a bundler: assets live in `<script type="__bundler/manifest">` (base64, gzip-`compressed: true`), the HTML template lives in `<script type="__bundler/template">` (JSON-encoded string), and the boot script swaps `document.documentElement` with the decoded template. Loading via `file://` makes blob URLs inherit a null origin → the bundler's own `fetch(s.src)` for inline-babel scripts silently drops, and Chrome DevTools loses its target on `replaceWith` (the page just disappears from `list_pages`). Serving from `127.0.0.1` works but exposing `Desktop/` is sandbox-blocked here. **Inspection workflow that works without rendering:** read line 178 → `JSON.parse` → grep for `type="text/babel"\s+src="<uuid>"` → for each UUID, look up the matching manifest entry, `base64.b64decode` then `gzip.decompress` if `compressed: true` → write to `/tmp/dd-design-src/NN_<uuid>.jsx`. The 28 babel scripts are the actual JSX; e.g. `screen_pr_detail.jsx`, `findings.jsx`, `prdetail_runs.jsx`. Faster than fighting the runtime.

### `pnpm typecheck` aborts on `ERR_PNPM_IGNORED_BUILDS` before tsc runs
_2026-06-18_ · `repo-wide` (`server/`, `client/`)

On a fresh corepack-pnpm 11.8 boot, `pnpm typecheck` (and any `pnpm exec
…`) triggers an implicit dep-status check that exits non-zero with
`ERR_PNPM_IGNORED_BUILDS` because `cpu-features`, multiple `esbuild`
versions, `protobufjs`, and `ssh2` have postinstall scripts that aren't on
the approved list. tsc never executes; CI logs read like a typecheck
failure but aren't. Workaround used this session: `./node_modules/.bin/tsc
--noEmit` direct. Permanent fix: `pnpm approve-builds` for those packages
(commit the resulting `package.json` change), or set
`package-manager-strict=false` in `.npmrc`.

### Stop hook reminder: use non-blocking `additionalContext`, not `decision:"block"` + `jq -e empty` guard
_2026-06-20_ · `.claude/settings.json` (`repo-wide` tooling)

The `engineering-insights` Stop hook first shipped as `jq -re 'if .stop_hook_active then empty else {decision:"block", reason:…} end'`. The `else` branch is fine, but the loop guard is fragile: `jq -e` on `empty` exits with **code 4**, which Claude Code's hook contract does not define (only 0 / 2 / "other → non-blocking") — the stop is allowed only as a side effect of a non-zero exit, not a documented path. The canonical form is non-blocking feedback: `jq -cn '{hookSpecificOutput:{hookEventName:"Stop", additionalContext:"…"}}'` — always exit 0, injects the reminder into the next model request without blocking the stop. Because nothing is blocked, the `stop_hook_active` guard is no longer needed (no loop risk). Use `additionalContext` for *reminders*; reserve `decision:"block"` (with a clean exit 0) only when you must hard-stop the turn until an action is taken.

### Hook logic belongs in a script file, not an inline `jq` expression in `settings.json`
_2026-06-20_ · `.claude/hooks/remind-insights.sh`, `.claude/settings.json`

Beyond the exit-code bug above, the deeper smell was *form*: the whole hook lived as an inline `jq` program inside the JSON config — escaped quotes, single line, uncommentable, and `jq` became a hidden PATH dependency. Canonical Claude Code shape is a separate executable that reads the event on stdin and prints decision JSON on stdout. We moved it to `.claude/hooks/remind-insights.sh` (POSIX `sh`, quoted heredoc, `chmod +x`) and point `command` at `"$CLAUDE_PROJECT_DIR"/.claude/hooks/remind-insights.sh` (that env var is how a hook gets a cwd-independent path). Chose `sh` over a node script even though the repo is TS/Node: the payload is static, so spinning a node process per stop is needless overhead — reach for node only once the hook needs real logic (filter by cwd / touched modules). No `jq` needed for a constant payload — a quoted heredoc emits it and exits 0.

## Recurring Errors & Fixes

### Adding a required field to a shared Zod contract rots inline test fixtures in both packages
_2026-06-18_ · `server/src/vendor/shared/contracts/trace.ts` ↔ `client/src/vendor/shared/contracts/trace.ts` (paired vendored copies)

The dual-vendoring rule is in root `CLAUDE.md`, but the actual bite is
*test* fixtures: every `RunStats` / `RunSummary` / `PrMeta` literal in
tests is hand-written. When I made `RunStats.cost_usd` required
(`z.number().nullable()`) tsc broke `server/test/contracts.test.ts:160`
AND `client/.../RunTraceDrawer/RunTraceDrawer.test.tsx:10` independently
— and the client failure surfaces as a vitest assertion, not a typecheck.
There is no schema-driven factory. Before you extend a shared contract:
grep both packages for the closest existing key combo (e.g.
`duration_ms.*tokens_in` for RunStats, `agent_name.*findings_count` for
RunSummary), patch every literal, and run vitest on both before assuming
tsc-green = tests-green.

## Session Notes

### L01 — FINDINGS column on PR list, demo PRs, agent vs Claude Code review
_2026-06-19_ · `repo-wide`

Shipped (`feat/pr1-hw` → PR #2): per-severity `FINDINGS` column on the PR list (server agg from latest `review`-kind review per PR, sparse items projection for the hover tooltip; client `FindingsCell` ported 1-to-1 from `screen_dashboard.jsx`). Two false starts before getting there — first put severity chips on PR **detail** (wrong target — the design defines `findings.jsx → FindingsPanel` but never *uses* it; the rendered design only has chips on the LIST), then ran a temporary `acme/payments-api` seed instead of the user's own repo. Both reverted.

For the lab's "run reviewer + compare with Claude" item we needed real PRs with real diffs. The fork's parent (`burnjohn/dev-digest`) has 4 `demo/*` branches; 3 are clean ~30-line patches, the 4th (`demo/security-review-fixture`) carries a 900-file historical merge — useless to an agent, skipped. The 3 clean ones got cherry-picked onto user-main and opened as PRs #3/#4/#5 — *real* GitHub PRs the reviewer agent can fetch diffs for.

Lab also expects each module's `INSIGHTS.md` populated. Fastest path: write entries during the session whenever something non-obvious lands, and wire the `engineering-insights` skill via a `.claude/settings.json` Stop hook (added) so the next session populates the missing INSIGHTS without manual nagging. Loop-safe via `stop_hook_active`.

> Updated 2026-06-20: the hook was reworked to non-blocking `hookSpecificOutput.additionalContext` (exit 0), so `stop_hook_active` is no longer used — there is no loop to guard against anymore. See the entry in **Tool & Library Notes** above.

Demo PRs (`server/src/db/seed-demo-prs.ts`, idempotent, opt-in) cover both modes: PRs #101–#105 are pure DB rows with pre-seeded findings (visual only, can't be agent-reviewed — head_sha doesn't exist on GitHub); PRs #3–#5 are real and reviewable.

## Open Questions
_None yet._
