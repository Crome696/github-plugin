---
name: update-repository-metadata
description: Derives and applies an evidence-backed GitHub repository About description and Topics payload for exactly one verified repository. Use only with a version-1 RepositoryMetadataUpdate handoff containing the exact target, description, complete Topics list, and write authorization; never change other repository metadata.
---

# Update Repository Metadata

Prepare or apply one exact repository metadata update for one verified GitHub
repository. The Skill owns repository identity verification, bounded evidence
collection, description and Topic proposal, the exact authorization boundary,
the immediate pre-write conflict check, one logical metadata operation, and
post-write verification. It does not own release orchestration and it does not
implement repository-specific source, framework, domain, or testing logic.

## Boundaries

- Keep the structured handoff and durable report in English. Match questions
  and conversational status updates to the conversation language.
- Require exactly one explicit GitHub repository identity. Accept a verified
  `RepositoryContext v1` when supplied, but never infer the target from the
  current directory, Git remote name, branch name, issue text, or a filename.
- Read and update only the GitHub About `description` and `topics` fields.
- Never change homepage, visibility, default branch, repository settings,
  issues, pull requests, labels, milestones, branches, source files, or any
  other repository field.
- Never read or expose credentials, tokens, private keys, `.env` contents, or
  unnecessary repository data.
- Do not use this Skill to publish a release, rewrite an issue, update a pull
  request, or reconcile metadata for more than one repository.
- Do not use a fixed description or Topic preset. The current repository may
  be an evidence-backed example, but its values are not global defaults.
- A suggestion, routine issue/commit/pull-request/merge authorization, or
  summary is not metadata-write authorization. The handoff must bind the exact
  repository and exact final description and Topics payload.

## Input contract

Accept one version-1
[`RepositoryMetadataUpdate`](../../shared/schemas/RepositoryMetadataUpdate.yaml)
handoff. A proposal-only input may use `status: draft`; an external write
requires `status: approved`, `authorization.exact_payload: true`, and
`authorization.update_authorized: true`.

When exact write authorization is absent, return the evidence-backed preview
as proposal-only `status: draft` with `operation.status: not_started`; never
publish the suggested description or Topics list. If an input claims to be an
approved write but fails the exact authorization gate, return `status: blocked`
with `failure.code: approval_missing` and no external write.

The repository identity must contain mutually consistent owner, name,
full-name, and URL values. A supplied `RepositoryContext v1` must identify the
same repository. Reject missing, ambiguous, cross-repository, inaccessible,
or contradictory identities before reading or writing metadata.

The approved payload is exactly:

```yaml
authorization:
  exact_payload: true
  update_authorized: true
  source: task_intent
  task_scope: "owner/repository About description and Topics"
  approved_payload:
    description: "Exact approved repository description"
    topics:
      - github
      - developer-tools
```

`approved_payload` may contain only `description` and `topics`. `description`
is the exact final value; a derived update must be concise and non-empty. An
explicitly authorized clear is represented only by an exact approved empty or
null value; the Skill never invents a clear operation. `topics` is the exact
complete final list, not only the additions.

## Evidence rules

Use bounded, attributable sources such as:

- the canonical README and linked repository documentation;
- authoritative plugin, package, runtime, and host manifests;
- executable runtime and tool declarations;
- current GitHub repository metadata;
- a verified `RepositoryContext v1` handoff;
- directly relevant repository rules and configuration.

Record one evidence item for each material description or Topic claim. Every
item must identify its source, kind, claim, certainty, and availability.
Classify certainty as `direct`, `inferred`, or `uncertain`; classify
availability as `available`, `unavailable`, `conflicting`, or `not_applicable`.

Treat a technology as direct only when the source explicitly establishes it.
Inferences may support a proposal when clearly labeled, but uncertainty or
contradiction must remain visible. Do not derive Topics from directory names
alone, generic ecosystem assumptions, unsupported framework guesses, or
unrelated issue text. Insufficient, unavailable, or contradictory evidence
returns `blocked` or `draft`/review-required evidence and performs no write.

Normalize proposed Topics to unique lower-case hyphenated values. Preserve
existing relevant Topics unless an exact approved removal is present and the
evidence identifies the Topic as stale or irrelevant. Do not silently remove
or replace live Topics.

## Workflow

### 1. Validate identity, authorization, and input

Validate the contract version, repository identity, status, description type,
Topic uniqueness, Topic normalization, supported payload keys, and evidence
references before any write. Require the exact payload and authorization flags
before entering the write path. Check GitHub authentication without exposing
sensitive output:

```text
gh auth status
```

If the required GitHub capability or authentication is unavailable, return
`blocked` with `auth_unavailable` and no external write.

### 2. Read current metadata and build the proposal

Read exactly one repository, using the verified full name:

```text
gh repo view <owner>/<repository> --json nameWithOwner,url,description,repositoryTopics,homepageUrl,visibility,defaultBranchRef,primaryLanguage,licenseInfo,updatedAt
```

Treat the live response as the source of truth. Verify the returned identity,
record the current description and Topics, and snapshot protected fields for
post-write preservation checks. A missing or contradictory identity, current
description, or Topics value is a validation failure, not an empty default.

Derive the description from authoritative repository purpose evidence. Derive
Topics only from evidenced project domains, languages, runtimes, frameworks,
or supported host ecosystems. Record the exact Before/After preview for
description and Topics, the evidence used for each proposed value, and the
live fields that will be preserved. Keep the description concise,
human-readable, and within GitHub's supported repository-description
constraints. A `draft` result stops after this preview.

If the exact final description and complete Topic list already equal the live
values, return `status: no-op` and `operation.status: no_op` without a write.
The result must still preserve the target identity, proposal evidence, and
verification of the aligned fields.

### 3. Confirm the exact authorization boundary

For a write, confirm that `authorization` binds all of the following:

- the exact verified repository;
- the exact final description;
- the exact complete final Topic list;
- the exact task scope and authorization source; and
- `exact_payload: true` and `update_authorized: true`.

Do not treat an existing issue, commit, pull-request, merge, or routine
delivery approval as repository metadata authorization unless this handoff
explicitly binds the repository and the exact `{description, topics}` payload.

### 4. Refresh the concurrency baseline

Immediately before dispatching the external operation, repeat the exact
repository read. Compare the returned repository identity, current
description, and current Topics with the preview baseline. If any differs,
return `status: blocked`, `failure.code: edit_conflict`, and
`operation.status: not_started`; do not write, retry, or silently regenerate a
different payload.

A change to an unrelated protected field is preserved as fresh evidence and
must be reported if it prevents the preservation check. It never authorizes
changing that field.

### 5. Apply one logical metadata operation

When the final values are not already aligned, perform one high-level
repository edit containing only description and Topic flags:

```text
gh repo edit <owner>/<repository> --description "<exact description>" [--add-topic "<topic>"] [--remove-topic "<topic>"]
```

Compute additions and removals from the refreshed live Topic baseline and the
exact approved final list. Pass no homepage, visibility, default-branch,
settings, issue, pull-request, label, milestone, branch, or source flags.
Use the host's safe argument or CLI transport facilities for exact values and
keep diagnostics sanitized.

The one high-level invocation is the logical mutation boundary. GitHub may
perform description and Topic sub-operations separately; do not claim
HTTP-level atomicity. If the invocation or subsequent verification shows that
one effect succeeded while another failed or is uncertain, return `partial`,
preserve the exact observed effects, and do not retry or roll back.

### 6. Verify the final repository state

After every dispatched write, fetch the exact repository again with the same
identity and metadata fields. Verify:

- the returned repository is the exact approved repository;
- the live description exactly equals the approved description;
- the live Topic list exactly equals the approved complete list after GitHub's
  documented normalization;
- homepage, visibility, default branch, and every other captured protected
  field remain unchanged; and
- the verification response is complete and attributable.

Return `updated` only when the write occurred and all requested and protected
field checks pass. Return `partial` when a write occurred or may have
occurred but identity, final metadata, preservation, or verification evidence
is incomplete or contradictory. Return `blocked` only when no external write
occurred.

## Failure modes

Use these stable failure codes:

| Code | Meaning | Result |
| --- | --- | --- |
| `missing_identity` | Required repository identity is absent. | `blocked` |
| `ambiguous_identity` | Supplied identity fields or repository candidates conflict. | `blocked` |
| `repository_not_found` | The exact repository cannot be read. | `blocked` |
| `auth_unavailable` | GitHub authentication or the required host capability is unavailable. | `blocked` |
| `permission_denied` | GitHub rejects the requested metadata operation. | `blocked` or `partial` when an effect is uncertain. |
| `evidence_insufficient` | Authoritative evidence cannot support the proposal. | `blocked` |
| `evidence_conflict` | Relevant sources contradict one another without a safe resolution. | `blocked` |
| `invalid_payload` | Unsupported fields, invalid types, duplicates, or invalid Topic normalization are present. | `blocked` |
| `approval_missing` | Exact payload or write authorization is absent or does not bind the target. | `blocked` |
| `edit_conflict` | Repository identity, description, or Topics changed after preview. | `blocked` |
| `api_failure` | A repository read or logical edit failed. | `blocked` or `partial` according to observed external effect. |
| `verification_incomplete` | A dispatched operation cannot be fully verified. | `partial` |

Every non-success result must state the phase, whether an external write
occurred, the exact evidence available, and whether retrying is allowed. This
Skill never retries an ambiguous write and never performs an automatic
rollback.

## Completion report

Return one English `RepositoryMetadataUpdate v1` result containing:

```markdown
## Status
draft | no-op | updated | partial | blocked

## Target
- Repository:
- URL:
- Operation: not_started | no_op | updated | partial
- Requested fields: description, topics, or none
- Dispatched fields: description, topics, or none
- External effects:

## Preview
- Description: before -> after
- Topics: before -> after
- Preserved fields:

## Authorization
- Exact payload approved:
- Update authorized:
- Source and task scope:
- Evidence:

## Verification
- [PASS|FAIL|UNKNOWN] Target identity — evidence
- [PASS|FAIL|UNKNOWN] Description — evidence
- [PASS|FAIL|UNKNOWN] Topics — evidence
- [PASS|FAIL|UNKNOWN] Protected fields — evidence

## Failure
- None, or code, phase, message, external-write state, and retryability.
```

Never claim `updated` without a confirmed write and exact final verification.
