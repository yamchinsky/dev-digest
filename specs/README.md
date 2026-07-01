# specs/ — cross-module contracts & feature specs

Two kinds of files live here.

## Contracts and fixtures that don't belong to a single module

- shared Zod contracts mirrored for human review,
- JSON Schema versions of the API envelope,
- example request/response payloads used by multiple modules,
- golden outputs / fixtures shared by tests across packages.

Module-owned specs live under `<module>/specs/`. Code-defined contracts (e.g.
`@devdigest/shared`) stay in code; this folder holds the human-readable
mirror, design rationale, and fixtures that aren't checked-in TS.

## SDD feature specs (`SPEC-NN-*.md`)

Spec-Driven Development specifications that touch **two or more modules**
(single-module specs live in `<module>/specs/`). Written by the
`spec-creator` skill (`.claude/skills/spec-creator/` — template and EARS
guide live there); consumed downstream by the `implementation-planner` agent
(spec → plan → implementation).

Conventions:

- Filename: `SPEC-NN-YYYY-MM-<slug>.md`; `NN` is a **global** sequence across
  all `specs/` folders.
- Body in English; acceptance criteria in EARS form with stable `AC-<n>` IDs.
- `Status: draft → approved → implemented`; `approved` requires zero
  `[NEEDS CLARIFICATION]` entries.

### Index

<!-- one line per spec, appended by spec-creator -->
- [SPEC-01 — Project Context Folder](SPEC-01-2026-07-project-context-folder.md) — attach repo markdown specs/docs/insights to agents and skills so reviewers enforce project contracts, not just generic best practices (approved)

Link new files from `AGENTS.md` via the `Read … when …` block so they
actually get read.
