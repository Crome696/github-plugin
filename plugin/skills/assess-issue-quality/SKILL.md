---
name: assess-issue-quality
description: Assess GitHub issue quality across completeness, understandability, implementability, testability, scope, and contradictions. Use automatically when a user asks to assess issue quality, review issue readiness, or evaluate an issue for completeness, clarity, feasibility, scope, testability, or conflicting requirements; do not use for parent-issue product-topic extraction (use `analyze-product-issue`), deep severity-based analysis of a loaded `LoadedIssue` (use `analyze-issue`), atomicity classification of sub-issue candidates (use `assess-issue-atomicity`), product dependency graphing (use `build-product-dependency-graph`), product prioritization (use `prioritize-product-issues`), requirements elicitation, acceptance-criteria authoring alone, or issue rewrites and publication.
---

# Assess Issue Quality

Evaluate one GitHub issue as an evidence-backed, read-only diagnostic. Produce
an English quality report while keeping the conversation in the user's
language.

## Boundaries

- Read the live issue before assessing it when a repository and issue number
  are available:

  ```text
  gh issue view <number> --repo <owner>/<repo> --json title,body,labels,state,comments,url
  ```

- Read only the thin repository context needed to interpret the issue, such as
  the README, contribution guidance, or a directly relevant architecture note.
- Use `analyze-product-issue` for a parent-issue product assessment that
  prepares the subsequent interview. Use `analyze-issue` for a deep
  severity-based analysis of a version-1 `LoadedIssue`; this Skill remains
  the six-dimension 1–5 quality rubric.
- Do not edit GitHub, repository files, labels, comments, or issue state.
- Do not draft or publish a rewrite, and do not automatically invoke another
  skill. Recommend at most one next skill after the assessment. A direct
  text-only rewrite belongs to [rewrite-issue](../rewrite-issue/SKILL.md);
  interview-driven publication rewriting belongs to
  [rewrite-github-issue](../rewrite-github-issue/SKILL.md).
- A request to publish an already approved `IssueDraft` belongs to
  [create-github-issue](../create-github-issue/SKILL.md), not to this
  assessment.
- Ground findings in the issue, relevant comments, repository evidence, or
  explicitly missing information. Treat labels as supporting metadata, not
  requirements, unless the issue text makes them authoritative.
- Never turn an assumption into a requirement or give a high score because a
  likely implementation seems obvious.
- Ask at most one or two focused questions per round, and only when the issue
  identity is missing or the missing fact prevents a meaningful assessment.
  Do not turn the assessment into a requirements interview.

## Workflow

1. Identify the repository and issue number from the request, URL, open
   workspace, or current branch. If the identity is missing, ask one concise
   question. If it remains unavailable, explain the missing evidence and set
   the overall result to `blocked`; pasted text may support preliminary
   findings but does not remove this blocked result.
2. Read the issue, including its title, body, relevant comments, labels, and
   state. Use the latest relevant decision in a comment only when it is
   clearly attributable; record unresolved disagreements as findings.
3. Extract the stated problem, affected users, current behavior, target
   behavior, scope, non-goals, constraints, dependencies, and acceptance or
   verification criteria. Mark each item as evidenced, ambiguous, or missing.
4. Score each dimension independently using the rubric below. Cite the
   evidence or missing statement in every finding; do not let one strong
   dimension hide a material gap in another.
5. Derive the overall result using the rules below and calculate the arithmetic
   mean to one decimal place when all six scores are available.
6. Give the user a concise summary in the conversation language, followed by
   the English report. Recommend one appropriate follow-up skill, but do not
   start it automatically.

## Scoring rubric

Use integer scores from 1 to 5. A score of 5 means the dimension is ready for
implementation; a score of 1 means the dimension is absent, unusable, or
materially contradictory.

### Completeness

- **5** — States the problem and affected users, current and target behavior,
  in-scope work, non-goals, relevant constraints or dependencies, and
  verifiable completion conditions.
- **4** — The required context is present with one minor omission that does not
  change the likely implementation or verification.
- **3** — The outcome is understandable, but multiple non-blocking details are
  missing or implied.
- **2** — A material user, behavior, scope, dependency, or completion decision
  is missing.
- **1** — Little actionable context is provided beyond a title or a vague
  request.

### Understandability

- **5** — The language is precise, terms have a stable meaning, and an
  implementer can distinguish facts, requirements, and examples.
- **4** — Mostly clear with one minor ambiguous term or statement.
- **3** — Understandable only after reasonable interpretation of several vague
  or overloaded terms.
- **2** — Important passages are ambiguous, subjective, or difficult to
  reconcile.
- **1** — The intended outcome cannot be determined reliably.

### Implementability

- **5** — An implementer can act without guessing product behavior, actors,
  boundaries, permissions, or required integrations.
- **4** — A small technical detail is missing, but no material product
  decision is required.
- **3** — The direction is plausible, but several implementation-relevant
  decisions remain open.
- **2** — A material product, platform, integration, permission, or behavior
  decision is absent.
- **1** — The requested change cannot be identified well enough to implement.

### Testability

- **5** — Each important outcome has an observable pass/fail condition and a
  credible verification approach.
- **4** — Outcomes are mostly observable, with one minor criterion or
  verification detail still vague.
- **3** — The desired outcome is stated, but pass/fail conditions or
  verification steps are incomplete.
- **2** — Completion depends mainly on subjective terms or unmeasured claims.
- **1** — No meaningful result can be verified.

### Scope

Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc).
A hidden compound requirement, a technical-only split, or a slice that cannot
be understood or accepted alone cannot score 5.

- **5** — The issue has one independently understandable outcome, explicit
  in-scope work, verifiable acceptance criteria for that outcome, and clear
  non-goals or boundaries.
- **4** — The boundary is clear with one minor adjacent concern left implicit.
- **3** — The issue is broad or contains several related outcomes, but the
  work can still be separated without a product decision.
- **2** — The issue mixes unrelated outcomes, is materially over-broad, or
  provides no useful boundary.
- **1** — There is no reliable way to tell what work belongs in the issue.

### Contradictions

- **5** — The title, body, relevant comments, acceptance criteria, and
  authoritative metadata do not contain material conflicts.
- **4** — There is a minor tension or stale detail, but the intended
  requirement remains clear.
- **3** — At least one unresolved conflict could change implementation or
  verification.
- **2** — Directly conflicting requirements or decisions make the intended
  behavior uncertain.
- **1** — Mutually exclusive requirements make a coherent implementation
  impossible.

## Overall result

Apply these rules in order:

- `blocked` — The live issue or required source evidence is unavailable, the
  issue cannot be identified, or `Completeness` or `Contradictions` is 1 or 2.
- `ready` — All six dimensions score at least 4 and no material contradiction
  remains.
- `needs_work` — The issue is readable and assessable, but it does not meet
  `ready` and is not `blocked`.

For a blocked assessment, use `N/A` for any dimension that cannot be scored
without the missing source. Do not calculate an average when fewer than six
scores are available. For a readable issue, calculate the arithmetic mean of
the six integer scores and round it to one decimal place.

## Output

First summarize the result in the conversation language. Then return this
English artifact. Keep every finding concrete and include a source reference
or state that the information is not stated.

```markdown
## Issue quality assessment

- Repository / Issue: owner/repository#123
- Overall: ready | needs_work | blocked
- Average score: X.X / 5 (or N/A when blocked)

| Dimension | Score | Finding |
| --- | ---: | --- |
| Completeness | 1-5 or N/A | One evidence-backed finding |
| Understandability | 1-5 or N/A | One evidence-backed finding |
| Implementability | 1-5 or N/A | One evidence-backed finding |
| Testability | 1-5 or N/A | One evidence-backed finding |
| Scope | 1-5 or N/A | One evidence-backed finding |
| Contradictions | 1-5 or N/A | One evidence-backed finding |

## Blocking gaps

- None identified.

## Recommended next step

- none
```

Use exactly one recommendation:

- `structure-issue` when several requirements, scope boundaries, dependencies,
  or non-goals are missing.
- `define-acceptance-criteria` when the issue is otherwise scoped but
  observable pass/fail conditions or verification are the main weakness.
- `rewrite-github-issue` when the issue is sufficiently understood but needs a
  complete English specification and the user asks for a rewrite workflow.
- `create-github-issue` when an exact approved `IssueDraft` is already
  available and only publication remains.
- `none` when no follow-up skill is warranted.

Do not claim that an issue is ready for implementation merely because it is
well written. Readiness requires passing all six dimensions.
