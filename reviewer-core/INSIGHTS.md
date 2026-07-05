# INSIGHTS — `reviewer-core/`

Durable, surprising lessons that bite this module — things that *looked
obvious and weren't*. Append-only. New entries are added by the
`engineering-insights` skill. Read this file before solving a non-obvious
bug or making a "looks obvious" decision in `reviewer-core/`.

## What Works
_None yet._

## What Doesn't Work

### OpenRouter `json_schema, strict: true` is advisory for some models — enforce shape via the prompt, not the schema
_2026-07-02_ · `src/llm/openrouter.ts` (`completeStructured`), bit us in `server/src/modules/onboarding-tours/service.ts`

For models where OpenRouter has no constrained-decoding backend (hit with `deepseek/deepseek-v4-flash`), `response_format: { json_schema, strict: true }` buys valid JSON but NOT the schema: the model returned an object containing only `reading_path` despite five `required` fields, and `minLength` was never enforced (empty strings came back freely). Three consequences, learned on SPEC-02's first live generation, all fixed in cd5a118: (1) the user prompt must enumerate every required field explicitly — a trailing instruction about ONE field makes the model answer with only that field; (2) don't put `min(1)` on LLM-schema strings you can tolerate empty — one `""` fails the whole response after retries; (3) a too-low `max_tokens` surfaces as the SAME "failed schema validation" error (truncated JSON), so bump tokens before blaming the schema. The throw now carries a bounded tail of the raw response — keep that; the failure is undiagnosable without it.

## Codebase Patterns

### `Finding` is imported from `@devdigest/shared`, never redefined locally
_2026-06-19_ · `src/grounding.ts`, `src/output/to-review.ts`, `src/review/reduce.ts`

The engine is "pure" but does **not** own its core `Finding` type — it imports the Zod contract from `@devdigest/shared` (`server/src/vendor/shared/contracts/findings.ts`) and treats it as opaque. If a session needs to add/rename a field on `Finding`, edit the shared contract and both vendored copies (server + client mirror it), not a `reviewer-core`-local type. Same rule applies to `Verdict`, `Agent`, `Severity`, `FindingKind`: shared contracts are the source of truth across all four packages — and the grounding gate (`groundFindings`) is the only place this engine inspects field-by-field, so additions there ripple.

## Tool & Library Notes
_None yet._

## Recurring Errors & Fixes

### Fresh clone/server boot fails with `ERR_MODULE_NOT_FOUND: 'openai'` from `reviewer-core/src/llm/structured.ts`
_2026-07-05_ · `reviewer-core/` (repo bootstrapping)

`server/` resolves `@devdigest/reviewer-core` to `reviewer-core/src` as raw TypeScript via a tsconfig path alias, but `reviewer-core/` is its own npm package with its own `node_modules` — `pnpm install` in `server/` or `client/` never populates it. On a fresh clone (or after any clean), `npm run dev` in `server/` crashes on the first code path touching the review engine, and the error only names `reviewer-core`'s internal file, not "you forgot to install this package." Fix: `cd reviewer-core && npm install`.

## Session Notes
_None yet._

## Open Questions
_None yet._
