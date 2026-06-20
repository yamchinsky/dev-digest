# AGENTS.md — `reviewer-core/` conventions

Module-scoped rules for `@devdigest/reviewer-core` — the pure review engine
shared by the studio (server) and the future CI runner. **The pipeline
overview, public API surface, and the optional prompt slots fed by later
lessons live in `README.md`** — this file holds the "how we write engine code
here" conventions.

## Read when…

**Read `README.md`** before reasoning about the pipeline
(`assemblePrompt → wrapUntrusted → LLM → structured → groundFindings`) or
which exports a consumer is allowed to depend on.

**Read `docs/`** for deep dives that don't fit in `README.md`
(prompt-internals, grounding-gate reasoning, INJECTION_GUARD threat model,
map-reduce orchestration, structured-output repair). Empty until topics get
written.

**Read `specs/`** when you touch the `Review`/`Finding`/`Verdict` shape,
INJECTION_GUARD text, golden prompts, or golden LLM responses.

**Read `INSIGHTS.md`** before solving a non-obvious bug — durable, surprising
lessons that bit this module.

**Read `../TESTING.md`** before adding **any** test in this package.

**Read `../AGENTS.md`** for repo-wide globals (no workspace, mixed
pnpm/npm, …) that apply here too.

**Read `src/index.ts`** to see the entire public API surface (the engine's
contract with its consumers).

## Pure engine — no I/O

No filesystem, no DB, no GitHub, no network beyond the **injected**
`LLMProvider`. No `process.env` reads. Inputs are arguments, outputs are
return values, the one side effect is the LLM call through the port. If you
need to read a file or call out, the caller does it and passes the result in.

This is what makes the engine mock-testable and re-usable from the CI runner.
Don't break it for ergonomics.

## Public API surface = `src/index.ts`

Consumers (server, future CI runner) import from `@devdigest/reviewer-core`,
which resolves via tsconfig path alias to `../reviewer-core/src` — they read
**TypeScript source**, not built JS. Two consequences:

1. Adding/removing/renaming an export in `src/index.ts` is a breaking change
   for the server. Coordinate (search `server/src` for the symbol first).
2. Anything not re-exported from `src/index.ts` is module-internal — don't
   reach into a consumer at `reviewer-core/src/llm/openrouter` directly.

## Grounding gate is mandatory

`groundFindings` is the chokepoint between model output and persisted
findings. Every finding must cite a real diff line; survivors set the score
(`groundingSummary` recomputes it). **Never** return or persist a finding
that didn't pass; never trust the model's self-reported score.

If a new pipeline stage needs to skip grounding for a good reason, surface
that as an explicit option on `reviewPullRequest` and document the trade-off
in `docs/` — don't sneak around the gate.

## INJECTION_GUARD is structural, not keyword-based

`assemblePrompt` always appends INJECTION_GUARD to the system prompt. The
defense is "untrusted content = data, never instructions" plus the rule that
claims of *intentional / demo / test / not for production / do not flag*
never descope the review. Apply at full severity regardless.

Don't add a denylist scan of PR text — a single-language word filter is
brittle and easy to bypass. Strengthening the guard means strengthening the
text, not adding pattern matchers.

## Structured output via Zod → JSON Schema

LLM responses use `toJsonSchema(zodSchema)` for the model contract and
`parseWithRepair` for tolerant parsing (handles trailing commas, code fences,
duplicate keys). Don't ask the model for "JSON" without a schema, and don't
roll your own JSON repair — extend `parseWithRepair` if needed.

## Optional prompt slots are intentionally optional

`PromptParts` includes `skills`, `memory`, `specs`, `callers`. The starter
omits them; later lessons fill them. `assemblePrompt` must silently skip an
empty section (no headers, no placeholder text). Don't tighten this; the
lesson seam depends on it.

## Package manager: npm (not pnpm)

This package commits `package-lock.json`. **Don't** `pnpm install` here —
that would create a divergent `pnpm-lock.yaml` and break the npm-based
consumer (the CI runner). The repo's mixed-package-manager note in
`../AGENTS.md` also applies.

## Build is a typecheck — no JS emit

`npm run build` runs `tsc --noEmit`. Consumers read the TS source directly.
Don't add `tsc -p` to `dist/` or change `build` to emit; the runner uses
`@vercel/ncc` to bundle, not this package's output.

## Tests: hermetic with a stubbed `LLMProvider`

Vitest only. No keys, no network. Use a stub provider that returns a
deterministic response; `test/run.test.ts` is the reference pattern. Don't
add a "real OpenAI" test path — that belongs in the consumer's integration
suite.

## `OpenRouterProvider` lives here

The shared OpenAI-compatible structured provider — used both by the server's
openrouter path and by the future CI runner — is exported from
`@devdigest/reviewer-core`, not from `server/src/adapters/llm/`. The server's
`Container.buildLlm` constructs it with a `PriceBook`-backed `estimateCost`
callback. Don't duplicate it on the server side.

## How to grow this file

- **New convention?** → add a section here.
- **One-off surprise / "looked obvious and wasn't"?** → append an entry to
  `INSIGHTS.md`.
- **Topic outgrowing this file?** → promote to `docs/<topic>.md` and link it
  from the `Read … when …` block above.
- **New contract / fixture?** → add it under `specs/` with a short doc.
