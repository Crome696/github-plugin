---
name: compare-issue-revision
description: Compares an original GitHub issue with a rewritten revision and produces an evidence-based semantic diff of requirements, acceptance criteria, scope, constraints, dependencies, and assumptions. Use automatically when a user asks to compare issue revisions, review rewrite changes, detect scope drift, or identify contradictions between original and rewritten issue text.
---

# Compare Issue Revisions

Compare one original issue with one rewritten revision without deciding which
version is better. Return a structured, evidence-based diff that makes
material changes and review risks explicit.

`issue-agent` mode `refine` uses this read-only comparison immediately before
the final payload review to expose scope drift, removed requirements,
contradictions, and other material changes between the loaded issue and its
proposed revision.

## Boundaries

- Match chat, questions, and explanations to the user's conversation language.
- Write the structured comparison and all newly authored report text in
  English unless the user explicitly requests another artifact language.
- Read only the supplied source objects or pasted text. Do not silently load,
  re-fetch, publish, edit, or comment on a GitHub issue.
- Do not edit repository files, labels, issue state, or pull requests.
- Do not treat labels, comments, metadata, formatting, or editorial headings as
  requirements unless the issue text explicitly makes them requirements.
- Preserve the original and revision text as evidence. Do not normalize source
  text before recording excerpts and references.
- Do not infer author intent. Describe the observable purpose of a change and
  state when its purpose or authorization is unknown.
- Do not rank, score, approve, reject, or otherwise judge which version is
  better unless the supplied evidence explicitly supports a narrower factual
  conclusion.
- Do not invoke another Skill automatically. Recommend at most one follow-up
  Skill in the result.

## Input contract

Accept exactly one `original` source and one `revision` source.

### Original source

The original must be one of:

1. A version-1 `LoadedIssue` handoff with `status: loaded` or
   `status: partial`. Use its exact `title` and `body`, and preserve its
   `issue.repository`, `issue.number`, `issue.url`, and `unavailable_fields`.
2. Pasted text with a non-empty `title` and a `body` string. An empty body is
   valid. Live repository identity is unavailable unless explicitly supplied
   as part of the source object.

Reject a blocked `LoadedIssue`. Do not reconstruct missing title or body text.

### Revision source

The revision must be one of:

1. A version-2 `IssueDraft` with a usable `title` and `body`. Use only the
   exact proposed text; labels and publication fields are metadata, not issue
   requirements.
2. A validated `rewrite-issue` result with `status: rewritten` or `status:
   partial` and a `rewritten_issue.title` and `rewritten_issue.body`.
3. Pasted text with a non-empty `title` and a `body` string. An empty body is
   valid.

Reject blocked results and unsupported contract versions. Do not infer the
revision identity from the workspace, current branch, or issue text.

If both sources provide an explicit repository and issue number, compare them.
An identity mismatch is a review flag, not an excuse to substitute another
issue or silently discard the text. If either identity is absent, record it as
unavailable and compare the supplied text only.

## Workflow

### 1. Validate the evidence boundary

Validate the source shapes, contract versions, statuses, title/body types, and
required identity fields before comparing content. A missing title or missing
body value is a blocked comparison; an empty body string is valid.

Keep source references stable and concise:

- `original.title`
- `original.body.requirements[0]`
- `revision.body.acceptance_criteria[1]`
- `original.body.paragraph[2]`
- `revision.body.scope_and_non_goals[0]`

Use the supplied `unavailable_fields` to distinguish an incomplete source from
an empty source. Use `partial` only when title and body are available but a
material source field needed for semantic comparison is unavailable.
Unavailable comments, labels, linked pull requests, or metadata remain
recorded but do not make this text comparison partial when they were not part
of the comparison.

### 2. Build semantic inventories

Read the complete title and body of both sources. Extract semantic items under
these categories:

- `requirement` — required behavior, actors, outcomes, or product behavior.
- `acceptance_criterion` — observable pass/fail completion condition.
- `scope` — included work, explicit non-goals, exclusions, or future context.
- `constraint` — technical, platform, policy, performance, or format boundary.
- `dependency` — required system, data, permission, integration, or decision.
- `assumption` — an explicit assumption or a clearly marked inferred premise.
- `other` — title, problem, objective, open question, risk, or context that
  materially affects interpretation but is not one of the categories above.

Recognize common Markdown headings case-insensitively, including `Requirements`,
`Acceptance criteria`, `Scope and non-goals`, `Constraints`, `Dependencies`,
and `Assumptions`. Do not require headings: classify unheaded text by its
meaning and location. Treat a future idea as future context or a non-goal
unless the source clearly makes it current scope.

For every inventory item record:

- the smallest useful exact excerpt;
- a stable source reference;
- its category;
- certainty: `evidenced`, `inferred`, or `uncertain`.

An explicit requirement must be `evidenced`. Mark interpretations as
`inferred`; mark missing, contradictory, or incomplete evidence as `uncertain`.
Do not create requirements, acceptance criteria, constraints, dependencies, or
assumptions merely because a rewrite would normally contain them.

### 3. Align and classify items

Align items by meaning, not by position, wording similarity, or matching
headings. Use one of these buckets:

- `added` — the revision introduces a material semantic item with no original
  counterpart.
- `removed` — the original contains a material item with no revision
  counterpart.
- `modified` — both versions address the same item but change behavior,
  modality, condition, threshold, actor, scope, dependency, or verification.
- `unchanged` — the meaning and force remain equivalent even if the wording,
  order, heading, or formatting changed.

Do not report a moved or reformatted item as removed and added. For split or
merged items, record one `modified` entry containing the exact relevant
excerpts and both source references. Record title changes as `other` items.

### 4. Explain significant changes

For every diff entry, provide:

- `purpose`: the observable editorial or semantic role of the change, such as
  making a condition explicit or adding a new boundary. Do not state an
  author's motive without evidence. For unchanged items, state that no
  semantic change was identified.
- `potential_impact`: the possible effect on implementation, verification,
  dependencies, or scope. Use qualified language such as `may` when the effect
  is not explicit in the sources.
- `evidence`: source references for the original and revision excerpts.
- `certainty`: `evidenced`, `inferred`, or `uncertain`.

Call out changes in requirement strength only when the text supports the
direction. Examples include changing `must` to `may`, removing a required
condition, adding a measurable threshold, narrowing an actor, or converting a
pass/fail criterion into a suggestion. Mere wording cleanup is not a
strengthening or weakening.

### 5. Detect review flags

Create a review flag only when it is grounded in exact source evidence:

- `unintended_scope_change` — a material scope expansion, contraction, or
  boundary change has no supplied evidence that it was authorized or intended.
  This flags the absence of authorization evidence; it does not claim to know
  the author's intent.
- `contradiction` — two explicit statements cannot both hold, either within a
  version or across the original and revision.
- `requirement_weakened` — a formerly required behavior, condition, or
  acceptance criterion is made less mandatory or less verifiable.
- `requirement_strengthened` — the revision adds a stronger obligation,
  narrower condition, threshold, or pass/fail requirement.
- `identity_mismatch` — both sources provide identities and their repository
  or issue number differs.
- `incomplete_source` — unavailable source content could materially affect the
  comparison.

For each flag include severity (`blocker`, `major`, `minor`, or `info`), exact
evidence, potential impact, certainty, and whether review is required. Use
`uncertain` when the text proves a change but not whether it was intended.
Do not turn every added section, clearer sentence, or missing optional detail
into a scope-drift flag.

### 6. Set status and recommendation

Use `compared` when both sources were validated and the semantic comparison is
trustworthy. Use `partial` when the text can be compared but a material source
field is unavailable; list that field and explain the limitation. Use
`blocked` when either source cannot be validated or usable title/body text is
missing.

Recommend at most one follow-up Skill:

- `rewrite-github-issue` when the comparison identifies decisions that need an
  interview, approval, or publication handoff.
- `assess-issue-quality` when the user requests a separate quality assessment.
- `analyze-issue` when a loaded original needs a deeper evidence-based
  readiness analysis.
- `none` when no follow-up is justified or the comparison is blocked.

Do not invoke the recommendation automatically.

## Output contract

First give a concise summary in the conversation language. Then return one
English version-1 `IssueRevisionComparison` result:

```yaml
status: compared
original:
  source_type: pasted_text
  contract: pasted_text
  version: null
  identity: null
  title: "Add export"
  body_reference: "original.body"
  unavailable_fields: []
revision:
  source_type: rewritten_issue
  contract: rewrite-issue
  version: null
  identity: null
  title: "Add CSV export for filtered results"
  body_reference: "revision.rewritten_issue.body"
  unavailable_fields: []
summary:
  added: 1
  removed: 0
  modified: 1
  unchanged: 0
  material_change_count: 2
diff:
  added:
    - id: D-001
      category: requirement
      location:
        original: null
        revision: revision.body.requirements[0]
      original_text: null
      revision_text: "Export the filtered results as CSV."
      purpose: "Makes the candidate format an explicit revision requirement."
      potential_impact: "May constrain implementation and verification to CSV output."
      evidence: [revision.body.requirements[0]]
      certainty: evidenced
  removed: []
  modified:
    - id: D-002
      category: acceptance_criterion
      location:
        original: original.body.paragraph[0]
        revision: revision.body.acceptance_criteria[0]
      original_text: "Users need to export filtered results."
      revision_text: "Users can export exactly the active filtered result set."
      purpose: "Changes an outcome statement into a more specific observable behavior."
      potential_impact: "Adds a testable active-filter condition that implementation must preserve."
      evidence:
        - original.body.paragraph[0]
        - revision.body.acceptance_criteria[0]
      certainty: evidenced
  unchanged: []
review_flags: []
neutrality_note: "This result reports evidenced textual and semantic differences; it does not rank the original or revision."
recommended_next_skill: none
failure: null
```

`original_text` is `null` for an added item and `revision_text` is `null` for
a removed item. Keep excerpts exact and short enough to review. For
`unchanged` entries, use both excerpts and state that no semantic change was
identified.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | One or both sources are absent. | `blocked`; request exactly one original and one revision source. |
| `invalid_input` | A source has the wrong shape, missing title/body fields, invalid identity, or an invalid status. | `blocked`; do not compare guessed values. |
| `unsupported_version` | A `LoadedIssue` or `IssueDraft` contract version is unsupported. | `blocked`; request a compatible handoff. |
| `blocked_source` | A supplied source is explicitly blocked or failed to load/rewrite. | `blocked`; preserve known identity only and do not fabricate text. |
| `incomplete_source` | Text is available but a material source field needed for a reliable comparison is unavailable. | `partial` only when the limitation is clearly recorded; otherwise `blocked`. |
| `comparison_failure` | An unexpected local failure prevents reliable alignment or reporting. | `blocked`; do not return a fabricated or silently truncated diff. |

For blocked results, return empty diff lists and review flags unless a proven
identity mismatch can be reported without using unavailable content. `failure`
must contain `code`, `message`, `operation`, and `retryable`. Never expose
credentials, tokens, private keys, `.env` contents, or unnecessary raw CLI
output.

## Contract invariants

- `original` and `revision` preserve the source type, explicit identity,
  title, body reference, and unavailable fields without inventing values.
- Only original/revision title and body text are compared; labels, comments,
  state, and publication metadata are not silently converted into requirements.
- Every semantic item appears in exactly one of `added`, `removed`, `modified`,
  or `unchanged`.
- Added, removed, and modified entries explain potential impact; unchanged
  entries do not imply a behavioral change.
- Every review flag has source evidence and distinguishes observed change from
  uncertain authorization or intent.
- A comparison never contains a `preferred_version`, quality score, or
  unsupported conclusion that one version is better.
- `failure` is `null` for `compared` results and non-null for `partial` or
  `blocked` results.
