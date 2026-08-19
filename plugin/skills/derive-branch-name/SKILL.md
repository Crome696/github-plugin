---
name: derive-branch-name
description: Derives a concise, descriptive Git branch name from one issue or task and verified repository conventions. Use automatically when planning or implementation needs a proposed branch name; do not create or modify branches or worktrees.
---

# Derive Branch Name

Derive a concise, descriptive Git branch name from the issue, task, and repository conventions. Follow detected naming patterns and include the issue number when applicable. Prefer lowercase, filesystem-safe names using established separators and meaningful keywords. Avoid unnecessary wording, ambiguity, special characters, and excessive length. Do not invent identifiers or conventions that are not available. Return the proposed branch name, rationale, applied convention, and optional alternatives when multiple valid patterns exist. Do not create or modify branches.

Return exactly one version-1 [`BranchNameProposal`](../../shared/schemas/BranchNameProposal.yaml) handoff. This Skill derives a candidate only; it does not authorize, create, switch, rename, delete, check out, push, or otherwise modify a branch or worktree.

## Boundaries

- Read repository files, read-only Git metadata, and supplied handoffs only.
- Never edit files, Git state, branches, worktrees, remotes, GitHub resources,
  or generated artifacts.
- Do not run installs, builds, tests, formatters, linters, migrations, hooks,
  branch-creation commands, worktree commands, or other change-producing
  operations.
- Do not silently load a GitHub issue, invoke another Skill, choose a
  different repository, or infer repository identity from an arbitrary branch
  name or task number.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive command arguments.
- Do not treat a proposed name as proof that a branch exists, is unused, or is
  authorized for creation.
- Keep the structured handoff and newly authored report text in English. Keep
  questions and explanations in the user's conversation language.

## Input

Accept one task focus containing:

- A task description, issue title and body, or an explicitly supplied request
  summary.
- An optional version-1 [`LoadedIssue`](../../shared/schemas/LoadedIssue.yaml)
  snapshot.
- An optional version-1
  [`IssueAnalysis`](../../shared/schemas/IssueAnalysis.yaml) handoff.
- An optional version-1
  [`RepositoryContext`](../../shared/schemas/RepositoryContext.yaml) handoff.
- An optional version-1
  [`RepositoryConventions`](../../shared/schemas/RepositoryConventions.yaml)
  handoff.
- The current repository checkout as a read-only evidence source when a
  supplied handoff is not sufficient.

At least one task or issue source is required. A verified repository checkout
or `RepositoryContext` is required before reporting a repository-specific
convention. A supplied `RepositoryConventions` handoff is the primary source
for branching evidence when available; do not invoke
`detect-repository-conventions` automatically to fill a missing handoff.

Validate every supplied handoff before using it. Accept only the version-1
contracts named above. Preserve repository identity, source status,
unavailable fields, conflicts, and evidence. If a handoff is malformed or has
an unsupported version, return `blocked` rather than silently substituting
unverified values.

## Evidence and convention model

Use concise evidence references that let a reviewer locate the source:

- `task`, `issue.title`, `issue.body`, or another stable issue source
  reference for request wording.
- `repository:<path>` or `repository:<path>#<symbol>` for repository evidence.
- `git:<metadata>` for sanitized read-only Git evidence such as a branch
  pattern observed in history.
- A supplied handoff field such as
  `RepositoryConventions.conventions[0]` for structured convention evidence.

Classify each naming signal before applying it:

1. **Mandatory** — an applicable explicit instruction or authoritative
   repository configuration, such as `AGENTS.md`, `CONTRIBUTING.md`,
   repository rules, or a documented branch policy.
2. **Observed** — a repeated pattern in branch history, contribution
   documentation, or repository structure that is useful guidance but is not a
   requirement.
3. **Fallback** — generic lowercase, concise, filesystem-safe normalization
   used only when no repository-specific prefix, separator, case rule, or
   issue-number rule is evidenced.

Mandatory branching conventions take precedence over observed patterns. If
mandatory sources conflict, preserve the conflict and return `partial` or
`blocked`; do not choose a precedence order that the repository does not
state. Do not turn an observed pattern into a mandatory rule.

An issue number may be included only when it is explicitly verified from a
loaded issue, a validated issue handoff, or an unambiguous task reference
whose repository identity is verified. Do not extract a number from a date,
version, unrelated prose, an existing branch name, or a guessed issue URL.
Include the number when the applicable pattern requires or clearly supports
it. If the pattern does not use issue numbers, omit it and explain why.

Derive keywords from the issue or task's requested outcome. Keep only
meaningful, implementation-neutral terms. Do not add a product area, ticket
type, owner, framework, or identifier that is not present in the evidence.

## Workflow

### 1. Validate the request and source evidence

1. Confirm that exactly one task or issue focus is available.
2. Validate all supplied handoffs and their versions.
3. Confirm the target repository identity from the checkout or a
   `RepositoryContext`; never infer it from a branch name.
4. Record unavailable inputs and conflicts instead of filling them with
   guesses.

If the task or issue focus is missing, return `blocked` with
`failure.code: missing_input`.

### 2. Build the naming focus

Extract only signals relevant to the branch name:

- the requested outcome and its concise meaningful keywords;
- an explicitly verified issue number, if present;
- explicitly named repository areas when they clarify the outcome;
- explicit non-goals or constraints that prevent ambiguous wording.

Record the normalized summary, keywords, issue number, and named paths in
`focus`. Do not convert a desired behavior into a repository path or
identifier without evidence.

### 3. Collect applicable naming evidence

Inspect the `branching` and `naming` conventions in the supplied
`RepositoryConventions` handoff. Also use applicable repository instructions,
contribution documentation, and sanitized read-only Git history when needed.
For every applied pattern, record:

- the exact pattern or rule;
- its scope;
- whether it is mandatory, observed, or fallback;
- its confidence;
- concrete evidence references.

Consider prefix, issue-number placement, separator, casing, component order,
keyword style, and length limits independently. Do not copy an example branch
literally when its identifier or task words do not match the current source.

### 4. Generate and validate candidates

Generate the smallest set of candidates supported by the evidence:

1. Apply the highest-authority applicable pattern.
2. Include a verified issue number when that pattern calls for it.
3. Use only source-derived keywords and the evidenced separator.
4. Remove unnecessary stop words, duplicated words, and ambiguous filler.
5. Normalize casing according to the pattern; use lowercase for the generic
   fallback.
6. Keep every segment concise and filesystem-safe. Avoid whitespace, control
   characters, special Git ref syntax, trailing separators, repeated
   separators, and excessive length.
7. Validate the candidate against Git branch-name rules with a read-only check
   when available. A validation command must not create or switch branches.

Do not produce alternatives merely by changing word order or punctuation.
Return alternatives only when separate evidenced patterns are both applicable
and materially valid, such as a scoped mandatory pattern and a separately
scoped observed pattern.

### 5. Select the proposal

Choose one candidate and explain:

- why its keywords represent the task;
- how the issue number was handled;
- which prefix, separator, case, and component order were applied;
- why unnecessary or unsupported wording was removed;
- what evidence limits or conflicts remain.

Set `status: proposed` only when the candidate is supported well enough for
downstream planning. Set `partial` when a useful candidate exists but
repository identity, convention coverage, or conflict resolution remains
materially incomplete. Set `blocked` when no defensible candidate can be
returned.

### 6. Return the handoff

Populate `BranchNameProposal` with the source versions and evidence. Set
`recommended_next_skill` to at most one skill, normally
`build-implementation-plan` when the implementation context is ready; leave it
`null` when the next step is not evidenced. Never invoke the recommended Skill.

Set `failure: null` only for `proposed`. For `partial` or `blocked`, include
the failure code, operation, retryability, and exact missing or conflicting
evidence.

## Output contract

Use this English version-1 shape:

```yaml
schema: BranchNameProposal
version: 1
status: proposed
source:
  task_or_issue: "Add an export filter to the reporting workflow."
  issue:
    repository: null
    number: null
    title: null
    url: null
  loaded_issue_version: null
  issue_analysis_version: null
  repository_context_version: 1
  repository_conventions_version: null
  references:
    - task
    - repository:AGENTS.md
  unavailable_inputs:
    - "No repository-specific branch convention was supplied."
focus:
  summary: "The request changes filtering in the reporting export workflow."
  keywords:
    - export
    - filter
  issue_number: null
  paths_of_interest: []
proposal:
  branch_name: export-filter
  rationale: "The name preserves the two meaningful task terms and uses the generic lowercase kebab-case fallback because no repository-specific pattern was evidenced."
  applied_convention:
    description: "No repository-specific branching pattern was evidenced; generic lowercase kebab-case normalization was applied."
    authority: fallback
    confidence: evidenced
    evidence:
      - repository:AGENTS.md
  issue_number_included: false
  issue_number: null
  separator: "-"
  pattern_source: generic_fallback
  keywords:
    - export
    - filter
  normalization:
    - "Converted terms to lowercase."
    - "Joined terms with a hyphen."
alternatives: []
recommended_next_skill: build-implementation-plan
failure: null
```

The example is illustrative only. Replace every source, convention, keyword,
issue number, and branch name with values supported by the current request and
repository evidence.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No single task or issue focus is supplied. | `blocked` |
| `invalid_input` | A supplied handoff cannot be parsed or validated. | `blocked` |
| `unsupported_version` | A supplied handoff has an unsupported schema version. | `blocked` |
| `insufficient_context` | A candidate is possible, but repository identity or relevant convention evidence is materially unavailable. | `partial` |
| `conflicting_conventions` | Applicable mandatory conventions conflict without a repository-defined resolution. | `partial` or `blocked` |
| `invalid_candidate` | No candidate satisfies the evidenced naming rules and safe branch-name constraints. | `blocked` |
| `analysis_failure` | Read-only derivation fails after valid inputs were accepted. | `partial` or `blocked` according to the remaining evidence |
