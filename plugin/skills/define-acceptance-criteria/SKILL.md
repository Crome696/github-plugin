---
name: define-acceptance-criteria
description: Deterministically formulate observable, testable acceptance criteria from one complete ProductInterview v2. Use automatically after conduct-product-interview when users need acceptance criteria, Akzeptanzkriterien, Given/When/Then checks, a Definition of Done, or verifiable completion conditions; do not use for full issue rewrites or requirements structuring.
---

# Define Acceptance Criteria

Turn the confirmed decisions from one canonical ProductInterview v2 into a
small set of observable pass/fail conditions that another person can implement
and verify without guessing.

## Boundaries

- Match questions, explanations, and summaries to the user's conversation
  language.
- Write the acceptance criteria and verification hints as durable English
  artifacts unless the user explicitly requests another artifact language.
- Do not edit repository files, GitHub issues, labels, comments, or issue state.
- Do not invent product decisions, actors, thresholds, platforms, error
  behavior, or non-goals.
- Require one matching `ProductInterview` version 2. This Skill owns no
  product-decision elicitation and must not ask gap-closing questions.
- Consume only `confirmed_decisions`. Keep assumptions, accepted
  uncertainties, and open questions out of acceptance requirements.
- When the interview is missing, incomplete, unsupported, or mismatched,
  return a typed [`ProductInterviewPrerequisite`](../../shared/schemas/ProductInterviewPrerequisite.yaml)
  with `consumer: define-acceptance-criteria` instead of starting an embedded
  interview.
- A direct text-only rewrite of a complete GitHub issue belongs to
  [rewrite-issue](../rewrite-issue/SKILL.md); an interview-driven
  publication rewrite belongs to
  [rewrite-github-issue](../rewrite-github-issue/SKILL.md). A request to
  publish an already approved `IssueDraft` belongs to
  [create-github-issue](../create-github-issue/SKILL.md). A request to collect
  and structure complete issue requirements belongs to
  [structure-issue](../structure-issue/SKILL.md).

## Workflow

1. Validate the supplied ProductInterview v2 and its source identity. Do not
   replace it with a live issue, brief, ProductAssessment, or user question.
2. Read only `confirmed_decisions` and separate them into independent
   behaviors. Cover the normal success path
   and, when the scope includes them, validation, error, permission, and state
   boundary behavior.
3. Write each behavior as an observable condition with a clear pass/fail
   result. Prefer `Given/When/Then`; use an equivalent checkbox statement when
   the context does not fit that structure.
4. Add one verification hint for each criterion when a relevant check,
   command, test, or observation is known. Do not claim that a check passed
   unless it was actually performed.
5. Return a concise conversational summary, followed by the English
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
  with an agreed observable measure. If no measure exists in the confirmed
  decisions, preserve the gap as non-ready evidence and return the canonical
  prerequisite or open question; do not ask for the missing decision here.
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

When the canonical interview prerequisite is not satisfied, return no
acceptance criteria and provide the exact `ProductInterviewPrerequisite` v1
object with `consumer: define-acceptance-criteria`, `required_version: 2`,
the failure status, and the next step `conduct-product-interview`.

When the confirmed evidence is insufficient for a pass/fail criterion, do not
fill the gap with a guess. Preserve the canonical interview's open question or
accepted uncertainty and return the prerequisite or non-ready result instead
of asking for the decision here.
