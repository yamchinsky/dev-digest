# server/specs/

Module-owned contracts and fixtures:

- route-level Zod schemas in narrative form (`POST /pulls/:id/review`, …),
- the structured-error envelope (`ApiErrorBody`),
- example payloads for run lifecycle / SSE event streams,
- LLM/repo-intel fixtures shared by the integration suite that aren't TS.

Code-defined contracts (`@devdigest/shared`, route zod schemas) stay in code;
this folder is the human-readable mirror + rationale.
