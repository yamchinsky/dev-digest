# INSIGHTS — `reviewer-core/`

Durable, surprising lessons that bite this module — things that *looked
obvious and weren't*. Append-only. New entries are added by the
`engineering-insights` skill. Read this file before solving a non-obvious
bug or making a "looks obvious" decision in `reviewer-core/`.

## What Works
_None yet._

## What Doesn't Work
_None yet._

## Codebase Patterns

### `Finding` is imported from `@devdigest/shared`, never redefined locally
_2026-06-19_ · `src/grounding.ts`, `src/output/to-review.ts`, `src/review/reduce.ts`

The engine is "pure" but does **not** own its core `Finding` type — it imports the Zod contract from `@devdigest/shared` (`server/src/vendor/shared/contracts/findings.ts`) and treats it as opaque. If a session needs to add/rename a field on `Finding`, edit the shared contract and both vendored copies (server + client mirror it), not a `reviewer-core`-local type. Same rule applies to `Verdict`, `Agent`, `Severity`, `FindingKind`: shared contracts are the source of truth across all four packages — and the grounding gate (`groundFindings`) is the only place this engine inspects field-by-field, so additions there ripple.

## Tool & Library Notes
_None yet._

## Recurring Errors & Fixes
_None yet._

## Session Notes
_None yet._

## Open Questions
_None yet._
