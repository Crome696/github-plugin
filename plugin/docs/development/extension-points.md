# Extension points

The GitHub plugin is extended by adding bounded collaboration capabilities,
not by adding project implementation knowledge. Every extension must preserve
the plugin's responsibility boundary, structured handoffs, host compatibility,
and independent safety gates.

Start with the inventory and synchronization requirements in
[AGENTS.md](../../../AGENTS.md), the component procedures in
[README.md](../README.md), and the contract rules in
[shared/schemas/README.md](../../shared/schemas/README.md).

## Before adding a component

Answer these questions from repository evidence:

1. Is the behavior GitHub collaboration or repository delivery coordination?
2. Is it a new atomic handoff, an orchestration change, or an existing
   capability enhancement?
3. Which exact repository, issue, pull request, branch, worktree, or revision
   identity does it consume?
4. Which existing Skill, Agent, Command, Rule, Hook, or Contract owns the
   adjacent responsibility?
5. Does the change add a write or a hard operation requiring a new gate?
6. Is the host mapping documented and supported for every target host?
7. Which inventory, source-of-truth documentation, external validation, and
   host-projection updates are required?

Prefer enhancing an existing component when its responsibility remains
coherent. Split a component when its procedure, authorization, or contract
would otherwise mix independent concerns. Do not add a component merely to
duplicate an existing source of truth.

## Adding a Skill

A Skill is the smallest reusable procedure or mutation boundary.

1. Create one directory under [`skills/`](../../skills/) with a `SKILL.md`.
2. Define frontmatter with a stable name and precise description.
3. State the purpose, input evidence, output handoff, boundaries, identity
   checks, failure behavior, and authorization requirements.
4. Keep automatic Skills read-only or diagnostic unless their documented
   operation is bounded and safe. Explicit mutation Skills must document their
   invocation boundary.
5. Add or update a versioned Shared Contract when the handoff is structured.
6. Register the producer/consumer relationship in the Shared Contract
   inventory and the affected source-of-truth documentation.
7. Request or update external contract, invariant, and scenario validation when
   the Skill changes a workflow or safety boundary.
8. Add the Skill to the component inventory in [README.md](../README.md), and
   update [AGENTS.md](../../../AGENTS.md) only when repository policy or
   synchronization requirements change.

The Skill must not silently invoke another Agent, expand a task's scope, or
implement external project behavior.

## Adding an Agent

An Agent orchestrates one user-facing workflow mode. It should:

- accept one verified task, issue, or pull request target;
- sequence existing Skills rather than restating their procedures;
- preserve identity, revisions, scope, evidence, and authorization across
  handoffs;
- ask only bounded questions for material ambiguity or decisions;
- hand every external write to its owning Skill;
- return a structured result or an explicit blocked/partial outcome.

To add one:

1. Create one Markdown file under [`agents/`](../../agents/).
2. Define the activation boundary, mission, source-of-truth Skills, consumed
   and produced Contracts, forbidden operations, and final handoff.
3. Document its consumed and produced Contracts in the affected source-of-
   truth documentation.
4. Add the Agent to the component inventory in [README.md](../README.md) and
   any applicable Command documentation; update the root [AGENTS.md](../../../AGENTS.md)
   only when repository policy or synchronization requirements change.
5. Document happy paths and forbidden operations for the applicable external
   validation capability.

Agents must not become hidden implementation agents or invoke another Agent,
except `lifecycle-agent`, which may start `issue-agent`, `preparation-agent`,
and `delivery-agent` sequentially as subagents and must not duplicate their
Skill procedures or start review, feedback, integration, host-hooks,
product-planner, Ready-for-Review, open-issue-reprioritize, or triage-close Agents. `/implement-auto-issue` starts
it at create; `/refine-auto-issue` starts it at refine for one verified
existing issue and skips create.
For a new workflow, justify why a new Agent is needed instead of a new mode
on an existing Agent.

## Adding a Command

Commands are intentionally thin. A Command may:

1. resolve exactly one repository, issue, or pull request target;
2. select one Agent and optional mode;
3. start that Agent;
4. display the exact result.

A Command must not duplicate Skill sequencing, publish an additional issue or
pull request, perform a GitHub write directly, or invoke another Agent.

To add one:

1. Add the host-supported Command file under [`commands/`](../../commands/).
2. Document the Command-to-Agent relationship in the affected source-of-truth
   documentation.
3. Document the workflow's read/write steps and forbidden operations in the
   relevant Command and Agent sources.
4. Request deterministic external scenario coverage for identity failures,
   write gates, and forbidden operations.
5. Update the component inventory in [README.md](../README.md).

Do not add a portable manifest field for a Command unless the authoritative
host or portable specification defines that field. Host-specific Command
registration stays in the host-specific projection.

## Adding a Shared Contract

Apply the [`plugin-versioning`](../../rules/plugin-versioning.mdc) Rule before
choosing a contract version. It is the policy source for additive, breaking,
and internal changes, public migrations, changelog evidence, and compatibility
with external Skills and Rules.

Use a Contract when a handoff must be stable, validated, and consumed by
another component.

1. Add one YAML description under [`shared/schemas/`](../../shared/schemas/).
2. Define the schema name, version, required fields, field types, enum values,
   identity fields, status semantics, and failure representation.
3. Classify the change under `plugin-versioning`. Breaking changes require a
   version increment; do not reinterpret an existing field under the same
   version.
4. Register the Contract in
   [`shared/schemas/README.md`](../../shared/schemas/README.md).
5. Update producer and consumer references, payload validation requirements,
   and the applicable external validation plan.
6. Preserve unavailable and uncertain evidence instead of adding a permissive
   fallback that turns missing data into success.

Contracts do not grant permission. If a new operation writes GitHub, Git, a
branch, a worktree, or a review state, its authorization and Hook gate must be
explicitly modeled and owned by the relevant Skill.

## Adding or changing a Rule

Rules define policy, not workflow sequencing. A Rule change must:

- remain within the GitHub collaboration scope;
- identify the affected operation, evidence, authorization, and safety
  boundary;
- avoid duplicating another Rule's authority;
- preserve the secret prohibition and explicit hard-operation boundaries;
- update the component inventory in [README.md](../README.md);
- update affected Skills, Hooks, and documentation, and request external
  validation where executable evidence is required.

If a new policy is host-neutral, keep its durable semantics in the plugin's
applicable Rule source. If a host requires an envelope, keep the host-native
projection limited to that envelope and record unsupported mappings as
limitations.

## Adding a Hook

Hooks may observe a declared lifecycle event or enforce a deterministic,
bounded gate. A Hook may not:

- create or edit a candidate, issue, pull request, or active capability;
- approve, release, merge, activate, or authorize an operation;
- make an open-ended product, implementation, or safety judgment;
- expand its file, process, Git, or GitHub observation scope;
- repair a failed gate, rebase conflict, or merge conflict.

The implementation pattern is:

1. Add a host-neutral checker under [`hooks/`](../../hooks/) that validates
   bounded input and returns explicit allow/deny/status evidence.
2. Define or update the local versioned gate Contract.
3. Add separate Cursor and Codex projections in
   [`hooks/cursor-hooks.json`](../../hooks/cursor-hooks.json) and
   [`hooks/codex-hooks.json`](../../hooks/codex-hooks.json).
4. Verify the event name, input shape, timeout, and failure semantics against
   each host's documented contract. Do not copy event names between hosts by
   assumption.
5. Add fail-closed tests for missing, stale, mismatched, and unavailable
   evidence, plus an allow test for the exact valid command.
6. Update the Hook entry in the component inventory in [README.md](../README.md)
   and the host-compatibility reference in the root [README.md](../../../README.md).

The portable [`plugin.json`](../../plugin.json) remains free of Hook
declarations. A post-operation observer must remain read-only and must not
turn completion into cleanup authorization.

## Generating project-host projections

Use the explicit
[`generate-project-hooks`](../../skills/generate-project-hooks/SKILL.md) Skill
to project the existing host-specific Hook configurations into one verified
target repository. The Skill must ask interactively whether to generate Cursor,
Codex, or both; it must not infer a host from arguments, the current runtime,
or existing files. Cursor's thin
[`generate-project-hooks`](../../commands/generate-project-hooks.md) Command
starts `host-hooks-agent`; Codex invokes the Skill directly because Codex does
not register plugin Commands.

The deterministic
[`generate-project-hooks.mjs`](../../hooks/generate-project-hooks.mjs) script
may write only the selected host configuration, checker copies, managed
local-state/transaction ignore entries, its marked `AGENTS.md` guidance block,
and `.github/github-plugin/project-hooks-manifest.json`. It must calculate a
complete desired state before writing, validate every path and ownership proof,
and block rather than overwrite an unrecognized or locally changed file. The
version-1 manifest is a generator-owned target artifact, not a Shared Contract;
its exact-byte and managed-block hash rules are validated in the generator and
through applicable external contract validation. Same-filesystem staging,
journaled backups, controlled rename, rollback, final verification, and
next-run recovery are required. Host
deselection may remove only unchanged artifacts explicitly owned by the prior
manifest; unknown files and user content remain untouched. It must never create
a gate snapshot: runtime gate JSON is evidence written by the owning operation
Skill immediately before the protected operation.

## External capability extension

Project implementation knowledge is an integration point, not a GitHub plugin
file. Use
[`resolve-context-capabilities`](../../skills/resolve-context-capabilities/SKILL.md)
or
[`resolve-feedback-capabilities`](../../skills/resolve-feedback-capabilities/SKILL.md)
to reference an exposed current-session identity. Record intended usage,
availability, required/optional priority, and missing-capability behavior.

Do not:

- copy an external `SKILL.md`, Rule, Agent, test strategy, or framework
  instructions into `plugin/`;
- import a path from a sibling plugin or another external package as if it
  were owned here;
- infer availability from a package name, framework, or repository folder;
- execute or install the resolved capability from the resolver;
- let an external capability alter GitHub approval or Hook policy.

## Cross-plugin and host boundaries

The plugin may reference only repository-local artifacts under
`plugin/` for its own Skills, Rules, Agents, Commands, Hooks, and
assets. Shared marketplace registration does not create dependency ownership
between plugins.

Host-specific behavior must remain in host-specific files:

- Cursor `.mdc` Rules, Agents, Commands, and Hook projections;
- Codex `AGENTS.md` guidance, plugin metadata, and Hook projections;
- portable manifest fields only where the relevant specification defines them.

Use the host manifests and the standalone [repository README](../../../README.md)
as the evidence boundary. Do not invent a portable equivalent for an
unsupported host component.

## Completion checklist

Before considering an extension complete:

- the responsibility is within GitHub collaboration scope;
- no existing component already owns the behavior;
- identity, input, output, status, and failure paths are explicit;
- exact authorization and secret checks exist for every write;
- host projections use documented events and fields;
- schemas, inventories, workflow documentation, and source-of-truth references
  are synchronized;
- the extension does not invoke another Agent or external capability
  implicitly;
- documentation links to the new source of truth without duplicating its
  entire procedure;
- static repository validation passes, including `git diff --check` and syntax
  checks for affected scripts;
- required executable evidence is obtained from the applicable external testing
  capability rather than inferred from the absence of local tests.
