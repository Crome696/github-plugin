# Standalone GitHub Plugin

This repository publishes the standalone CromeSDK `github` plugin. The
Marketplace source is `plugin/`; the repository-root test workspace is not
part of the installed plugin.

## Repository boundaries

- `plugin/` contains the installable plugin manifests, Skills, Agents,
  Commands, Rules, Hooks, Shared Contracts, documentation, and assets.
- `tests/` contains contract tests, scenario tests, fixtures, and test
  helpers. It is deliberately outside the Marketplace source.
- `package.json`, `package-lock.json`, `tsconfig.json`, and
  `vitest.config.ts` belong to the repository test workspace and must remain
  outside `plugin/`.
- The plugin owns GitHub issue and pull-request collaboration and delivery
  coordination. Source-code implementation, framework architecture,
  project-specific testing, domain knowledge, and product behavior remain
  external capabilities.

## Identity and version synchronization

- Plugin name: `github`
- Marketplace name: `github-plugin`
- Package version: `0.3.113`
- License: MIT
- Homepage: https://github.com/Crome696/github-plugin
- Default branch: `master`

Keep version `0.3.113` synchronized across:

- `plugin/plugin.json`
- `plugin/.cursor-plugin/plugin.json`
- `plugin/.codex-plugin/plugin.json`
- `plugin/.claude-plugin/plugin.json`
- `.cursor-plugin/marketplace.json`
- `.claude-plugin/marketplace.json`
- `.agents/plugins/marketplace.json`

All Marketplace entries must point to `./plugin`. Do not point a Marketplace
entry at the repository root, because the root also contains the test
workspace.

## Packaging rules

- Do not place `tests/`, test fixtures, test scripts, `package.json`,
  `package-lock.json`, `tsconfig.json`, or `vitest.config.ts` under `plugin/`.
- Keep paths declared by plugin manifests relative to the plugin root, such as
  `./skills/`, `./agents/`, `./commands/`, `./rules/`, and `./assets/logo.png`.
- Repository-local capability references use the standalone `plugin/` prefix.
  External implementation, testing, security, and documentation capabilities
  remain host-session identities and must not be copied into this plugin.
- Keep durable plugin artifacts in English and preserve exact external API
  text and user-provided values where fidelity is required.

## Validation

Run these commands from the repository root after changing plugin artifacts,
contracts, or test helpers:

```text
npm ci
npm run typecheck
npm test
npm run check
npm run fixtures:generate
git diff --check
```

`npm run generate-project-hooks` executes the generator from
`plugin/hooks/generate-project-hooks.mjs` without moving the generator into
the test workspace.

`npm run fixtures:generate` rewrites the checked-in valid fixtures with
minimal schema payloads. Always review the resulting diff; scenario and
deep-invariant fixtures may contain richer hand-authored values that must be
preserved unless the contract change explicitly requires replacing them.

The technical plugin entry point is
[`plugin/docs/README.md`](plugin/docs/README.md). The root
[`README.md`](README.md) explains the standalone packaging and test boundary.
