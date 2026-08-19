---
name: define-acceptance-criteria
description: Formulate observable, testable acceptance criteria from feature requests, issue briefs, and scoped requirements. Use automatically when users ask for acceptance criteria, Akzeptanzkriterien, Given/When/Then checks, a Definition of Done, or verifiable completion conditions; do not use for full issue rewrites or requirements structuring.
---

# Define Acceptance Criteria

Turn a requested outcome into a small set of observable pass/fail conditions
that another person can implement and verify without guessing.

## Boundaries

- Match questions, explanations, and summaries to the user's conversation
  language.
- Write the acceptance criteria and verification hints as durable English
  artifacts unless the user explicitly requests another artifact language.
- Do not edit repository files, GitHub issues, labels, comments, or issue state.
- Do not invent product decisions, actors, thresholds, platforms, error
  behavior, or non-goals.
- A direct text-only rewrite of a complete GitHub issue belongs to
  [rewrite-issue](../rewrite-issue/SKILL.md); an interview-driven
  publication rewrite belongs to
  [rewrite-github-issue](../rewrite-github-issue/SKILL.md). A request to
  publish an already approved `IssueDraft` belongs to
  [create-github-issue](../create-github-issue/SKILL.md). A request to collect
  and structure complete issue requirements belongs to
  [structure-issue](../structure-issue/SKILL.md).

## Workflow

1. Read the available issue, brief, or scope before asking questions. Extract
   the desired outcome, affected actor or system, relevant trigger, target
   behavior, and explicit non-goals.
2. Identify only the gaps that could change whether a criterion passes. Ask no
   more than one or two focused questions per round. If the user wants a
   quick draft, state unresolved assumptions instead of presenting them as
   confirmed requirements.
3. Split the outcome into independent behaviors. Cover the normal success path
   and, when the scope includes them, validation, error, permission, and state
   boundary behavior.
4. Write each behavior as an observable condition with a clear pass/fail
   result. Prefer `Given/When/Then`; use an equivalent checkbox statement when
   the context does not fit that structure.
5. Add one verification hint for each criterion when a relevant check,
   command, test, or observation is known. Do not claim that a check passed
   unless it was actually performed.
6. Return a concise conversational summary, followed by the English
   acceptance-criteria artifact.

## Quality rules

- Each criterion describes one behavior and can be checked without subjective
  interpretation.
- Use concrete actors, inputs, states, outputs, and measurable thresholds
  only when they are established by the source context or the user.
- Keep criteria outcome-focused; do not prescribe an implementation, library,
  class, endpoint, or internal data structure unless it is itself part of the
  requirement.
- Keep future ideas, technical preferences, and excluded work out of the
  criteria.
- Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc).
  If the source mixes independent product outcomes, do not write one combined
  acceptance-criteria set that hides the split. Cover the selected outcome
  only and record the remainder as out of scope.
- Replace vague terms such as "fast", "easy", "better", and "user-friendly"
  with an agreed observable measure. If no measure exists, ask for one or
  record the missing decision as an open question.
- Do not combine unrelated outcomes into one checkbox. Do not turn a
  verification step into a requirement.
- Include negative or boundary behavior only when the requested scope defines
  it; never infer a policy from a missing detail.

Avoid:

```text
- [ ] The export is fast and user-friendly.
```

Use a measurable condition only when its threshold is confirmed:

```text
- [ ] Given a user with export permission and a valid filter, when the user
      starts an export, then the system downloads a CSV containing exactly the
      filtered records.
```

## Output

Use this structure and keep the criteria in English:

```markdown
## Acceptance criteria

- [ ] Given ..., when ..., then ...
- [ ] Given ..., when ..., then ...

## Verification hints

- Criterion 1: Check or command that demonstrates the condition.
- Criterion 2: Check or command that demonstrates the condition.

## Open questions

- Include this section only when a material decision is still unresolved.
```

When the context is insufficient for a pass/fail criterion, do not fill the
gap with a guess. Explain the missing decision in the conversation language
and list it under `Open questions` in the English artifact.
