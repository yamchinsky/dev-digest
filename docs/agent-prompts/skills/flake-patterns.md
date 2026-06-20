# flake-patterns

Detect test patterns that produce intermittent CI failures. A flaky test is
worse than a missing one — it burns oncall trust and trains the team to retry
rather than investigate.

Flag any of the following when introduced or amplified by the diff:

## Time / scheduling
- Real `setTimeout` / `setInterval` / `sleep` / `delay` instead of
  `vi.useFakeTimers()` + `vi.advanceTimersByTime()`.
- Wall-clock waits like `while (Date.now() - start < N)`.
- `await new Promise(r => setTimeout(r, N))` as a synchronization mechanism.

## Network
- Real `fetch`, `axios`, `octokit`, or any LLM provider call escaping the
  global `fetch` mock (`src/test/setup.ts` for client; explicit `vi.mock`
  for server).
- A test that succeeds only when an external service is reachable.

## Randomness
- `Math.random()` / `crypto.randomUUID()` / `Date.now()` used in test data
  without a fixed seed.
- `faker` (or similar) without `faker.seed(...)`.

## Ordering & isolation
- Tests that share mutable module-level state (a global `cache`, a singleton
  `db` client) without resetting it in `beforeEach`.
- A test that asserts an array's order when the producer doesn't guarantee
  one (Set iteration, Map iteration, parallel `Promise.all` results indexed
  by completion order).

## Async assertion shapes
- `waitFor(() => { /* no expect */ })` — waits the default timeout and
  passes regardless.
- `expect(promise).resolves.toX(...)` without `await` — the assertion is
  fire-and-forget.
- A `try { ... } catch { expect(true).toBe(true) }` shape — accepts ANY
  exception, including a typo.

## Snapshot rot
- Snapshot tests that include timestamps, UUIDs, generated ids, or
  iteration-order-dependent values.

For each match, cite the exact `file:line`, name the flake mechanism, and
suggest the concrete fix (e.g. "wrap in `vi.useFakeTimers()`; advance with
`vi.advanceTimersByTime(1000)`"). Do not flag deterministic delay tests
inside `describe.concurrent` unless they actually wait on wall-clock time.
