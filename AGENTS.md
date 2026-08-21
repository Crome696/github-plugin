# Standalone GitHub Plugin

This repository publishes the standalone CromeSDK `github` plugin. The
Marketplace source is `plugin/`; repository-local Node/Vitest test tooling is
intentionally not tracked and is not part of the installed plugin.

## Repository boundaries

- `plugin/` contains the installable plugin manifests, Skills, Agents,
  Commands, Rules, Hooks, Shared Contracts, documentation, and assets.
- Repository-local test runners, fixtures, Node package metadata, TypeScript
  configuration, and Vitest configuration are intentionally not tracked.
- The plugin owns GitHub issue and pull-request collaboration and delivery
  coordination. Source-code implementation, framework architecture,
  project-specific testing, domain knowledge, and product behavior remain
  external capabilities.

## Identity and version synchronization

- Plugin name: `github`
- Marketplace name: `github-plugin`
- Package version: `0.3.120`
- License: MIT
- Homepage: https://github.com/Crome696/github-plugin
- Default branch: `master`

Keep version `0.3.120` synchronized across:

- `plugin/plugin.json`
- `plugin/.cursor-plugin/plugin.json`
- `plugin/.codex-plugin/plugin.json`
- `plugin/.claude-plugin/plugin.json`
- `.cursor-plugin/marketplace.json`
- `.claude-plugin/marketplace.json`
- `.agents/plugins/marketplace.json`

All Marketplace entries must point to `./plugin`. Do not point a Marketplace
entry at the repository root, because the root also contains non-installable
repository documentation and release history.

## Packaging rules

- Do not reintroduce repository-local test runners, fixtures, package metadata,
  TypeScript configuration, or Vitest configuration under `plugin/`.
- Keep paths declared by plugin manifests relative to the plugin root, such as
  `./skills/`, `./agents/`, `./commands/`, `./rules/`, and `./assets/logo.png`.
- Repository-local capability references use the standalone `plugin/` prefix.
  External implementation, testing, security, and documentation capabilities
  remain host-session identities and must not be copied into this plugin.
- Keep durable plugin artifacts in English and preserve exact external API
  text and user-provided values where fidelity is required.

## Validation

Run these commands from the repository root after changing plugin artifacts or
contracts:

```text
git diff --check
node --check plugin/hooks/generate-project-hooks.mjs
node plugin/hooks/generate-project-hooks.mjs --help
```

`node plugin/hooks/generate-project-hooks.mjs --hosts <hosts> --target <path>`
executes the generator directly without a repository-local package script.

Project-specific implementation and testing remain external capabilities. Do
not present the absence of the removed local test workspace as successful test
execution evidence.

The technical plugin entry point is
[`plugin/docs/README.md`](plugin/docs/README.md). The root
[`README.md`](README.md) explains the standalone packaging and test boundary.
