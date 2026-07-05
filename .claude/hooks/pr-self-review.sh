#!/usr/bin/env sh
# PreToolUse hook — intercept `gh pr create` and `git push` on feature branches
# and tell the model to run `/pr-self-review` first.
#
# Why a thin wrapper: shell can't call Claude. The hook returns
# `decision: "block"` with a reason that re-prompts the model to invoke the
# `pr-self-review` skill, get a verdict, then re-issue the original command.
# Env-bypass (`PR_SELF_REVIEW_BYPASS=1` + `PR_SELF_REVIEW_BYPASS_REASON=<text>`)
# skips the gate but writes an audit row.
#
# Conventions follow .claude/hooks/remind-insights.sh: exit 0, output a JSON
# blob; `decision: "block"` re-prompts the model.

set -eu

input=$(cat)

tool_name=$(printf '%s' "$input" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ "$tool_name" = "Bash" ] || exit 0

# Pull tool_input.command. POSIX BRE doesn't handle escaped-quote alternation,
# so we capture up to the first plain quote. Commands with embedded quotes (rare
# for `gh pr create` / `git push`) will under-match and the hook will safely no-op.
command=$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ -n "$command" ] || exit 0

is_gh_pr_create=0
is_git_push=0
case "$command" in
  "gh pr create"*) is_gh_pr_create=1 ;;
  "git push"*)     is_git_push=1 ;;
  *) exit 0 ;;
esac

# --- git push: skip main, skip deletes ----------------------------------
if [ "$is_git_push" -eq 1 ]; then
  case "$command" in
    *" --delete "*|*" -d "*) exit 0 ;;
  esac
  # A push spec of the form `:refs/heads/foo` (empty src) is also a delete.
  case "$command" in
    *" :"*) exit 0 ;;
  esac
  branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" symbolic-ref --short HEAD 2>/dev/null || echo "")
  if [ "$branch" = "main" ] || [ -z "$branch" ]; then
    exit 0
  fi
fi

# --- bypass -------------------------------------------------------------
if [ "${PR_SELF_REVIEW_BYPASS:-}" = "1" ]; then
  reason="${PR_SELF_REVIEW_BYPASS_REASON:-}"
  if [ -z "$reason" ]; then
    cat <<'JSON'
{"decision":"block","reason":"PR_SELF_REVIEW_BYPASS=1 was set but PR_SELF_REVIEW_BYPASS_REASON is empty. Bypass requires a reason. Either remove the bypass and run /pr-self-review, or set PR_SELF_REVIEW_BYPASS_REASON='<short justification>' and retry."}
JSON
    exit 0
  fi
  log_dir="${CLAUDE_PROJECT_DIR:-.}/.claude/cache/pr-self-review"
  mkdir -p "$log_dir"
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  head_sha=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --short HEAD 2>/dev/null || echo "?")
  branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" symbolic-ref --short HEAD 2>/dev/null || echo "?")
  printf '%s\tbranch=%s\tsha=%s\tcmd=%s\treason=%s\n' \
    "$ts" "$branch" "$head_sha" "$command" "$reason" >> "$log_dir/bypass.log"
  exit 0
fi

# --- detect draft (only meaningful for gh pr create) --------------------
draft_flag=""
if [ "$is_gh_pr_create" -eq 1 ]; then
  case "$command" in
    *" --draft"*|*" -d"*) draft_flag=" (draft mode — CRITICAL findings downgrade to WARN, but BLOCK_INCOMPLETE still blocks)" ;;
  esac
fi

# --- verdict recognition: honor a fresh cached PASS ---------------------
# The pr-self-review skill (Step 8) writes .claude/cache/pr-self-review/<hash>.json
# keyed by sha256 of the diff vs merge-base. Without this check the gate's own
# "re-issue the original command after PASS" instruction dead-loops (INSIGHTS
# 2026-07-03). A fresh (<24h) PASS — or WARN under --draft — lets the command
# through and logs the pass-through for audit.
repo="${CLAUDE_PROJECT_DIR:-.}"
base=$(git -C "$repo" merge-base HEAD origin/main 2>/dev/null || echo "")
if [ -n "$base" ]; then
  # Canonical formula from SKILL.md Step 2: command substitution strips the
  # trailing newline, so hash printf '%s' of the captured diff — a direct pipe
  # would include the newline and never match the skill-written cache key.
  diff_full=$(git -C "$repo" diff --no-color "$base"...HEAD)
  hash=$(printf '%s' "$diff_full" | shasum -a 256 | awk '{print $1}')
  cache="$repo/.claude/cache/pr-self-review/$hash.json"
  if [ -f "$cache" ] && [ -n "$(find "$cache" -mmin -1440 2>/dev/null)" ]; then
    # First occurrence, non-greedy: the artifact writes the top-level verdict
    # first; a greedy .* match could pick a "verdict" echoed inside a finding.
    verdict=$(grep -oE '"verdict"[[:space:]]*:[[:space:]]*"[^"]*"' "$cache" | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')
    allow=0
    [ "$verdict" = "PASS" ] && allow=1
    if [ "$verdict" = "WARN" ] && [ -n "$draft_flag" ]; then allow=1; fi
    if [ "$allow" -eq 1 ]; then
      ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      printf '%s\tverdict=%s\thash=%s\tcmd=%s\n' \
        "$ts" "$verdict" "$hash" "$command" \
        >> "$repo/.claude/cache/pr-self-review/pass-through.log"
      exit 0
    fi
  fi
fi

# --- block: tell the model to run the skill ----------------------------
if [ "$is_gh_pr_create" -eq 1 ]; then
  trigger_label="gh pr create"
else
  trigger_label="git push"
fi

cat <<JSON
{"decision":"block","reason":"Before \`${trigger_label}\` runs, invoke the \`pr-self-review\` skill on the current diff${draft_flag}. Read \`.claude/skills/pr-self-review/SKILL.md\` and follow the 8-step procedure. If the verdict is PASS (or WARN under --draft), re-issue the original command. If the verdict is BLOCK, fix the CRITICAL findings (or add a justified \`pr-self-review: allow ...\` inline suppress / \`.pr-self-review-ignore\` entry) before retrying. To bypass for an emergency hotfix, retry with \`PR_SELF_REVIEW_BYPASS=1 PR_SELF_REVIEW_BYPASS_REASON='<reason>'\` prefixed to the command."}
JSON
