# reviewer-core/specs/

Module-owned contracts and fixtures:

- the `Review` / `Finding` / `Verdict` shape (mirrored from `@devdigest/shared`),
- INJECTION_GUARD text + the threat cases it covers,
- golden prompts (assembled output for canonical inputs),
- golden LLM responses driving the structured-output / grounding tests.

Keep golden fixtures small and commented — they're the test bench for the
gate logic and shouldn't drift silently.

Also home to **single-module SDD feature specs** (`SPEC-NN-*.md`) written by
the `spec-creator` skill; cross-module specs live in repo-root `specs/`.

## Spec index

<!-- one line per spec, appended by spec-creator -->
