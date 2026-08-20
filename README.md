<p align="center">
  <img src="docs/assets/hero.png" alt="GitHub Plugin illustration for AI-assisted planning, implementation, testing, review, and release workflows" width="75%">
</p>

# CromeSDK GitHub Plugin

This repository publishes the standalone CromeSDK `github` plugin for
evidence-backed GitHub issue and pull-request collaboration. The installable
plugin lives in [`plugin/`](plugin/); the contract and scenario tests live in
[`tests/`](tests/) and are intentionally outside the Marketplace source.

[Plugin documentation](plugin/docs/README.md) ·
[Contributing guidance](AGENTS.md) ·
[Changelog](CHANGELOG.md) ·
[License](LICENSE) ·
[Repository](https://github.com/Crome696/github-plugin)

## Project snapshot

| Snapshot | Value |
| --- | --- |
| Status | Standalone workflow plugin |
| Version | `0.3.111` |
| License | MIT |
| Plugin name | `github` |
| Marketplace name | `github-plugin` |
| Installable source | `./plugin` |
| Test workspace | `./tests` |
| Hosts | Cursor, Codex, GitHub Copilot, Claude |
| Repository | [Crome696/github-plugin](https://github.com/Crome696/github-plugin) |

## What it does

The plugin coordinates evidence-backed GitHub collaboration from issue
preparation through pull-request integration. It provides read-only issue,
repository, pull-request, review, feedback, branch, and check analysis plus
task-authorized delivery workflows for branches, worktrees, commits, pushes,
issue linkage, Draft pull requests, review-fix loops, CI-fix loops,
Ready-for-Review, target refreshes, rebases, merges, issue-closure
verification, and independent cleanup decisions.

The plugin does not implement product or project source code, framework
architecture, domain behavior, or project-specific test design. Those remain
external capabilities resolved by the host session.

## Package boundary

Marketplace manifests at the repository root all point to `./plugin`:

- [Cursor marketplace](.cursor-plugin/marketplace.json)
- [Claude marketplace](.claude-plugin/marketplace.json)
- [Agents marketplace](.agents/plugins/marketplace.json)

Only the `plugin/` directory is the installable plugin source. The root
`tests/` directory, test fixtures, Node package metadata, TypeScript config,
and Vitest config are development artifacts for this repository and are not
inside the Marketplace source.

## Plugin structure

```text
plugin/
├── .claude-plugin/plugin.json
├── .codex-plugin/plugin.json
├── .cursor-plugin/plugin.json
├── agents/
├── assets/
├── commands/
├── docs/
├── hooks/
├── rules/
├── shared/schemas/
├── skills/
├── AGENTS.md
├── README.md
└── plugin.json
```

The technical entry point for the plugin is
[`plugin/docs/README.md`](plugin/docs/README.md). It describes the workflow
architecture, approval gates, external capability boundary, Shared Contracts,
failure handling, and extension points.

## Development and testing

The repository test workspace is private and exists to validate the published
plugin source. It includes contract tests for all Shared Contract descriptions,
manifest synchronization, hook generation, handoff graphs, payload
validation, deep invariants, and deterministic command scenarios.

Run the complete validation from the repository root:

```text
npm ci
npm run typecheck
npm test
npm run check
```

Regenerate the minimal valid contract fixtures when a Shared Contract changes:

```text
npm run fixtures:generate
```

This command regenerates the checked-in minimal contract fixtures. Review its
diff before keeping it: scenario and deep-invariant tests may rely on richer
hand-authored fixture values, so unrelated fixture rewrites must be restored
or merged deliberately.

The generator command is also available from the root package scripts:

```text
npm run generate-project-hooks
```

The script invokes the installable generator at
`plugin/hooks/generate-project-hooks.mjs`.

When changing plugin identity, keep version `0.3.111` synchronized across the
four manifests under `plugin/` and the three root Marketplace manifests. When
changing a Skill, Agent, Command, Rule, Hook, or Shared Contract, update the
corresponding plugin inventory and run the typecheck and full test suite.

## Security and safety boundaries

- GitHub writes require the exact authorization and current identity evidence
  described by the relevant Skill and Shared Contract.
- Hooks fail closed before protected commit, pull-request, review, rebase,
  Ready-for-Review, and merge operations when their gate evidence is missing,
  stale, or mismatched.
- The plugin never packages external implementation capabilities or claims
  ownership of project-specific source code and tests.
- Secrets, tokens, credentials, and confidential values must not be copied into
  plugin artifacts, GitHub content, commits, pull requests, or logs.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

Copyright (c) 2026 Crome696.
