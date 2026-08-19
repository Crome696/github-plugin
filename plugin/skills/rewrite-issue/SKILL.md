---
name: rewrite-issue
description: Rewrite a GitHub issue into a clear, structured, implementation-ready specification while preserving its original intent and scope. Use automatically when a user asks to rewrite, restructure, or clarify issue text without requesting an interview or a GitHub write.
---

# Rewrite Issues

Rewrite one GitHub issue into a readable, consistent specification without
silently changing its intent, scope, or product decisions. Return both the
rewritten issue and a structured summary of significant changes.

## Boundaries

- Match questions, explanations, and summaries to the user's conversation
  language.
- Write the rewritten issue and structured result in English unless the user
  explicitly requests another artifact language.
- Preserve the source issue's intent and scope. Improve organization, wording,
  consistency, and completeness only when the source supports the change.
  Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc):
  do not flatten independent outcomes into one rewritten issue, and do not
  split one outcome into technical tasks.
- Never invent actors, behavior, requirements, constraints, dependencies,
  priorities, technical choices, acceptance criteria, or thresholds.
  Missing essential product decisions belong to the
  [`product-interview-policy.mdc`](../../rules/product-interview-policy.mdc)
  dialog in `rewrite-github-issue`; do not fill them here.
- Mark interpretations as `[inferred]` and absent material information as
  `[missing]`. Do not present either as a confirmed requirement.
- Do not edit repository files, GitHub issues, labels, comments, or issue
  state. Do not publish the result.
- Use [update-github-issue](../update-github-issue/SKILL.md) for an approved
  partial issue-field update; this Skill only returns rewritten text.
- Do not interview the user or invoke another Skill automatically. Recommend
  at most one follow-up Skill in the result.
- Use `rewrite-github-issue` for an interview-driven rewrite or for an
  `IssueDraft` handoff intended for task-scoped autonomous publication.

## Execution and approval

This Skill is a non-mutating, text-only workflow. A direct invocation may
execute after its input has been validated and must return the rewrite result
without an additional conversational approval step.

- If Cursor Plan mode is used, a completed **Build** is the approval to execute
  the exact non-mutating scope represented by that plan.
- After that Build, return the result immediately; do not ask for a redundant
  chat confirmation of the same rewrite.
- Do not enter or remain in Plan mode solely to obtain another approval for
  this text-only result.
- This non-mutating result does not itself authorize issue publication, issue
  overwrites, partial issue updates, or any other GitHub or Git side effect.
  Those operations use the verified task-scoped delivery authorization and
  retain only the hard safety gates or any explicit repository policy gate.

## Input contract

Accept exactly one of these source forms:

1. A version-1 `LoadedIssue` handoff. Accept `status: loaded` or
   `status: partial`; preserve its issue identity and unavailable fields.
   Reject `status: blocked` and do not reconstruct missing issue content.
2. A repository and positive issue number. Load the exact issue before
   rewriting:

   ```text
   gh issue view <number> --repo <owner>/<repo> --json title,body,labels,state,comments,url
   ```

   Keep the returned title and body as the source text. Do not substitute an
   issue from another repository or number.
3. Pasted `title` and `body` strings. The body may be empty, but a missing or
   empty title is insufficient for a reliable issue rewrite. Record that live
   repository identity and metadata were not supplied.

Validate repository names and issue numbers when a live source is requested.
Do not infer identity from the current workspace, branch, remote, or issue
text. Preserve exact source text while analyzing it; normalization applies
only to the rewritten output.

## Workflow

### 1. Establish the evidence boundary

Read the complete supplied issue title and body, relevant comments and
metadata when available, and only the thin repository context needed to
interpret an explicit reference. Classify every material statement as:

- **Evidenced** — directly stated in the issue or retrieved source context.
- **Inferred** — a reasonable interpretation that is not explicitly stated.
- **Missing** — needed for implementation or verification but not supplied.

Treat labels as metadata, not requirements, unless the issue text makes them
authoritative. Preserve contradictions instead of silently choosing a side.

### 2. Preserve intent and scope

Extract the problem, objective, current behavior, desired behavior, explicit
requirements, scope, non-goals, constraints, dependencies, and existing
acceptance or verification conditions. Keep future ideas separate from work
required by the current issue. If the source contains no explicit non-goals,
write `[missing] No explicit non-goals were provided` rather than inventing
them.

### 3. Draft the rewritten issue

Use the source title when it is already clear. Rewrite it only when the new
wording improves clarity without adding scope, and record the title change in
the summary. Use this body structure:

```markdown
## Problem

What problem exists and who or what is affected, based on the source.

## Objective

The outcome this issue is intended to achieve.

## Requirements

- Explicit, source-supported requirements.
- [inferred] Clearly marked interpretations, when useful.

## Scope and non-goals

- Work explicitly included by the source.
- Explicit exclusions, when provided.
- [missing] No explicit non-goals were provided, when that absence matters.

## Acceptance criteria

- Observable criteria already stated or directly supported by the source.
- [missing] A material completion condition not supplied by the source.

## Constraints

- Source-supported technical, product, platform, or policy constraints.
- [missing] No constraint was specified, when that absence matters.

## Dependencies

- Required systems, data, permissions, integrations, or decisions supported by
  the source.
- [missing] A material dependency that is not specified.

## Open questions

- Material decisions that remain unresolved.
```

Do not turn a missing detail into an acceptance criterion. Do not add
implementation scaffolding, APIs, libraries, platform variants, or rollout
plans unless the source explicitly requires them. Keep sections concise and
omit a `[missing]` note when the section is genuinely irrelevant to the
stated scope.

### 4. Summarize significant changes

Return a structured summary after the rewritten issue. Include only material
changes, using these categories:

- `reorganization` — moved existing information into a clearer section.
- `clarification` — made source-supported wording more precise.
- `normalization` — resolved terminology or formatting inconsistencies without
  changing meaning.
- `inferred_context` — surfaced an interpretation and its evidence.
- `missing_information` — identified a gap without filling it.
- `preserved_scope` — explicitly record an important boundary that remained
  unchanged.

For each entry include the change, source evidence, and certainty
(`evidenced`, `inferred`, or `uncertain`). State when no significant change was
made beyond formatting.

### 5. Set readiness and recommend one follow-up

Set `implementation_ready: true` only when the rewritten issue contains
explicit enough scope and observable completion conditions to implement without
guessing. Otherwise set it to `false`; a successful rewrite may still need
clarification.

Choose at most one `recommended_next_skill`:

- `rewrite-github-issue` — the user needs an interview or task-scoped
  publication handoff, including when essential product decisions are
  missing and must not be invented.
- `structure-issue` — material requirements, scope boundaries, dependencies,
  risks, or non-goals need to be elicited.
- `define-acceptance-criteria` — scope is clear but pass/fail conditions are
  missing.
- `assess-issue-quality` — the user also requests the separate six-dimension
  quality assessment.
- `none` — no follow-up is justified or the source is blocked.

Do not invoke the recommendation automatically.

## Output contract

First give a concise summary in the conversation language. Then return one
English result with these fields:

```yaml
status: rewritten
source:
  type: loaded_issue | live_issue | pasted_text
  repository: owner/repository | null
  number: 42 | null
  unavailable_fields: []
implementation_ready: false
rewritten_issue:
  title: "Clear title preserving the original scope"
  body: |
    ## Problem
    ...
change_summary:
  significant_changes:
    - category: reorganization
      change: "Moved the stated behavior into Requirements."
      evidence: "body"
      certainty: evidenced
  preserved_intent: "The original requested outcome and scope are unchanged."
open_questions:
  - "What observable result proves completion?"
recommended_next_skill: define-acceptance-criteria
failure: null
```

Use `status: rewritten` when the source was validated and a trustworthy
rewrite was produced. Use `status: partial` when the rewrite is usable but a
material source field was unavailable; list it in `source.unavailable_fields`
and explain the uncertainty in `change_summary` or `open_questions`. Use
`status: blocked` when the input cannot be validated or the source cannot be
read. `failure` is `null` only for a successful `rewritten` or `partial`
result, and otherwise contains `code`, `message`, `operation`, and
`retryable`. Never expose credentials, tokens, private keys, `.env` contents,
or unnecessary raw CLI output.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No supported issue source was supplied. | `blocked`; ask for one source form without guessing. |
| `invalid_input` | A source has missing fields, invalid types, a malformed repository, or a non-positive issue number. | `blocked`; do not rewrite guessed values. |
| `unsupported_version` | A `LoadedIssue` handoff is not version 1. | `blocked`; request a compatible handoff. |
| `blocked_source` | The supplied `LoadedIssue` has `status: blocked`. | `blocked`; preserve known identity and do not fabricate issue content. |
| `empty_source` | The pasted title is empty or the loaded issue has no usable title. | `blocked`; request a non-empty issue title. |
| `issue_not_found` | GitHub cannot resolve the exact requested issue. | `blocked`; do not substitute another issue. |
| `inaccessible` | GitHub denies access to the exact issue or repository. | `blocked`; do not request or print credentials. |
| `auth_unavailable` | GitHub CLI authentication is unavailable for a live load. | `blocked`; report the missing authentication without sensitive output. |
| `api_failure` | A network, server, rate-limit, or unexpected GitHub CLI/API failure prevents reading the source. | `blocked`; identify the failed operation without raw CLI output. |
| `rewrite_failure` | An unexpected local failure prevents a reliable rewrite or summary. | `blocked`; do not return a partial fabricated result. |

## Compact example

Source:

```text
Title: Add export
Body: Users need to export filtered results. CSV would be useful.
```

Result:

```yaml
status: rewritten
implementation_ready: false
rewritten_issue:
  title: "Add export for filtered results"
  body: |
    ## Problem
    Users need to export filtered results.

    ## Objective
    Provide an export for the filtered result set.

    ## Requirements
    - Export the results represented by the active filter.
    - [inferred] CSV is a candidate output format; the source does not lock it.

    ## Scope and non-goals
    - Exporting the filtered results remains in scope.
    - [missing] No explicit non-goals were provided.

    ## Acceptance criteria
    - [missing] The source does not define the export trigger or a pass/fail
      result.

    ## Constraints
    - [missing] No format is confirmed by the source.

    ## Dependencies
    - [missing] Required permissions and data-volume limits are unspecified.

    ## Open questions
    - Which output format and export trigger are required?
change_summary:
  significant_changes:
    - category: inferred_context
      change: "Separated the possible CSV format from the confirmed outcome."
      evidence: "body"
      certainty: inferred
    - category: missing_information
      change: "Recorded missing trigger and verification details."
      evidence: "body"
      certainty: uncertain
  preserved_intent: "The requested export of filtered results remains in scope."
open_questions:
  - "Which output format and export trigger are required?"
recommended_next_skill: define-acceptance-criteria
failure: null
```
