---
name: plan-verifier
description: >
  Use to verify that an implemented change satisfies every requirement and
  acceptance criterion of a Development Plan in `docs/plans/<feature>.md`.
  Trigger phrases: 'verify the plan', 'did we cover all requirements',
  'requirement coverage', 'check plan against code'.
  Read-only; complements pr-self-review (quality) and architecture-reviewer
  (structure) — this one is COVERAGE.
allowed-tools: Read, Grep, Glob, Bash
---

# plan-verifier

Requirement-coverage checker for DevDigest Development Plans. Given a
`docs/plans/<feature>.md` and the implemented code in the tree, it maps
every Requirement ID and measurable acceptance criterion to **concrete
evidence** (file:line, test name, route, migration, schema field) and
emits a **coverage matrix** with an overall verdict.

This skill is **coverage-only**: it does NOT assess code quality (that is
`pr-self-review`) and it does NOT assess architectural layering (that is
`architecture-reviewer`). It answers exactly one question: *"Is every
stated requirement provably present in the code?"*

## When to use

Fire on any of:

- User asks via trigger phrases: "verify the plan", "did we cover all
  requirements", "requirement coverage", "check plan against code", or
  any phrasing meaning "check that the implementation satisfies the plan".
- After an implementer completes a wave of tasks and you want to confirm
  completeness before opening a PR.
- Before closing a milestone — confirm R-IDs are not silently skipped.

Do **not** fire as a substitute for `pr-self-review` (code quality / style
/ security) or for `architecture-reviewer` (layering, coupling, onion rings).

## 1. Inputs

The skill requires two things:

1. **The plan file** — `docs/plans/<feature>.md`. If the caller does not
   name one, infer from the current branch name or ask once.
2. **The implemented code tree** — read the owned paths listed under each
   task in the plan; also optionally `git diff origin/main...HEAD` for
   recently changed files.

Parse the plan for:

- **Requirements table** — columns `ID | Requirement | Acceptance criteria
  (measurable)`. Each row yields one or more verifiable sub-criteria.
- **Tasks section** — `### T<N> — … · Owned paths` and `Acceptance` lines.
  Owned paths tell you exactly which files each task should have created
  or modified.

Both the Requirements table and the Tasks section are the authoritative
checklist. If the plan uses the standard planner output contract (see
`planner.md`), these two structures will always be present.

## 2. Traceability procedure

For **each Requirement ID** and **each measurable acceptance criterion**
under it:

1. **Extract the criterion text** verbatim from the plan.
2. **Identify evidence kinds** the criterion implies:
   - Code constructs (function name, exported symbol, route path, Zod
     schema, hook name, component, env var)
   - Tests (test file name / `it(…)` description that exercises this path)
   - DB artifacts (migration file name, schema table/column, index)
   - Config / file existence (a file at a specific path, a frontmatter
     field, a registry entry)
3. **Search for each kind** using read-only tools:
   - `Grep` / `rg` for symbols, strings, import paths
   - `Glob` for file existence checks
   - `Read` for structural verification (frontmatter, section headings,
     table rows)
   - Read-only `Bash` (`git diff`, `git log --oneline`, `rg`) for diff
     scope or commit evidence
4. **Record the evidence location** as `path:line` (or test name, or
   migration filename). Quote the exact line or heading that satisfies the
   criterion.
5. **Never assert evidence you did not locate.** If a search returns
   nothing, status is MISSING (or PARTIAL if some sub-criteria found);
   do not infer "it must be there somewhere".

Use `typescript-expert` as a supporting lens when a criterion requires
judging whether a TypeScript type, interface, or Zod schema is correctly
declared — but only to read and interpret, never to run `tsc`.

## 3. Status rubric

Assign exactly one status per criterion:

| Status | Meaning |
|--------|---------|
| **COVERED** | All verifiable sub-criteria have concrete `path:line` (or equivalent) evidence. |
| **PARTIAL** | Some sub-criteria are evidenced; at least one is not found or incomplete. State which sub-criteria are missing. |
| **MISSING** | No evidence found for the criterion. Distinguish: "not implemented" (owned paths exist but lack the feature) from "could not locate" (owned paths themselves are absent or the search was inconclusive). |

A criterion that is structurally impossible to search (e.g. "works under
load") → mark PARTIAL with a note: *"runtime assertion; static evidence
not available."*

## 4. Complementarity — coverage, not quality

This skill is deliberately narrow:

- **Coverage only.** A piece of code that is present but poorly written
  is COVERED by this skill's metric. Quality defects go to `pr-self-review`.
- **No layering judgment.** A function found in the wrong architectural
  layer still counts as COVERED for requirement purposes. Layer violations
  go to `architecture-reviewer`.
- **Supporting lenses.** Other repo skills (e.g. `typescript-expert`,
  `onion-architecture`) may be used as lenses to decide whether evidence
  genuinely satisfies a criterion — e.g. to confirm a Zod schema matches a
  stated contract shape. They are informational, not the primary checklist.
- **No fix suggestions.** If a criterion is MISSING or PARTIAL, report the
  gap clearly; do not suggest how to fix it. Fixes belong in a follow-up
  implementer run.

## 5. Output contract — coverage matrix

Produce the report in this exact structure:

```
# Plan coverage: <feature>

**Plan file:** `docs/plans/<feature>.md`
**Verdict:** ALL COVERED | GAPS FOUND (N partial, M missing)

## Coverage matrix

| Req ID | Criterion (abbreviated) | Status | Evidence |
|--------|------------------------|--------|----------|
| R1     | frontmatter name field  | COVERED | `.claude/agents/foo.md:2` — `name: foo` |
| R2     | read-only tools         | COVERED | `.claude/agents/foo.md:4` — `tools: Read, Grep, Glob, Bash` |
| R3     | output contract present | PARTIAL | Section heading found at `foo/SKILL.md:45`; example sub-section absent |
| R4     | migration exists        | MISSING | No file matching `server/src/db/migrations/*foo*` found |

## Gaps (PARTIAL / MISSING)

### R3 — <criterion text>
Status: PARTIAL
Found: `foo/SKILL.md:45` — section heading present.
Missing: The "worked example" sub-section called for in the acceptance criterion.

### R4 — <criterion text>
Status: MISSING (not implemented)
Search: `Glob("server/src/db/migrations/*foo*")` → 0 results.
Note: Owned paths for T2 (`server/src/db/migrations/`) are absent from the tree.
```

Fields in the matrix:
- **Req ID** — the `R<N>` identifier from the plan.
- **Criterion** — abbreviated to ~60 chars; full text in the Gaps section.
- **Status** — COVERED / PARTIAL / MISSING.
- **Evidence** — `path:line` and a quoted fragment, OR a test name, OR
  a migration filename, OR an explanation of why evidence cannot be located.

End the report with:
- **Verdict line** — `ALL COVERED` if every row is COVERED; otherwise
  `GAPS FOUND` with a count of PARTIAL and MISSING rows.
- **Gaps section** — one sub-section per non-COVERED row, with the full
  criterion text, what was found, and what is still absent.

## 6. Read-only stance

This skill **never edits, creates, or deletes files**. `allowed-tools` is
limited to `Read, Grep, Glob, Bash` (read-only Bash: `git diff`, `git log`,
`rg`, `ls`, `find`). No `Write`, no `Edit`.

If a criterion is unmet, the skill reports the gap. The caller decides
whether to open a follow-up implementer task or accept the gap.

## Hard rules

1. **Never assert unlocated evidence.** If a search returns nothing, status
   is MISSING or PARTIAL — never COVERED on inference alone.
2. **Every row in the matrix must have a concrete Evidence value.** A row
   with `Evidence: assumed present` is invalid; mark PARTIAL and explain.
3. **One row per measurable sub-criterion, not per Requirement.** If R1 has
   three verifiable sub-criteria, produce three rows (all labeled R1).
4. **Do not conflate coverage with quality.** A poorly-written but present
   feature is COVERED. Do not add quality findings; send those to
   `pr-self-review`.
5. **Do not conflate coverage with structure.** A correctly implemented
   feature placed in the wrong layer is COVERED. Send layer violations to
   `architecture-reviewer`.
6. **No fixes.** Report gaps; do not suggest implementation paths.
7. **One plan per invocation.** If the user names multiple plans, ask
   which one to verify first; do not merge two plans' matrices.

## Based on

Sources that shaped this skill's traceability rationale and procedure:

- `.claude/agents/planner.md` — the Requirements table (ID + measurable
  acceptance criteria) and Tasks (Owned paths + Acceptance) are the exact
  structures this skill parses as its input contract.
- Plan-Verifier findings from the `agent-skill-fleet` plan
  (`docs/plans/agent-skill-fleet.md`) — R3 acceptance criteria and the
  "Verification per task → T3" section define the coverage-matrix output
  contract, status rubric, and read-only `allowed-tools` constraint.
- https://code.claude.com/docs/en/skills — Claude Code skill mechanics:
  frontmatter, `allowed-tools`, `description` trigger phrases, and the
  `SKILL.md` + supporting-file progressive-disclosure pattern.

## Language

Write the **report content in English**. If you address the user directly,
do so in **Ukrainian**.
