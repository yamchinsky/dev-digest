# pr-self-review — Hook integration (gate)

How `.claude/hooks/pr-self-review.sh` cooperates with this skill.

## What the hook does

`.claude/hooks/pr-self-review.sh` is a **thin wrapper**. It does **not** call
Claude itself. Instead, when it detects a `gh pr create` invocation, it
returns a `decision: "block"` JSON with a `reason` that tells the user (and
the model) to invoke this `pr-self-review` skill first. The user / model
then runs the skill, gets the verdict, and re-runs the original command
when clear.

This avoids depending on the `claude` CLI being installed and on a hook-time
LLM round-trip. Trade-off: the hook can't auto-pass; it always interrupts on
the first attempt for a non-trivial diff. That's acceptable for a pre-PR gate.

**Scope.** The hook fires **only on `gh pr create*`**, not on `git push*`.
Pushes without a PR (feature-branch backups, force-pushes after rebase,
collaborator pushes) flow freely; the gate only kicks in at PR-open time.
The shell script still contains defensive logic for `git push` (deletion /
`main` short-circuits) in case the `git push*` matcher is re-added later.

## Wiring (already in `.claude/settings.json`)

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/pr-self-review.sh",
            "if": "Bash(gh pr create*)", "timeout": 10 }
        ]
      }
    ]
  }
}
```

## When the hook short-circuits (exit 0, no block)

- Tool is not `Bash`.
- Command is not `gh pr create*` (any `git push*` invocation slips past the
  matcher entirely — the script's `git push` defensive branch is currently
  unreachable).
- `PR_SELF_REVIEW_BYPASS=1` is set **with** a non-empty
  `PR_SELF_REVIEW_BYPASS_REASON` (logged to
  `.claude/cache/pr-self-review/bypass.log`).

## Draft mode

When the intercepted command is `gh pr create --draft`, the hook appends a
`(draft mode — CRITICAL findings downgrade to WARN, but BLOCK_INCOMPLETE
still blocks)` note to the block reason. The skill picks up the cue and
applies the Step 8 verdict table accordingly.

## Bypass protocol

For emergency hotfixes only:

```bash
PR_SELF_REVIEW_BYPASS=1 PR_SELF_REVIEW_BYPASS_REASON="prod outage, see incident #123" \
  gh pr create --fill
```

Missing `PR_SELF_REVIEW_BYPASS_REASON` → hook re-blocks with a message
requiring the reason. Successful bypasses are appended to
`.claude/cache/pr-self-review/bypass.log` (timestamp, branch, sha, command,
reason) for audit.

## Why no `check-gate.sh` / `diff-hash.sh` split

- The shell hook can't run the gate itself (shell can't call Claude); it just
  returns `decision: "block"`. The whole gate fits in one file.
- Diff hashing for the cache (`Step 2`) is done **inside the skill** by Claude
  via `git diff … | sha256sum`. There is no shell caller to extract it from.
