# CLAUDE.md — `e2e/` conventions

Module-scoped rules for `@devdigest/e2e` — the deterministic browser suite
driven by Vercel **agent-browser**. **How a flow works, the env knobs, the
hermetic runner, and the coverage table live in `README.md`** — this file
holds the "how we write flows here" conventions.

## Read when…

**Read `README.md`** first — it's small and covers spec format, locator
rules, the hermetic runner, env vars, and the coverage table.

**Read `docs/`** for deep dives that don't fit in `README.md`
(`scripts/e2e.sh` mechanics, failure-artifact triage, agent-browser cookbook,
locator strategy notes). Empty until topics get written.

**Read `specs/*.flow.json`** for the canonical pattern; the existing seven
flows are the working spec template.

**Read `INSIGHTS.md`** before solving a non-obvious bug — durable, surprising
lessons that bit this module.

**Read `../TESTING.md`** for the repo-wide test strategy and why this suite
exists alongside vitest/jsdom in `client/`.

**Read `../CLAUDE.md`** for repo-wide globals (no workspace, mixed
pnpm/npm, …) that apply here too.

**Read `run.ts`** when changing the JSON-execution semantics (step wrapping,
`{BASE}` substitution, timeout handling).

## Specs are JSON, not code

Each flow is `specs/NN-name.flow.json`: a `name` + an ordered list of `steps`.
A step's `cmd` is passed verbatim to `agent-browser`; non-zero exit fails the
step and the flow. **Don't** introduce JS test files or wrap flows in a
custom DSL — the JSON-only convention is what keeps the suite hermetic,
diffable, and key-free.

## Deterministic locators only

Allowed locators: `wait --url <re>`, `wait --text <str>`, `find role|text|label`.
**Never** use the agent-browser `chat` command — that would re-introduce a
non-deterministic LLM into the test run.

The assertion vocabulary is essentially `wait --…` (which times out and exits
non-zero if the condition never holds) plus optional `assert.stdoutIncludes`.
That's the entire assertion surface; don't reach for jest-style expects.

## Hermetic runner is the default

Local runs go through `./scripts/e2e.sh`, which boots an isolated stack on
alt ports (`5433/3101/3100`) with a fresh ephemeral Postgres. Flow `02`
follows the home redirect to the **first** repo and assumes the seeded demo
is the only one — true on the hermetic stack, **not** true on a typical dev
DB. Don't suggest "just run it against your dev stack" unless you've
verified the dev DB has only the seeded repo.

## NEVER `docker compose down -v` to "reset" anything

`-v` deletes the `devdigest_pgdata` volume along with every real repo and
review the user imported. The hermetic runner uses its own ephemeral
container, never the dev volume. If a flow fails because of dev-DB drift,
the fix is "use the hermetic runner", not "wipe the volume".

## Flows target read-only seeded data

Canonical fixtures: `acme/payments-api`, PR `#482`, the two seeded reviewer
agents. Flows must not POST to LLM-backed endpoints or mutate state that
later flows depend on — order independence keeps debugging sane. If a new
flow needs mutation, isolate it (own seed, own teardown).

## Templating: `{BASE}` only

`run.ts` substitutes `{BASE}` with `E2E_BASE_URL`. Don't add new template
vars unless the use case is general (multiple flows, not one). New vars must
be documented in `README.md` env knobs.

## Failure artifacts

Screenshots and traces go to `e2e/test-results/` (git-ignored, uploaded by
`.github/workflows/e2e-web.yml` as a CI artifact). Don't add a separate dir;
CI is wired to this path.

## Package manager: npm (not pnpm)

This package commits `package-lock.json`. **Don't** `pnpm install` here —
same rationale as `reviewer-core/`. The repo's mixed-package-manager note in
`../CLAUDE.md` also applies.

## agent-browser is a CLI, not a framework

This package exists to add the JSON-flow convention on top of an
automation CLI. Don't try to replace agent-browser with Playwright /
Cypress / WebdriverIO — the deterministic, native-CDP, key-free property is
the point. New ergonomics belong in `run.ts` (the convention runner), not in
a new framework dependency.

## How to grow this file

- **New convention?** → add a section here.
- **One-off surprise / "looked obvious and wasn't"?** → append an entry to
  `INSIGHTS.md`.
- **Topic outgrowing this file?** → promote to `docs/<topic>.md` and link it
  from the `Read … when …` block above.
- **New flow type / fixture?** → add it under `specs/` (a new `NN-*.flow.json`
  for a flow, or a sibling doc in `docs/` for shared fixtures).
