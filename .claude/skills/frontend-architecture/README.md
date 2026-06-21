# Frontend Architecture skill

A Claude Code skill providing folder structure and code organization rules for React + Next.js (App Router) projects.

## Version

**0.1.0** — initial release, 2026-06-20.

## Focus

This skill answers **"where do I put this file?"** questions for a React or Next.js codebase. It is intentionally narrow.

**In scope:**
- Top-level folder structure (`src/`, `app/`, `features/`, `components/`, `hooks/`, `lib/`, `utils/`, …)
- Feature-based vs layer-based vs atomic design — when to use each
- Co-location of components, tests, styles, sub-components
- Where constants, types, utils, helpers, lib, services live (and why)
- Business-logic placement: hooks vs services vs `lib/`
- Component breakdown: when to split, where the sub-component goes, naming
- Next.js App Router specifics: private folders (`_components`), route groups (`(name)`), non-route code placement

**Out of scope:**
- React patterns and anti-patterns (see `react-best-practices`)
- Next.js runtime behavior — RSC boundaries, data patterns, runtime selection, bundling (see `next-best-practices`)
- Styling, testing, type-level programming (see dedicated skills)

## When this skill triggers

Phrases that should activate it (matched against the skill description):
- "where should I put X"
- "folder structure" / "project structure" / "directory structure"
- "how to organize my React/Next project"
- "utils vs helpers" / "utils vs lib"
- "where do constants go"
- "how to break this component down"
- "app router structure" / "private folders" / "route groups"

## Use cases

1. Setting up a new React or Next.js project
2. Refactoring a project that has outgrown its initial layout
3. Deciding the placement of a single new file
4. Reviewing a PR where files are added or moved
5. Settling a "where does this go" debate with concrete decision rules

## Relationship to other skills (no overlap)

| Skill | Focus | This skill differs by |
|---|---|---|
| `react-best-practices` | Component design, hook rules, anti-patterns (derive-don't-store, render factories, memoization) | **No** patterns or anti-patterns; only file placement |
| `next-best-practices` | RSC boundaries, data patterns, async APIs, metadata, bundling, runtime selection | **No** runtime / RSC semantics; only routing folder organization |
| `react-testing-library` | RTL queries, async patterns, mocking | Not testing |
| `typescript-expert` | Type-level programming, monorepo management | Not types |

If a question is purely about structure, this skill is primary. If it's a mix (e.g. "where do I put a server action and how does it work"), multiple skills may load — `frontend-architecture` answers *where*, `next-best-practices` answers *how it runs*.

## Files

- `SKILL.md` — main rules with severity tags (CRITICAL/HIGH/MEDIUM). Loaded when the skill triggers.
- `examples.md` — concrete folder-tree examples (small Vite app, mid-size Next.js, bulletproof-react style). Loaded on demand.
- `README.md` — this file: meta, version, sources. Not loaded into Claude's context; reference for humans maintaining the skill.

## Maintenance

When updating the skill:
- Bump the `version` field in `SKILL.md` frontmatter and the **Version** section above
- Add a row to **Version history**
- Add any new sources used to the **Sources** section, preserving URL verbatim

---

## Sources

All sources used to derive the rules in `SKILL.md`. URLs are preserved verbatim. Grouped by the 8 sections of the skill.

### 1. Top-level folder structure

- [Getting Started: Project Structure (Next.js docs)](https://nextjs.org/docs/app/getting-started/project-structure) — Vercel / Next.js team. The canonical reference: top-level folders, reserved files, naming, and `src/` conventions.
- [File-system conventions: src (Next.js docs)](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder) — Vercel. Rules for placing `app/` under `src/`, and how `src/app` interacts with root `app/`.
- [React Folder Structure Best Practices [2026] — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/) — Robin Wieruch, 2026. The 5-step progression: one file → multiple files → folders → technical folders → feature folders.
- [bulletproof-react: project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — Alan Alickovic. Canonical reference layout: `app/`, `features/`, shared `components/`, `hooks/`, `lib/`, `stores/`, `types/`, `utils/`, plus ESLint `import/no-restricted-paths` to enforce boundaries.
- [React project structure for scale: decomposition, layers and hierarchy — Developer Way](https://www.developerway.com/posts/react-project-structure) — Nadia Makarevich. Thinks of the app as packages with data/UI/shared layers.
- [example-react-project (Developer Way)](https://github.com/developerway/example-react-project) — Companion repo to the article above.
- [The Ultimate Guide to Organizing Your Next.js 15 Project Structure — Wisp CMS](https://www.wisp.blog/blog/the-ultimate-guide-to-organizing-your-nextjs-15-project-structure) — 2025. Concrete `src/app + src/components + src/lib + src/utils` layout.
- [Next.js 16 App Router Project Structure: The Definitive Guide — Makerkit](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure) — Giancarlo Buomprisco, 2026. End-to-end opinionated layout for App Router.
- [How to structure your React projects — Sandro Roth](https://sandroroth.com/blog/project-structure/) — Practical mid-size layout pairing `components/`, `features/`, `lib/`.

### 2. Feature-based vs layer-based vs atomic design

- [Screaming Architecture — Evolution of a React folder structure (DEV)](https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25) — Johannes Kettmann.
- [Screaming Architecture (mirror, profy.dev)](https://profy.dev/article/react-folder-structure) — Same article on the author's site.
- [Feature-based React Architecture — Robin Wieruch](https://www.robinwieruch.de/react-feature-architecture/) — Why feature folders win for large apps.
- [Feature-Sliced Design — official site](https://feature-sliced.design/) — Strict layered methodology.
- [The Perfect Folder Structure for Scalable Frontend — FSD blog](https://feature-sliced.design/blog/frontend-folder-structure) — FSD layers: `app`, `pages`, `widgets`, `features`, `entities`, `shared`.
- [Atomic Design Pattern: How to set up your Reactjs Project Structure — DEV](https://dev.to/mroman7/atomic-design-pattern-how-to-set-up-your-reactjs-project-structure-44pm) — Atoms/molecules/organisms in React.
- [Atomic Design in React: Build Scalable Component Libraries — propelius.tech](https://propelius.tech/blogs/atomic-design-in-react-best-practices/) — Includes criticism: ambiguous boundaries.
- [A Better Way to Structure React Projects — DEV (Kris Guzman)](https://dev.to/krisguzman_dev/a-better-way-to-structure-react-projects-96a) — Critique of pure atomic design + alternative.
- [Production-Grade React Project Structure — DZone](https://dzone.com/articles/production-grade-react-project-structure) — Layered vs feature-based for production.
- [bulletproof-react is a hidden treasure — DEV (meijin)](https://dev.to/meijin/bulletproof-react-is-a-hidden-treasure-of-react-best-practices-3m19) — Why feature-based won mindshare.

### 3. Co-location

- [Colocation — Kent C. Dodds](https://kentcdodds.com/blog/colocation) — The canonical "place code as close to where it's relevant as possible" essay.
- [State Colocation will make your React app faster — Kent C. Dodds](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) — Same principle applied to state.
- [Locality of Behavior / Co-location — Matias Kinnunen](https://mtsknn.fi/blog/locality-of-behavior-and-co-location/) — Generalises the principle beyond React.
- [Delightful React File/Directory Structure — Josh W. Comeau](https://www.joshwcomeau.com/react/file-structure/) — `Button/index.js` re-exporting `Button.js` + colocated styles, tests, helpers.
- [joshwcomeau/new-component CLI](https://github.com/joshwcomeau/new-component) — Companion CLI scaffolder.
- [Screaming Architecture & Colocation — The T Shaped Dev](https://thetshaped.dev/p/screaming-architecture-and-colocation-nodejs-typescript-react) — Practical recipe combining both.
- [The Best File Structure for Your React Components — freeCodeCamp](https://www.freecodecamp.org/news/best-file-structure-for-react-components/) — Walkthrough of colocated component folders.
- [Barrel Pattern and Direct File Naming Approach — Codevertiser](https://www.codevertiser.com/react-components-folder-structure-naming-patterns/) — Compares `ComponentName/index.tsx` vs flat `ComponentName.tsx`.
- [Routing: Project Organization (Next.js docs)](https://nextjs.org/docs/13/app/building-your-application/routing/colocation) — Official guide on which files Next treats as routes vs colocates.

### 4. Where to put constants

- [Where Should You Declare Constants in React? Inside vs Outside the Component — Tom Zhang Dev](https://tomzhangdev.substack.com/p/where-should-you-declare-constants) — Outside if static; inside only when it depends on props/state.
- [How To Organize Constants in a Dedicated Layer in JavaScript — Semaphore](https://semaphore.io/blog/constants-layer-javascript) — The "constants layer" pattern.
- [How to Add a Constants File to Your React Project — Austin Paley (Medium)](https://medium.com/@austinpaley32/how-to-add-a-constants-file-to-your-react-project-6ce31c015774) — When to split constants into multiple files.
- [How to Improve Your ReactJS Code with Constants — Bomberbot](https://www.bomberbot.com/reactjs/how-to-improve-your-reactjs-code-with-constants-an-expert-guide/) — Per-feature `constants.ts`.
- [Organizing Your React Project: Best Practices for Folder and File Structure — Muhammed Cuma (Medium)](https://muhammedcuma.medium.com/organizing-your-react-project-best-practices-for-folder-and-file-structure-a18fc664d34c) — Constants colocation alongside features.

### 5. utils vs helpers vs lib vs services

- [Libs vs Utils vs Services Folders: Simple Explanation for Developers — Ali Bey (Medium)](https://medium.com/@a.m.housen/libs-vs-utils-vs-services-folders-simple-explanation-for-developers-0ae961539a0f) — Clearest summary: lib = mini-packages, utils = generic stateless, services = does work.
- [What's the differences between helpers and utils? — erikras/react-redux-universal-hot-example #808](https://github.com/erikras/react-redux-universal-hot-example/issues/808) — Community discussion: utils = generic, helpers = project-specific.
- [Structuring React applications — Jack Franklin](https://www.jackfranklin.co.uk/blog/structuring-react-applications/) — Single `lib/` over splitting hairs.
- [React File Structure: The Backbone Of Efficient Development — DhiWise](https://www.dhiwise.com/post/streamlining-your-development-process-with-an-efficient-react-file-structure) — Picking between `lib/` and `utils/`.
- [How To Structure React Projects From Beginner To Advanced — Web Dev Simplified (Kyle Cook)](https://blog.webdevsimplified.com/2022-07/react-folder-structure/) — Pragmatic: start with one bucket, split when it hurts.

### 6. Where to place business logic

- [Container-presentational pattern in React — The Software House](https://tsh.io/blog/container-presentational-pattern-react) — Includes Dan Abramov's 2019 update saying hooks supersede it.
- [Separation of concerns with React hooks — Felix Gerschau](https://felixgerschau.com/react-hooks-separation-of-concerns/) — Hooks as the modern container.
- [Decoupling Business Logic from UI with Custom React Hooks — eMoosavi](https://www.emoosavi.com/blog/decoupling-business-logic-from-ui-with-custom-react-hooks) — Concrete refactors.
- [Container Hook View Pattern — React — Shaan (Medium)](https://medium.com/@shaangontia/container-hook-view-pattern-react-14dc873eef78) — Modern three-layer split.
- [bulletproof-react: api-layer.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/api-layer.md) — Reference data-access layer pattern.
- [Path To A Clean(er) React Architecture — API Layer & Fetch Functions — profy.dev](https://profy.dev/article/react-architecture-api-layer-and-fetch-functions) — 6-step refactor isolating API logic.
- [Why You Need an API Layer and How To Build It in React — Semaphore](https://semaphore.io/blog/api-layer-react) — Why `api/` (or `services/`) is non-negotiable past a certain size.
- [Best Practices for Keeping Your React UI and Logic Separate — DhiWise](https://www.dhiwise.com/post/mastering-the-art-of-separating-ui-and-logic-in-react) — Decision tree.

### 7. Component breakdown

- [When to break up a component into multiple components — Kent C. Dodds](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) — Don't pre-split for reusability.
- [Techniques for decomposing React components — David Tang (DailyJS)](https://medium.com/dailyjs/techniques-for-decomposing-react-components-e8a1081ef5da) — Concrete techniques.
- [Guideline from the 70's on how to split your React components — João Forja](https://joaoforja.com/blog/guideline-on-how-to-decompose-a-react-component) — Applies Parnas' information-hiding criteria.
- [Single Responsibility Principle in React: The Art of Component Focus — cekrem.github.io](https://cekrem.github.io/posts/single-responsibility-principle-in-react/) — SRP component-by-component.
- [Single Responsibility Principle in React applications (Part 1) — Sunscrapers](https://sunscrapers.com/blog/single-responsibility-principle-in-react-applications-part-1/) — Worked refactor.
- [10 Secrets for Mastering File and Folder Naming Conventions in React Projects — Athul Chandran (Medium)](https://medium.com/@athul-chandran/10-secrets-for-mastering-file-and-folder-naming-conventions-in-react-projects-a29e3103197d) — PascalCase, `use` prefix, kebab-case folders.
- [Naming Conventions in React for Clean & Scalable Code — Sufle](https://www.sufle.io/blog/naming-conventions-in-react) — Internal sub-components, exports, file/folder naming.
- [My favorite structure for React components — DEV (ayuthmang)](https://dev.to/ayuthmang/my-favorite-structure-for-react-components-f5p) — Per-component folder with private `_components/`.

### 8. Next.js App Router specifics

- [Getting Started: Project Structure (Next.js docs)](https://nextjs.org/docs/app/getting-started/project-structure) — Authoritative on `(group)`, `_folder`, `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`.
- [Routing: Project Organization (Next.js docs, App Router colocation)](https://nextjs.org/docs/13/app/building-your-application/routing/colocation) — What in `app/` becomes a route vs is colocated.
- [Understanding Route Visibility and Colocation in Next.js App Router — bridgetblog.hashnode.dev](https://bridgetblog.hashnode.dev/understanding-route-visibility-and-colocation-in-nextjs-app-router) — Walkthrough of private folders and route groups.
- [Organizing Routes and Files in Next.js – Private Folders and Project Structure — shahin.page](https://shahin.page/article/nextjs-routing-private-folders-and-project-structure) — How `_components` and `(group)` interact.
- [Inside the App Router: Best Practices for Next.js File and Directory Structure (2025 Edition) — Medium](https://medium.com/better-dev-nextjs-react/inside-the-app-router-best-practices-for-next-js-file-and-directory-structure-2025-edition-ed6bc14a8da3) — Opinionated reference layout.
- [How to Organize Next.js 15 App Router Folder Structure — jigz.dev](https://www.jigz.dev/blogs/how-to-organize-next-js-15-app-router-folder-structure) — Concrete `app/(group)/route/_components/X.tsx` recipe.
- [Next.js App Router in Practice: Solving Large Project Directory Chaos with Route Groups and Nested Layouts — BetterLink Blog](https://eastondev.com/blog/en/posts/dev/20251218-nextjs-routing-best-practices/) — Real-world scaling recipe.
- [Folder Structure (App) — Create T3 App](https://create.t3.gg/en/folder-structure-app) — Theo Browne / T3 community convention.
- [How to Build Reusable Architecture for Large Next.js Applications — freeCodeCamp](https://www.freecodecamp.org/news/reusable-architecture-for-large-nextjs-applications/) — Where non-route code goes; modular boundaries.
- [Next.js Colocation Template — Vercel demo site](https://next-colocation-template.vercel.app/) — Interactive reference of a fully-colocated App Router layout.
- [Lee Robinson on X: how he structures Next/React apps](https://x.com/leerob/status/1827522336007799123) — VP Product at Vercel, short-form opinion on structure.

### Conflicting opinions / open questions

(Material for future "trade-off" sections.)

- **Flat vs nested feature folders** — [Wieruch](https://www.robinwieruch.de/react-feature-architecture/) (peer-to-peer) vs [Feature-Sliced Design](https://feature-sliced.design/) (strict layered) vs [bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) (in between).
- **`utils/` vs `lib/` vs `helpers/`** — [bulletproof-react](https://github.com/alan2207/bulletproof-react) uses both `lib/` and `utils/`; [Jack Franklin](https://www.jackfranklin.co.uk/blog/structuring-react-applications/) prefers a single `lib/`; [Ali Bey](https://medium.com/@a.m.housen/libs-vs-utils-vs-services-folders-simple-explanation-for-developers-0ae961539a0f) distinguishes three; the [erikras GH thread](https://github.com/erikras/react-redux-universal-hot-example/issues/808) shows no community consensus.
- **Barrel files (`index.ts`) — yes or no** — [Josh Comeau](https://www.joshwcomeau.com/react/file-structure/) and [bulletproof-react](https://github.com/alan2207/bulletproof-react) embrace; [Catch Metrics on Next.js barrel files](https://www.catchmetrics.io/blog/nextjs-bundle-size-improvements-optimize-your-performance), [vercel/next.js #92926](https://github.com/vercel/next.js/discussions/92926), [Next.js issue #12557](https://github.com/vercel/next.js/issues/12557), and [Why I Will Not Use Index Files in 2025](https://medium.com/@aleksandr_ross/why-i-will-not-use-index-files-in-2025-b40db08dab00) document tree-shaking/Jest/build costs. Modern compromise: barrels only for **public** APIs of features.
- **Single `constants.ts` vs per-feature** — [Semaphore's constants-layer](https://semaphore.io/blog/constants-layer-javascript) (central) vs bulletproof-react and Wieruch (per-feature). Reconciliation: globally meaningful → central; feature-only → colocate.
- **Container/presentational still useful?** — [Dan Abramov's 2019 update](https://medium.com/@dan_abramov/making-sense-of-react-hooks-fdbde8803889) (hooks supersede it) vs [tsh.io](https://tsh.io/blog/container-presentational-pattern-react) and [Container Hook View Pattern](https://medium.com/@shaangontia/container-hook-view-pattern-react-14dc873eef78) (survives in modern form).
- **Data fetching location in App Router** — RSC pushes data fetching into `page.tsx`; [bulletproof-react's api-layer.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/api-layer.md) keeps an API layer + React Query. The two models conflict; in App Router, much of the client-side API layer becomes server-side data functions in `lib/` or colocated with the route.

---

## Version history

- **0.1.0 (2026-06-20)** — initial release. Sourced from ~40 articles, official Next.js docs, bulletproof-react, and well-known engineers (Kent C. Dodds, Robin Wieruch, Josh Comeau, Nadia Makarevich, Lee Robinson, Theo Browne).
