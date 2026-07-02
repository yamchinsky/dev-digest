# EARS — writing acceptance criteria an agent can actually act on

The six question categories say *what* to ask; EARS (Easy Approach to
Requirements Syntax — Alistair Mavin, Rolls-Royce, 2009) says *how to write
down the answer* so it is unambiguous. SDD adopted it because every criterion
collapses into one **testable** statement — no ambiguity about trigger, state,
or response.

## The five patterns

1. **Ubiquitous** — the requirement always holds:
   > The system SHALL log every authentication attempt.

2. **Event-driven** — on an event (`WHEN … SHALL`):
   > WHEN the user submits the login form, the system SHALL validate the
   > credentials against the auth provider.

3. **State-driven** — while a state lasts (`WHILE … SHALL`):
   > WHILE a sync is in progress, the system SHALL show a non-dismissible
   > progress indicator.

4. **Unwanted behavior** — error/abuse paths (`IF … THEN … SHALL`):
   > IF credential validation fails three times within 60 seconds, THEN the
   > system SHALL lock the account for 15 minutes.

5. **Optional feature** — capability-gated (`WHERE … SHALL`):
   > WHERE MFA is enabled, the system SHALL require a TOTP code after the
   > password.

## The hard part: translating vague requirements

The five patterns are just syntax. The real skill is turning a fuzzy ask into
an unambiguous statement. Worked examples from this repo's Onboarding feature:

| Vague requirement | EARS criterion |
| --- | --- |
| "Should work fine on large repos" | WHEN the repository exceeds the indexing threshold, the system SHALL generate the overview from deterministic facts only, without full file reads. |
| "Shouldn't crash if the model is unavailable" | IF the structured model call fails, THEN the system SHALL render a deterministic overview skeleton with the failure reason instead of an error. |
| "Should suggest where to start reading" | The system SHALL order the reading path by file rank from the import graph, not alphabetically or by date. |

What the translation does: a vague verb ("fine", "suggest") becomes a concrete
trigger plus a concrete response that a test can verify.

## Checklist per criterion

- [ ] Has a stable ID (`AC-1`, `AC-2`, …) — downstream `implementation-planner` R-IDs
      reference these.
- [ ] Uses exactly one EARS pattern (don't stack `WHEN … WHILE … IF …`).
- [ ] The obligation verb is **SHALL** (not "should", "will", "must try to").
- [ ] Trigger/state is observable; response is testable (a test could assert
      it without interpreting intent).
- [ ] No vague adverbs: "quickly", "gracefully", "properly", "normally" —
      replace each with the measurable behavior it hides.
