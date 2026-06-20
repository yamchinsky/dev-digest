#!/usr/bin/env sh
# Stop hook — soft, non-blocking reminder to capture engineering insights.
#
# Claude Code runs this when the assistant is about to end a turn. It prints a
# single JSON object on stdout and exits 0; the `additionalContext` is injected
# into the next model request *without* blocking the stop (see the Stop hook
# contract in docs.claude.com/.../hooks). Because nothing is blocked there is no
# loop to guard against, so we ignore stdin and emit unconditionally.
#
# No jq dependency: the payload is static, so a quoted heredoc is enough.
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"Before stopping, consider invoking the engineering-insights skill once: append a single dated entry to the correct INSIGHTS.md (root, server/, client/, reviewer-core/, or e2e/) for any non-obvious finding from this session — failure modes, library quirks, architectural decisions with non-obvious reasons, recurring errors and fixes, or unresolved open questions. Append-only; skip anything obvious from reading the code. Cover all four modules. If nothing non-obvious was uncovered, skip it."}}
JSON
