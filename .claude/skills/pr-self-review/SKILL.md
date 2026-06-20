---
name: pr-self-review
description: "Local pre-PR gate for the DevDigest monorepo. Runs the current diff (vs `origin/main`) through the relevant per-bucket skills (`onion-architecture`, `fastify-best-practices`, `react-best-practices`, `next-best-practices`, `frontend-architecture`, `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, `security`, `react-testing-library`, `typescript-expert`, `claude-api`), aggregates findings by severity, and blocks `gh pr create` on feature branches when at least one CRITICAL is found. Three trigger modes: (1) MANUAL via phrases 'self review', 'pre-pr check', 'before opening a PR', 'check the diff locally', 'review my changes', 'block critical findings'; (2) AFTER LOCAL CHANGES — proactively when there are uncommitted or unpushed edits on a non-`main` branch and the user is about to open a PR (offer or run the skill before `gh pr create`); (3) AUTOMATIC via PreToolUse hook on `Bash(gh pr create*)` only (NOT `git push*` — pushes flow freely; see `gate.md`). Do NOT fire on `main`, on empty diffs, or on docs-only diffs. NOT a substitute for `/review` (post-PR) or `/security-review` (broad security pass)."
version: 0.1.0
---

# pr-self-review

Local **pre-PR gate** for `dev-digest`. Reuses every module-specific skill the
repo already ships and turns them into a single blocking workflow on the
working diff.

## When to use

Fire on any of:

- **Manual.** User asks via trigger phrases ("self review", "pre-pr check",
  "review my changes", "before opening a PR", "check the diff locally",
  "block critical findings"), or any other phrasing that means "run pre-PR
  review on my current diff".
- **After local changes.** There are uncommitted or unpushed edits on a
  non-`main` branch and the user is preparing to open a PR — proactively
  offer or run this skill before `gh pr create`. Do not re-fire after every
  individual edit; gate by the user's intent to open a PR.
- **PreToolUse hook.** `.claude/hooks/pr-self-review.sh` intercepts
  `Bash(gh pr create*)` only — **not** `git push*`. Plain pushes
  (backup pushes, force-pushes after rebase) flow freely; the gate kicks in
  at PR-open time. The hook returns `decision: "block"` and re-prompts the
  model to invoke this skill (see `gate.md` for the full hook protocol,
  draft mode, and bypass).

Do **not** fire when:

- Current branch is `main`.
- Diff vs `origin/main` is empty.
- Diff contains only `*.md` / `specs/**` (docs-only) — report `skipped` and exit 0.

## Procedure (8 steps — execute in order)

### Step 1 — Compute diff scope

```
base=$(git merge-base HEAD origin/main)
files=$(git diff --name-only --diff-filter=ACMR "$base"...HEAD)
diff_full=$(git diff --no-color "$base"...HEAD)
```

Empty `files` → exit 0 with `{ verdict: "PASS", reason: "no changes to review" }`.

When `--staged` flag is present, swap to `git diff --cached --name-only` /
`git diff --cached --no-color`. When `--no-cache` is present, skip Step 2.

### Step 2 — Cache lookup

```
hash=$(printf '%s' "$diff_full" | shasum -a 256 | awk '{print $1}')
cache=.claude/cache/pr-self-review/$hash.json
```

If `$cache` exists, was written by the same `pr-self-review` version
(`SKILL.md` mtime), and is < 24 h old → print cached report with a
`[cached]` footer and exit with the cached verdict's exit code. Done.

### Step 3 — Classify files into buckets

Walk the bucket table below in order. A single file may fall into multiple
buckets (e.g. `security` and `zod` are cross-cutting). Empty buckets are skipped.

### Step 4 — Read collateral

For each non-empty bucket, read the matching `INSIGHTS.md`:

| Bucket family       | INSIGHTS.md to load                  |
|---------------------|--------------------------------------|
| `client/**`         | `client/INSIGHTS.md`                 |
| `server/**`         | `server/INSIGHTS.md`                 |
| `reviewer-core/**`  | `reviewer-core/INSIGHTS.md`          |
| `e2e/**`            | `e2e/INSIGHTS.md`                    |
| repo-wide / configs | `INSIGHTS.md` (root)                 |

Extract only the relevant sections: **What Doesn't Work**, **Recurring
Errors & Fixes**, **Codebase Patterns**, **Tool & Library Notes**. Pass the
extract inline to the bucket's subagent — any finding that matches a known
INSIGHTS entry is auto-promoted to `CRITICAL` (we've already been bitten).

### Step 5 — Dispatch parallel Explore subagents

For each non-empty bucket, launch one `Explore` subagent. **Send all
dispatches in a single message** to maximize parallelism, but batch in waves
of 3 if the bucket count exceeds Claude Code's concurrent-Task cap.

Each subagent receives:

1. **Diff fragments, not whole files.** For each file in the bucket,
   pass `git diff --no-color "$base"...HEAD -- <file>` with default ~3-line
   context. Subagent only reviews changed regions.
2. **Token cap.** If the bucket has > 20 files, keep the top 20 by diff size
   and record the rest under `files_skipped_budget`.
3. **Required skill list** — names only; the subagent loads them itself.
4. **INSIGHTS extract** from Step 4.
5. **Finding contract** (the Zod schema below) as the exact JSON output shape.
6. **Severity definitions** (this file's *Severity* section).
7. **CI parity hint**: if a finding would already be caught by `tsc` / `eslint`
   / `vitest`, set `ci_would_catch: true` — aggregation will downgrade it to
   `INFO` automatically.

Use the **Subagent prompt template** at the end of this file verbatim.

### Step 6 — Cross-bucket integration pass

The main session itself (no subagent) runs these checks against the diff
file list — they catch issues no single bucket can see:

| Check                                                                                                              | Severity |
|--------------------------------------------------------------------------------------------------------------------|----------|
| `server/src/vendor/shared/**` changed without paired update in `client/src/lib/api.ts` or client test fixtures     | HIGH     |
| New route handler in `server/src/modules/**/routes.ts` without zod schema for `params`/`body`/`querystring`        | CRITICAL |
| New column in `server/src/db/schema/**` without paired file in `server/src/db/migrations/**`                       | CRITICAL |
| New `process.env.X` reference in `server/src/**` without env-table update in `server/README.md`                    | MEDIUM   |
| New long-running job kind not registered in `ReviewService.reapStaleRuns()`                                        | HIGH     |
| New SSE endpoint without `config: { rateLimit: false }`                                                            | HIGH     |
| New `*.it.test.ts` file that does not import `test/helpers/pg.ts` (or vice versa)                                  | CRITICAL |
| New `Schema.parse(req.body)` inside a handler (validation must happen via route schema, not the handler)           | CRITICAL |
| New `reply.status(...).send({ error: ... })` for a failure path (must throw `AppError` taxonomy instead)           | HIGH     |
| Import of `drizzle-orm/**` from a `service.ts` (must stay in `repository.ts`)                                      | CRITICAL |
| Import of `@octokit/**` from `routes.ts` or `service.ts` (must stay in an adapter)                                 | CRITICAL |
| `process.env.*` reference inside `reviewer-core/src/**`                                                            | CRITICAL |

Each check is a simple grep over the known diff file list. Findings produced
here also go through the `Finding` schema (with `bucket: "cross-bucket"`).

### Step 7 — Aggregate

Parse every subagent's response via `Finding`/`BucketReport` (Zod `safeParse`).
- Valid → merge into `findings[]`.
- Invalid → mark bucket as `incomplete` with the parse error.

Apply post-processing in this order:

1. **CI parity downgrade.** Any `Finding` with `ci_would_catch: true` →
   `severity = "INFO"`.
2. **Suppress matching.** For each `Finding`, scan the offending file's diff
   region for an inline suppress marker
   `pr-self-review: allow <SEVERITY> <RULE> — reason: <text>`. Match → set
   `suppressed_by: "inline"`. Suppress without `— reason:` → leave original
   finding intact **and** emit an extra `LOW` finding
   `pr-self-review/suppress-without-reason`.
3. **Ignore-file matching.** Read `.pr-self-review-ignore` (YAML list). For
   each entry, require `rule`, `file`, `reason`, `expires`. Missing `expires`
   → ignore entry rejected (emit `LOW` finding). Matching entry with future
   `expires` → set `suppressed_by: "ignore-file:<entry-idx>"`. Matching entry
   with past `expires` → keep original severity but prefix `summary` with
   `[expired ignore]`.
4. **INSIGHTS auto-promote.** Any finding with non-empty `insights_md_match`
   → bump severity to `CRITICAL` (unless `suppressed_by` is set).
5. **Strict-mode upgrade.** If invoked with `--strict`, treat `HIGH` as
   blocking too (only affects verdict, not severity).

Count per-severity. **If any bucket is `incomplete` → verdict = `BLOCK —
incomplete review`**, regardless of finding counts. Silent pass-through on
subagent failure is forbidden.

### Step 8 — Persist & verdict

Write the markdown report to `.claude/cache/pr-self-review/latest.md` and the
machine-readable artifact (parsed findings + verdict + skill versions) to
`.claude/cache/pr-self-review/<hash>.json`.

Verdict logic:

| Condition                                                                  | Verdict                          | Exit code |
|----------------------------------------------------------------------------|----------------------------------|-----------|
| Any bucket `incomplete`                                                    | `BLOCK — incomplete review`      | 2         |
| `--draft` flag from hook payload AND `critical_count > 0`                  | `WARN — draft mode`              | 0         |
| `critical_count > 0` (or `high_count > 0` under `--strict`)                | `BLOCK — N critical, M high`     | 2         |
| Otherwise                                                                  | `PASS — N high, M medium, K low` | 0         |

## Bucket → skills routing

**Read `.claude/skills/pr-self-review/routing.md`** — the full bucket → path
pattern → required-skills table. Load it before Step 3 (classify files) and
keep it in context through Step 5 (dispatch subagents).

## Severity definitions

- **CRITICAL** — Blocks. Security bug (XSS, SQLi, secret in code, bypassed
  `getContext` / auth), dependency-rule violation (`onion-architecture`:
  `process.env` in `reviewer-core`, Drizzle in service, Octokit in route),
  guaranteed runtime crash on a typical path, broken migration, `*.it.test.ts`
  filename / import mismatch (CI lane will break), `Schema.parse(req.body)`
  inside a handler.
- **HIGH** — Strong best-practice violation. RSC boundary breach, `useEffect`
  for derivable state, missing zod validation at the edge, SSE endpoint
  without `rateLimit: false`, missing `AppError` use on a failure path.
- **MEDIUM** — Structural / stylistic. File placement per
  `frontend-architecture`, premature abstraction, dead code, missing env-var
  doc.
- **LOW** — Nit; observation; suppress-without-reason follow-up.
- **INFO** — Auto-downgrade marker via `ci_would_catch: true`. Reported but
  never blocking, never counted toward verdict thresholds.

## Finding contract (Zod)

Subagents return JSON matching this schema. See
`.claude/skills/pr-self-review/finding-schema.ts` for the canonical source.

```ts
const Finding = z.object({
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  rule: z.string(),                          // "<skill>/<rule-id>", e.g. "onion-architecture/no-process-env-in-engine"
  file: z.string(),                          // repo-relative path
  lines: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  summary: z.string().min(1),                // 1–2 sentences, what is violated
  evidence_snippet: z.string().min(1),       // 3–5 lines of the offending code
  suggested_fix: z.string().min(1),          // actionable, e.g. "replace line 42 with X"
  ci_would_catch: z.boolean(),               // true → severity is downgraded to INFO at aggregation
  insights_md_match: z.string().optional(),  // pointer to an INSIGHTS.md heading
  suppressed_by: z.string().optional(),      // "inline" | "ignore-file:<idx>" (set by aggregator, not subagent)
});

const BucketReport = z.object({
  bucket: z.string(),
  consulted_skills: z.array(z.string()),
  files_reviewed: z.array(z.string()),
  files_skipped_budget: z.array(z.string()),
  findings: z.array(Finding),
  notes: z.string().optional(),
});
```

A valid `Finding` is **specific** (file + lines), **evidence-backed**
(`evidence_snippet`), and **actionable** (`suggested_fix` says what to do, not
"consider refactoring"). Vague findings are themselves a `LOW`
`pr-self-review/vague-finding` mark during aggregation.

## Suppress protocol

**Inline (per-line).** Comment placed on the violation line or the line above:

```ts
// pr-self-review: allow CRITICAL onion-architecture/no-process-env-in-engine — reason: bootstrap script, not engine
const url = process.env.DATABASE_URL;
```

Regex: `pr-self-review:\s*allow\s+(\w+)\s+([\w\-/\.]+)\s+—\s+reason:\s*(.+)`.
Missing `reason` → suppress rejected + extra `LOW` finding.

**Ignore-file** at repo root: `.pr-self-review-ignore` (YAML list).

```yaml
- rule: drizzle-orm-patterns/no-raw-sql
  file: server/src/db/raw-queries/legacy-report.ts
  reason: ported as-is from old system, scheduled rewrite Q3
  expires: 2026-09-30
```

All four fields required. Missing `expires` → entry rejected. Past `expires`
→ original severity restored with `[expired ignore]` summary prefix.

**Env-bypass** (handled by the hook, not this skill): set
`PR_SELF_REVIEW_BYPASS=1` and `PR_SELF_REVIEW_BYPASS_REASON="<text>"`. The
hook writes `.claude/cache/pr-self-review/bypass.log` and exits 0. Missing
`BYPASS_REASON` → bypass rejected.

**Draft mode** (handled by the hook): when the intercepted command is
`gh pr create --draft`, the hook adds `draft_mode: true` to the input payload;
this skill downgrades `BLOCK` to `WARN` per the Step 8 table.

## Subagent prompt template

```
You are reviewing a diff fragment for the **<BUCKET_NAME>** bucket of the
dev-digest repo.

## Skills you MUST consult
<SKILL_LIST>

## Severity definitions
<SEVERITY_BLOCK — copy from SKILL.md>

## Output contract
Return ONE fenced ```json``` block matching this shape:
<BUCKET_REPORT_SCHEMA — copy from SKILL.md>

Hard rules:
- Findings must be specific: file path + line range + 3–5 line evidence_snippet
  + actionable suggested_fix.
- "consider refactoring" / "this could be improved" → NOT a valid finding.
- If you'd flag something that `tsc`/`eslint`/`vitest` already catches,
  set ci_would_catch: true.
- An empty findings array is a valid answer; don't pad.

## INSIGHTS extract (already-known traps — match these first, promote to CRITICAL)
<INSIGHTS_EXTRACT>

## Files (diff fragments)
<for each file:>
### <file>
```diff
<git diff --no-color $base...HEAD -- $file>
```

## Token budget
<N> files in this bucket, top 20 shown above. Skipped: <SKIPPED_LIST>.
```

## Output format (markdown report)

```
# PR self-review — <branch> → main

**Verdict:** BLOCK — 2 critical, 1 high
**Diff:** <files_changed> files, base=<base_sha>, head=<head_sha>

## Critical (2)
### `onion-architecture/no-process-env-in-engine` · `reviewer-core/src/index.ts:42-44`
<summary>
```ts
<evidence_snippet>
```
**Fix:** <suggested_fix>
> Matches INSIGHTS.md: reviewer-core/INSIGHTS.md#engine-purity

### `security/secret-in-source` · `server/src/modules/foo/service.ts:18-19`
…

## High (1)
…

## Medium / Low / Info
<collapsed counts; full list in cache/<hash>.json>

---
consulted: onion-architecture@0.1.0, fastify-best-practices@0.1.0, security@0.1.0
duration: 47s · cached: false
```

## Hook integration

**Read `.claude/skills/pr-self-review/gate.md`** — what the PreToolUse hook
does, when it short-circuits, draft-mode cue, and the bypass protocol.

## Flags

- `--staged` — review `git diff --cached` instead of `git diff $base...HEAD`.
- `--strict` — promote `HIGH` to blocking.
- `--no-cache` — bypass `.claude/cache/pr-self-review/` lookup.

Flags are parsed from the slash invocation; they do not affect hook-driven runs.
