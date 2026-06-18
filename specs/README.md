# specs/ — cross-module contracts

Contracts and fixtures that don't belong to a single module:

- shared Zod contracts mirrored for human review,
- JSON Schema versions of the API envelope,
- example request/response payloads used by multiple modules,
- golden outputs / fixtures shared by tests across packages.

Module-owned specs live under `<module>/specs/`. Code-defined contracts (e.g.
`@devdigest/shared`) stay in code; this folder holds the human-readable
mirror, design rationale, and fixtures that aren't checked-in TS.

Link new files from `CLAUDE.md` via the `Read … when …` block so they
actually get read.
