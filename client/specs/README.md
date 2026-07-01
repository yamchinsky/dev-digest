# client/specs/

Module-owned contracts and fixtures consumed by the UI:

- DTO snapshots used by hook tests,
- `messages/<locale>/*.json` namespaces and i18n key conventions,
- example agent / finding / run fixtures rendered by jsdom tests.

Code-defined types come from `@devdigest/shared`; this folder is the
human-readable mirror + fixture set.

Also home to **single-module SDD feature specs** (`SPEC-NN-*.md`) written by
the `spec-creator` skill; cross-module specs live in repo-root `specs/`.

## Spec index

<!-- one line per spec, appended by spec-creator -->
