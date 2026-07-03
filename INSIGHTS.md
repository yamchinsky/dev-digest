# INSIGHTS — repo

Durable, surprising lessons that bite across modules — things that *looked
obvious and weren't*. Append-only. New entries are added by the
`engineering-insights` skill. Read this file before solving a non-obvious
bug or making a "looks obvious" decision that spans modules. Module-level
findings live in `<module>/INSIGHTS.md`.

Keep under ~200 entries; split per sub-domain if it grows past that.

## What Works

### Split folder-structure rules into `frontend-architecture` instead of extending react-best-practices
_2026-06-20_ · `.claude/skills/frontend-architecture/`, `.claude/skills/react-best-practices/SKILL.md:167-175`

The existing `react-best-practices` SKILL.md ends with a 6-line Code Organization section (lines 167-175) — tempting to extend, but doing so hurts triggering: queries like "where do constants go" or "utils vs helpers" should load architecture rules, not React anti-patterns. We split into a third skill `frontend-architecture` (v0.1.0) that covers both Vite React and Next.js App Router folder structure; non-overlap with `react-best-practices` (patterns) and `next-best-practices` (RSC/runtime) is documented in `frontend-architecture/README.md` under "Relationship to other skills". Before extending Code Organization in `react-best-practices`, check whether the addition is about *where files live* (belongs in `frontend-architecture`) or about *how components are written* (stays in `react-best-practices`).

## What Doesn't Work

### Commit messages and PR bodies go in English, not the session's Ukrainian reply language
_2026-06-30_ · `.claude/agents/*.md`, `docs/plans/agent-skill-fleet.md:109,228` (repo-wide)

The repo convention is "report/artifacts in **English**, address the user in **Ukrainian**" — but it lives only in agent/skill *Language* footers (e.g. `architecture-reviewer.md:243`, `researcher.md:74`, `doc-writer`/`plan-verifier`/`implementer`/`test-writer` SKILL.md) and the `agent-skill-fleet` plan (lines 109, 228), **not** in any `CLAUDE.md` or contributing guide. So a session running with a "respond in Ukrainian" language setting will wrongly carry it into commit messages and PR bodies (all repo history is English conventional commits). When authoring git/gh artifacts, default to **English** regardless of the chat reply language; reserve Ukrainian for addressing the user in chat. Hit this session: PR #19 body was first written in Ukrainian while its commits were English, then rewritten to English.

### The `gh pr create` hook fails open on prefixed commands (`cd X && gh pr create …`)
_2026-07-02_ · `.claude/settings.json` (PreToolUse `"if": "Bash(gh pr create*)"`)

The PreToolUse matcher `Bash(gh pr create*)` anchors at the start of the command string, so any prefix — `cd /path && gh pr create`, env assignment, subshell — slips past the gate and the PR opens unreviewed (bit us on PR #20). Same fails-open family as the routing-bucket entry below. Fix direction: change the matcher to a substring/regex form that catches `gh pr create` anywhere in the command (or have the hook script itself grep the full command), and until then run pr-self-review manually when opening PRs from scripts/compound commands.

> Updated 2026-07-03: the hook ALSO fails **closed** on clean commands — it blocks every `gh pr create` unconditionally (no verdict recognition; it never reads `.claude/cache/pr-self-review/<hash>.json`), so its own "re-issue the original command after PASS" instruction dead-loops. The designed exit is the audited `PR_SELF_REVIEW_BYPASS=1` env — but the Claude Code auto-mode classifier denies the MODEL setting it (correctly: guard bypasses are a human decision). Practical completion paths after a PASS verdict: the user runs `gh pr create …` themselves (own terminal, or `!`-prefix in the session), or the user explicitly approves the bypass command. Real fix: teach the hook to compute the current diff hash and exit 0 when a fresh cached verdict is PASS — then "re-issue" genuinely works.

### pr-self-review fails open: a diff file matching no routing.md bucket is never reviewed
_2026-07-02_ · `.claude/skills/pr-self-review/SKILL.md:64-67`, `.claude/skills/pr-self-review/routing.md`

Step 3 classifies diff files into `routing.md` buckets and dispatches one review subagent per non-empty bucket — there is no "unmatched files" fallback, so a file matching NO bucket silently bypasses the blocking CRITICAL gate. Bit us with `mcp/`: real plans touched `mcp/src/**` (blast-radius T3) but `routing.md` had no mcp bucket, and the dual-vendored `client/src/vendor/shared/**` mirror was likewise unmatched — both sailed through pre-PR review unreviewed. Fixed 2026-07-02 by adding an MCP-adapter bucket and the client mirror to the Shared-contracts bucket. When adding a new package or top-level source area, a `routing.md` bucket is part of the definition of done — the gate fails open, not closed, for unmatched paths. Known still-unmatched: `client/messages/**/*.json` and non-`.tsx` files under `client/src/services|utils|providers/**`.

### plan-verifier passes UI code that is never mounted — code existence ≠ reachability
_2026-07-02_ · `docs/plans/project-context.md:405` (T10), `.claude/skills/plan-verifier/SKILL.md`

SPEC-01 T10 was implemented exactly per plan into `SkillEditor.tsx`, but that component is only mounted at `/skills/new` in create mode while the new section was gated `isEdit && existing` — so the shipped feature was unreachable from any screen, despite green typecheck, tests, plan-verifier coverage, arch review, and PR review. Two-layer failure: the **plan** named the wrong owned path (the legacy `SkillEditor` instead of the actually-mounted `SkillsLab` → `SkillDetail` tabs — verify a component's mount points with grep before assigning it as an owned path), and **plan-verifier** accepted "component + hooks exist in the named file" as evidence without tracing the render path from a routed page. For UI acceptance criteria, evidence must include the mount chain (`page.tsx → … → component`), not just the diff. Found only by manually comparing the running app against the design mockups; fixed 2026-07-02 by moving the feature to a real Context tab in `SkillsLab`.

## Codebase Patterns
_None yet._

## Tool & Library Notes

### Renaming a PR's HEAD branch on GitHub CLOSES the open PR — rename before opening, or accept a new PR number
_2026-07-03_ · `gh api repos/<owner>/<repo>/branches/<old>/rename` (bit us on PR #22 → #23)

GitHub's branch-rename auto-retarget only applies to PRs that use the renamed branch as **base**; a PR whose **head** is renamed gets closed (its head ref is gone) and cannot be reopened. Bit us on the L06 homework: `feat/pr-brief` → `feat/pr5-hw` closed PR #22 minutes after creation, forcing PR #23 with identical content. The homework naming convention (`feat/prN-hw`) makes late renames likely — so either name the branch `feat/prN-hw` from the start, or finish all renames BEFORE `gh pr create`. Local cleanup after an API rename: `git branch -m old new && git fetch --prune && git branch -u origin/new new`.
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

> Updated 2026-06-20: the `hookSpecificOutput` form above is **rejected by Claude Code's validator for Stop events** — the JSON schema only allows `hookSpecificOutput` for `PreToolUse` / `UserPromptSubmit` / `PostToolUse` / `PostToolBatch`. Symptom: every Stop fires `Hook JSON output validation failed — (root): Invalid input` and the reminder is silently dropped. There is no non-blocking way to inject text into the next model request from a Stop hook. Working shape: read stdin, exit 0 when `"stop_hook_active": true`, otherwise emit `{"decision":"block","reason":"…"}` — this *does* block one stop and re-prompts the model with `reason`; the `stop_hook_active` guard makes it loop-safe. Soft alternatives: `{"systemMessage":"…"}` shows the text to the user (not the model), or move the reminder to a `UserPromptSubmit` hook where `additionalContext` is valid (fires *before* the next turn, not at end of current).

### Hook logic belongs in a script file, not an inline `jq` expression in `settings.json`
_2026-06-20_ · `.claude/hooks/remind-insights.sh`, `.claude/settings.json`

Beyond the exit-code bug above, the deeper smell was *form*: the whole hook lived as an inline `jq` program inside the JSON config — escaped quotes, single line, uncommentable, and `jq` became a hidden PATH dependency. Canonical Claude Code shape is a separate executable that reads the event on stdin and prints decision JSON on stdout. We moved it to `.claude/hooks/remind-insights.sh` (POSIX `sh`, quoted heredoc, `chmod +x`) and point `command` at `"$CLAUDE_PROJECT_DIR"/.claude/hooks/remind-insights.sh` (that env var is how a hook gets a cwd-independent path). Chose `sh` over a node script even though the repo is TS/Node: the payload is static, so spinning a node process per stop is needless overhead — reach for node only once the hook needs real logic (filter by cwd / touched modules). No `jq` needed for a constant payload — a quoted heredoc emits it and exits 0.

### `git mv A B` after editing A leaves the edits unstaged under B
_2026-06-20_ · `repo-wide` (git tooling)

`git mv` does not re-read the working tree — it just renames the index entry, carrying HEAD's blob hash to the new path. If you edited A before the move, the index now has stale content at B, and `git status` shows B as both staged-new and unstaged-modified. Always `git add B` after a `git mv` that follows an edit (or do the edit *after* the move). Hit during the AGENTS.md ↔ CLAUDE.md migration: text replacements inside the files silently fell out of the staged rename until re-added.

### New/renamed `.claude/agents/*.md` don't apply mid-session — the agent registry is cached at boot
_2026-07-02_ · `.claude/agents/` (`repo-wide` tooling)

Same caching family as the settings.json entry below: the subagent registry is snapshotted at session start. An agent file created or renamed mid-session cannot be spawned (`Agent type 'spec-creator' not found`), and a disabled one (renamed to `.md.disabled`) still appears in the session's available list until relaunch. Working workaround without restarting: spawn `general-purpose` with "read `.claude/agents/<name>.md` — its body is your system instruction; act exactly per it", and pass the intended `model` explicitly on the Agent call. Full fix: restart Claude Code.

### Claude Code caches `.claude/settings.json` at session start — mid-session edits don't apply
_2026-06-20_ · `.claude/settings.json` (`repo-wide` tooling)

Claude Code reads `.claude/settings.json` (project) and `~/.claude/settings.json` (user) once at session boot and caches them for the lifetime of the session. Edits to hook commands, permissions, env vars, or model don't propagate to the running session — and `/clear` doesn't reload settings, it only resets conversation context. Symptom: a hook fires with text/behavior that doesn't match what's on disk (e.g. a phantom "Failed with non-blocking status code" from a buggy command you already replaced). Diagnose by comparing the hook payload in the system-reminder to `cat .claude/settings.json`; if they differ, you're on cached config. Fix is a full exit + relaunch of Claude Code.

## Recurring Errors & Fixes

### A broken line continuation in `gh pr create` still opens the PR — with the wrong body
_2026-07-03_ · `repo-wide` (git/gh tooling)

A multi-line `gh pr create` missing a `\` continuation does NOT fail loudly: with no `--body*` flag on the first line, gh drops into interactive mode, auto-fills the body from the commit list, and submits — the orphaned `--body-file …` second line then errors as `zsh: command not found: --body-file` (bit us on PR #22). Net result: a live PR with the auto-generated body, easy to miss. Fix: don't close/recreate — `gh pr edit <n> --body-file <file>`. Note `gh pr edit` also bypasses the pr-self-review hook (it gates only `Bash(gh pr create*)`), fine here since review already ran at create time.

### `gh pr create` from this fork defaults to upstream (`burnjohn`), not `origin` (`yamchinsky`)
_2026-06-20_ · `repo-wide` (git/gh tooling)

`origin` is the fork `yamchinsky/dev-digest`; `upstream` is `burnjohn/dev-digest`. A bare `gh pr create --base main --head <branch>` resolves the base repo to **upstream** (gh's fork heuristic), so it fails with the misleading `GraphQL: Head sha can't be blank … No commits between main and <branch>` even though `git log origin/main..<branch>` clearly shows commits — the branch simply doesn't exist on upstream. Fix: pass the base repo explicitly and qualify the head with the owner: `gh pr create --repo yamchinsky/dev-digest --base main --head yamchinsky:<branch>`. (Or run `gh repo set-default yamchinsky/dev-digest` once.) Don't trust the "no commits between" message — check which repo gh is targeting first.

### Adding a required field to a shared Zod contract rots inline test fixtures in both packages
_2026-06-18_ · `server/src/vendor/shared/contracts/trace.ts` ↔ `client/src/vendor/shared/contracts/trace.ts` (paired vendored copies)

The dual-vendoring rule is in root `AGENTS.md`, but the actual bite is
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

> Updated 2026-06-20: the non-blocking `hookSpecificOutput.additionalContext` rework was itself wrong — Claude Code's Stop schema rejects `hookSpecificOutput`. Hook is back to `decision:"block"` + `reason` with the `stop_hook_active` guard. See the corrected entry in **Tool & Library Notes** above.

Demo PRs (`server/src/db/seed-demo-prs.ts`, idempotent, opt-in) cover both modes: PRs #101–#105 are pure DB rows with pre-seeded findings (visual only, can't be agent-reviewed — head_sha doesn't exist on GitHub); PRs #3–#5 are real and reviewable.

## Open Questions

### SPEC-01 AC-20 says HTTP 400, but the server returns 422 for context-doc whitelist violations
_2026-07-02_ · `specs/SPEC-01-2026-07-project-context-folder.md:67`, `PUT /agents/:id/context-docs`

Live verification: submitting a path outside the discovered set (e.g. `../../etc/passwd`) returns **422** `validation_error` / `INVALID_CONTEXT_DOC_PATH` with correct no-partial-persistence semantics — but AC-20 (and plan R7) normatively say **400**. The 422 matches the server-wide error taxonomy (all `ValidationError`s → 422, post-a44f69f), so the spec text is what's stale, not the code. Any future e2e/IT test written from the spec verbatim will fail on the status code. Pending decision: update AC-20 wording to 422 (recommended) vs. special-casing this route to 400. Don't "fix" the server to 400 without reading this.
