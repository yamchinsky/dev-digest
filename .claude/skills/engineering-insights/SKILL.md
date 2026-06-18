---
name: engineering-insights
description: Use during any dev-digest coding session whenever you uncover a non-obvious finding worth preserving — a failure mode that surprised you, a tool/library quirk, an architectural decision made for a non-obvious reason, a recurring error and its fix, or an open question you could not resolve. Appends a single dated entry to the correct INSIGHTS.md (server/, client/, reviewer-core/, e2e/, or repo root) under one of seven fixed sections. Append-only. Skips anything obvious from reading the code.
---

# engineering-insights

Capture loop for non-obvious findings in dev-digest. Reads accumulate via the
`Read INSIGHTS.md…` rule in every `CLAUDE.md`. This skill handles writes.

## When to use

Fire when the current session uncovers something a future session would not
re-derive from the code alone. Each trigger maps to a section:

- A failure mode that surprised you → **What Doesn't Work**
- A pattern/decision that consistently works for non-obvious reasons → **What Works** or **Codebase Patterns**
- A library, framework, or tool quirk → **Tool & Library Notes**
- An error you've now hit more than once + its fix → **Recurring Errors & Fixes**
- A wrap-up of a session ≥ 2 hours with a clear outcome → **Session Notes**
- A question you could not resolve and want the next session to pick up → **Open Questions**

**Do not fire** for: renames, formatting, anything `git blame` would explain,
anything already in a `CLAUDE.md` / `README.md`, transient task state, or
fixed bugs that leave no durable lesson. Silence is a valid session outcome.

## Where to write — module routing

Pick the `INSIGHTS.md` closest to the affected code. **Always exactly one
file per entry**, except for genuinely cross-module findings (write to root,
optionally add a one-line pointer in each touched module).

| Affected path                                       | Target file                  |
|-----------------------------------------------------|------------------------------|
| `server/**`                                         | `server/INSIGHTS.md`         |
| `client/**`                                         | `client/INSIGHTS.md`         |
| `reviewer-core/**`                                  | `reviewer-core/INSIGHTS.md`  |
| `e2e/**`                                            | `e2e/INSIGHTS.md`            |
| repo configs, `specs/`, `scripts/`, ≥ 2 modules     | `INSIGHTS.md` (root)         |

If routing is ambiguous, ask once. Do not guess.

## Entry format

Insert under the matching section heading. Use this exact shape:

```
### <one-line title — present-tense verb phrase, not a topic noun>
_<YYYY-MM-DD>_ · `<file:line>` (or `repo-wide`)

<2–4 sentences. State the failure / decision / quirk and what to do about
it next time. Cold-readable: a stranger should know what to do without
asking follow-ups.>
```

Title rule: `pgvector cosine returns NaN on un-normalized inputs` ✓,
`pgvector` ✗ (topic, not a finding).

## Quality bar — the cold-readable test

> "If this would be obvious to anyone reading the code, don't write it."

Examples (verbatim from the MindStudio guide):

- ❌ "Promises can be tricky."
  ✅ "`Promise.all()` on the ingestion pipeline times out after 30 items.
  Switch to `Promise.allSettled()` with batches of 10."

- ❌ "Use async/await carefully."
  ✅ "Local component state breaks the checkout flow because cart data is
  shared across 3 components. Always use the `cartStore.ts` Zustand store."

If your draft entry reads like the left column, rewrite it or drop it.

## Hard rules (append-only)

1. **Read the target file, find the section heading, insert under it, write
   back.** Never overwrite or reorder existing entries.
2. If the section still has `_None yet._`, **replace that placeholder** with
   the new entry. Once a section has real entries, the placeholder is gone.
3. **One finding per entry.** Don't batch unrelated lessons.
4. **De-dupe before writing.** Grep the target section for the strongest
   keyword in your title. If a related entry already exists, edit the
   existing one rather than adding a near-duplicate.
5. **No retroactive edits to other people's entries** beyond fixing a now-
   wrong fact. If you update an entry, append a `> Updated YYYY-MM-DD:` note
   below it rather than rewriting silently.
6. **0 findings → 0 writes.** Don't pad. Don't invent.

## What NOT to capture

- Anything `git log` / `git blame` / a `README.md` already explains.
- Task progress, PR descriptions, todo state — those live in the PR.
- One-shot bugs where the fix is in the commit and there is no durable
  lesson for the next session.
- Restatements of existing `CLAUDE.md` rules.
- Vague "be careful with X" warnings (see quality bar).

## Limits

Aim to keep each file under ~200 entries. If a file grows past that, split
by sub-domain (e.g. `server/INSIGHTS.embeddings.md`) rather than pruning
aggressively — the value is in long memory, not a tidy file.
