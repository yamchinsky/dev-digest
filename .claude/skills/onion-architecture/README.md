# Onion Architecture skill

A Claude Code skill providing **layering and dependency-rule conventions** for the DevDigest backend — both `server/` (Fastify 5 + Drizzle) and `reviewer-core/` (the pure review engine).

## Version

**0.1.0** — initial release, 2026-06-20.

## Focus

This skill answers two questions for backend code:

1. **Where does this file live?** — route vs service vs repository vs adapter vs platform vs shared contract vs reviewer-core internal.
2. **Which way may dependencies point?** — the Dependency Rule applied to the actual file paths and package boundaries in this repo.

It codifies the **existing** DevDigest pattern (feature-modular outside, onion-layered inside) — it does **not** mandate a refactor toward classical `domain/application/infrastructure/presentation` rings, and it does **not** push a DI framework. Decisions confirmed with the maintainer (2026-06-20).

**In scope:**
- The DevDigest-Onion four-ring model (domain core / application / infrastructure / presentation) mapped to actual repo paths
- The non-negotiable `routes.ts` / `service.ts` / `repository.ts` triple inside each `modules/<name>/`
- Ports & adapters: when to add a port, where the interface lives (`@devdigest/shared`), where the concrete adapter lives, how it's wired in `Container`, how it's mocked
- Zod three-way split (transport DTO vs domain invariant vs adapter decoder)
- `reviewer-core` purity invariants (no fs, no env, no DB, no Fastify; outbound only via injected ports)
- DI via the single composition root (`server/src/platform/container.ts`); explicit rejection of decorator-DI inside `reviewer-core`
- Cross-package boundary rules (tsconfig path aliases, ESM `.js` suffix, TS-source consumption, mixed npm/pnpm)
- Testing-tier mapping to the `*.it.test.ts` filename convention
- Escape hatch for true CRUD where Onion is overkill
- Common pitfall catalog

**Out of scope:**
- Fastify runtime patterns — request lifecycle, hooks, plugins, serialization (see `fastify-best-practices`)
- Drizzle query syntax, schema definition, migrations (see `drizzle-orm-patterns`, `postgresql-table-design`)
- Zod schema mechanics — `safeParse`, refinements, `z.infer` (see `zod`)
- Frontend / `client/` organization (see `frontend-architecture`)
- Type-level programming (see `typescript-expert`)
- Anthropic SDK / prompt caching mechanics (see `claude-api`)
- Security review (see `security`, `security-review`)

## When this skill triggers

Phrases that should activate it (matched against the skill description):

- "where should I put X" / "where does this go" (backend context)
- "add a new module" / "new endpoint" / "new repository" / "new adapter"
- "wire up a port" / "register a service"
- "consume X from a service"
- "reviewer-core needs to read [a file / env var / DB]"
- "service is doing too much"
- "should this be in the route or the service"
- "Drizzle in a service" / "Octokit in a route" / layering violations
- Any code edit under `server/src/` or `reviewer-core/src/`

## Use cases

1. Adding a new feature module from scratch
2. Adding a new outbound integration (DB, HTTP, LLM, GitHub, fs)
3. Deciding the placement of a single new file in the backend
4. Reviewing a backend PR for layer violations
5. Extending `reviewer-core` without breaking its purity
6. Settling a "should this be a service or a route" debate

## Relationship to other skills (no overlap)

| Skill | Focus | This skill differs by |
|---|---|---|
| `fastify-best-practices` | Fastify lifecycle, plugins, hooks, schema validation **mechanics**, error handling **mechanics** | **No** Fastify runtime patterns; only where the route file lives and what it may import |
| `drizzle-orm-patterns` | Drizzle query syntax, schema, relations, transactions, migrations | **No** query syntax; only where the Drizzle import is allowed |
| `postgresql-table-design` | Postgres schema design, indexing, constraints | Not schema design |
| `zod` | Zod schema mechanics: `safeParse`, refinements, error handling | **No** Zod syntax; only which **purpose** of schema goes **where** |
| `typescript-expert` | Type-level programming, monorepo management | Not types |
| `claude-api` / `react-best-practices` / others | Domain-specific best practices | Layering only, agnostic to the SDK / library |
| `frontend-architecture` | Same questions for the client side | This skill is the backend mirror |

If a question is purely about structure, this skill is primary. If it's a mix (e.g. "where do I put a new Anthropic-calling endpoint and how do I cache prompts"), multiple skills may load — `onion-architecture` answers *where* (port in `adapters/llm/`, service orchestrates, route is thin), `claude-api` answers *how the SDK call is shaped*.

## Files

- `SKILL.md` — main rules with severity tags (CRITICAL / HIGH / MEDIUM). Loaded when the skill triggers.
- `examples.md` — concrete code skeletons (new module, new port, extending `reviewer-core` purely). Loaded on demand.
- `README.md` — this file: meta, version, sources, scope boundaries. Not loaded into Claude's context; reference for humans maintaining the skill.

## Maintenance

When updating the skill:
- Bump the `version` field in `SKILL.md` frontmatter and the **Version** section above.
- Add a row to **Version history**.
- Add any new sources used to the **Sources** section, preserving URL verbatim.
- If the repo's conventions diverge from the skill, **update the skill** (or update the repo) rather than letting them drift.

---

## Sources

All sources used to derive the rules in `SKILL.md`. URLs preserved verbatim.

### Onion Architecture — canonical

- [The Onion Architecture: Part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — Jeffrey Palermo, 2008. Origin of the term; the four-ring diagram.
- [The Onion Architecture: Part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/) — Palermo, 2008. Layer responsibilities.
- [The Onion Architecture: Part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/) — Palermo, 2008. The four tenets, including "all application core code can be compiled and run separate from infrastructure" — the rule that justifies `reviewer-core`'s purity.
- [DDD, Hexagonal, Onion, Clean, CQRS, … How I put it all together — Herberto Graça, 2017](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/) — the most-cited modern synthesis ("Explicit Architecture") showing how Onion overlaps with Hex (Ports & Adapters) and Clean.
- [Hexagonal vs Onion vs Clean — buarki on DEV](https://dev.to/buarki/hexagonal-vs-onion-vs-clean-architecture-1ld7) — practical TS-flavored comparison.

### Domain modeling & anti-patterns

- [AnemicDomainModel — Martin Fowler](https://martinfowler.com/bliki/AnemicDomainModel.html) — why bare types + all-logic-in-services is an anti-pattern, and when it's tolerable.
- [Clean Node.js Architecture — Khalil Stemmler](https://khalilstemmler.com/articles/software-design-architecture/organizing-app-logic/) — pragmatic TS take; the "where does this logic go" decision tree behind §4 of `SKILL.md`.

### Fastify & DI in TypeScript

- [`@fastify/awilix`](https://github.com/fastify/fastify-awilix) — official awilix integration; the path we'd take if/when request-scoped DI becomes necessary. Currently we use a manual composition root and this skill explicitly recommends keeping it that way.
- [marcoturi/fastify-boilerplate](https://github.com/marcoturi/fastify-boilerplate) — Fastify 5 vertical-slice-onion+CQRS reference, with `dependency-cruiser` boundary enforcement. Inspiration for the structural anti-patterns in §11.
- [revell29/fastify-clean-architecture](https://github.com/revell29/fastify-clean-architecture) — horizontal four-ring split. Considered and rejected for DevDigest in favor of codifying the existing vertical pattern (per the maintainer's decision).
- [borjatur/clean-architecture-fastify-mongodb](https://github.com/borjatur/clean-architecture-fastify-mongodb) — minimal `core/` vs `infrastructure/` reference.

### Repo's own authoritative conventions

These are not external sources but they are the **primary** source of truth — the skill defers to them and must stay consistent.

- `CLAUDE.md` / root `AGENTS.md` — pointer map, package layout, package-manager split, ESM `.js` suffix rule.
- `server/AGENTS.md` — module shape (`routes.ts` / `service.ts` / `repository.ts`), `getContext`, `AppError` taxonomy, embeddings gate, boot reaper.
- `reviewer-core/AGENTS.md` — purity rules, grounding gate, structural INJECTION_GUARD, public surface via `src/index.ts`, npm-not-pnpm, build = typecheck.
- `TESTING.md` — the `*.it.test.ts` split that §9 maps onto.

If any of those files contradict the skill, the AGENTS.md / INSIGHTS.md / TESTING.md files win — open a PR to update `SKILL.md` and bump the version.

### Conflicting opinions / open questions

(Material for future skill iterations.)

- **Vertical slices vs horizontal rings** — marcoturi/fastify-boilerplate stacks vertical slices over an onion core; revell29/fastify-clean-architecture is purely horizontal. DevDigest chose vertical (`modules/<name>/`) before this skill existed; we codified it.
- **DI framework or not** — awilix gives request-scoped DI; manual composition is simpler and greppable. Skill keeps the manual approach until there's a concrete request-scoped need.
- **Where domain Zod lives** — could be in `reviewer-core/` (closer to the engine) or in `@devdigest/shared` (consumed by both). Repo chose `@devdigest/shared`; skill follows.
- **One repository class vs split per aggregate** — `reviews` already splits (`repository/review.repo.ts` + `run.repo.ts` + `pull.repo.ts`), other modules don't. Skill leaves it as a threshold judgment (composed when >1 aggregate).

---

## Version history

- **0.1.0 (2026-06-20)** — initial release. Sourced from Palermo's 2008 Onion Architecture series, Herberto Graça's 2017 "Explicit Architecture" synthesis, Fowler's `AnemicDomainModel`, Khalil Stemmler's clean-Node materials, the `@fastify/awilix` docs, the marcoturi/revell29/borjatur Fastify references, and — most importantly — the repo's own `AGENTS.md` / `INSIGHTS.md` / `TESTING.md` files. Decisions confirmed with the maintainer the same day.
