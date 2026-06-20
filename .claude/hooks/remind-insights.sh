#!/usr/bin/env sh
# Stop hook — remind the model to capture engineering insights before stopping.
#
# Claude Code's Stop hook schema does NOT accept `hookSpecificOutput`; valid
# top-level fields are `decision`, `reason`, `systemMessage`, etc. To inject an
# instruction back into the model we use `decision: "block"` with `reason`.
# That blocks the stop and re-prompts the model with `reason` as guidance.
#
# To avoid an infinite loop we read stdin and check `stop_hook_active`: when it
# is already true, Claude Code is continuing because of a previous stop block,
# so we exit 0 and let the turn end.

input=$(cat)

if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cat <<'JSON'
{"decision":"block","reason":"Before stopping, consider invoking the engineering-insights skill once: append a single dated entry to the correct INSIGHTS.md (root, server/, client/, reviewer-core/, or e2e/) for any non-obvious finding from this session — failure modes, library quirks, architectural decisions with non-obvious reasons, recurring errors and fixes, or unresolved open questions. Append-only; skip anything obvious from reading the code. Cover all four modules. If nothing non-obvious was uncovered, skip it."}
JSON
