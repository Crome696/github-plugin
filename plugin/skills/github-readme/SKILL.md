---
name: github-readme
description: Create or improve evidence-based GitHub README.md files with a branded hero, adaptive Mermaid architecture, progressive-disclosure sections, technical validation, and review-first diffs.
metadata:
  short-description: Draft evidence-based GitHub READMEs
---

# GitHub README

Create a professional GitHub `README.md` from repository evidence. Use this skill when the user asks to create, standardize, audit, or improve a repository README, especially when the README should include a banner, badges, project structure, or a Mermaid architecture diagram.

Do not use this skill for general prose editing, product documentation that is not repository-grounded, or documentation that belongs in a separate long-form docs site.

## Operating contract

- Work in `draft` mode by default: inspect, propose, validate, and show a diff before changing files.
- Apply changes only after the user explicitly approves the proposed README and any asset changes.
- Treat repository code, configuration, CI, manifests, and existing documentation as the factual source of truth.
- Use a user brief for audience, tone, and branding, but do not let an unverified brief silently override repository facts.
- Default to English, external users plus maintainers, progressive disclosure, and a brand-forward but maintainable visual hierarchy.
- Prefer existing repository assets for the hero/banner. Do not invent a logo, product claim, badge, status, command, version, deployment target, or integration.
- Treat banner sizing as both an intrinsic-asset and rendered-layout decision: for a dense 2:1 raster hero, prefer a proportional source around 1280x640 and a responsive rendered width of roughly 70-75% of the README content width; do not default to `width="100%"` when that makes the first screen excessively tall.
- Never copy secrets or private local paths into the README. Treat `.env`, credentials, tokens, and key material as sensitive even when they are present in the repository.
- Keep architecture diagrams evidence-first. If the repository does not expose at least two verifiable components or a concrete flow, report the missing evidence instead of fabricating a diagram.

## Workflow

### 1. Discover the repository

Locate the canonical README candidate and inspect the repository with targeted searches. Check the root `README.md`, `.github/README.md`, `docs/README.md`, and other repository-local README candidates (including nested package or application READMEs) when present. Distinguish the repository's canonical README from subsidiary documentation by ownership, links, package boundaries, and existing navigation. If more than one plausible canonical candidate remains, block the draft and any write until the conflict is resolved.

Inspect only the files needed to establish the project profile:

- manifests and package metadata (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, and comparable files);
- source entry points, routes, public APIs, commands, and module boundaries;
- build, test, lint, and CI configuration;
- deployment files such as Docker, Compose, workflow, and infrastructure definitions;
- existing docs, license, contribution guidance, examples, and support links;
- existing logos, banners, SVGs, screenshots, and other brand assets, including their intrinsic dimensions and aspect ratios.

Build an internal evidence ledger with `source_path`, `source_location`, `fact`, and `confidence`. Prefer executable/configuration evidence over prose. Do not scan or quote secret-bearing files.

### 2. Resolve only material unknowns

Infer the project type, audience, runtime, package manager, entry points, integrations, data flows, deployment targets, and brand assets from the repository. Ask only questions that materially change the README, such as an unresolved audience, canonical install command, public demo, or approved banner asset. Keep questions concise and do not ask for facts already discoverable from the repository.

### 3. Select the fixed README spine

Read [references/readme-contract.md](references/readme-contract.md) before drafting. Preserve this order and omit only chapters that are not relevant or not evidenced:

1. Hero and project snapshot
2. What it does
3. Key features
4. Architecture
5. Project structure
6. Getting started
7. Usage and examples
8. Configuration
9. Development and testing
10. Deployment and operations
11. Security, data, and limitations
12. Contributing and support
13. License and credits

The hero, project snapshot, purpose statement, and getting-started path form the minimum useful entry point. Use the README as an entry layer; link or collapse deep operational and API detail where appropriate. Do not add empty headings or placeholder sections.

### 4. Generate the architecture view

Read [references/mermaid-guidelines.md](references/mermaid-guidelines.md) when the repository has a meaningful architecture or flow. Choose one focused diagram type based on the project profile. Include only evidenced nodes and edges, mark external dependencies clearly, keep labels short, and use a GitHub-compatible ` ```mermaid ` fence. Add a second diagram only when one overview would make independent flows unreadable.

### 5. Draft without mutating

Create the proposed README in memory and preserve useful existing content, links, examples, and project-specific wording. Use existing brand assets through relative paths and provide accessible alt text. Use only verified badges and commands. Keep the first screen concise and scannable.
- For public repositories (including archived ones), include a compact row of verified badges in the hero. When the repository is archived, include an `Archived` badge derived from the repository's archived status. If the existing README/assets do not already contain badge-worthy evidence, generate the badge(s) from repository evidence (for example: license, CI/workflow status, release/package metadata) rather than omitting them. Never invent badge links; if badge evidence is genuinely unavailable, surface the evidence gap as an `open question` in the review.
- For an existing raster hero, preserve the artwork and aspect ratio. If the source is materially larger than the target, create a proportional derived copy at no more than about 1280 pixels wide for a 2:1 banner; do not crop or redraw user-provided branding unless explicitly requested.
- Use centered HTML for a responsive hero when sizing matters, omit a fixed height, and normally set a 2:1 banner to `width="70%"` or `width="75%"` after visually checking the rendered height. A flatter asset may use a wider display width.

### 6. Validate the proposal

Read [references/quality-gates.md](references/quality-gates.md) before the final review. When the validator is available, run:

```text
python scripts/validate_readme.py --repo <repository-root> --readme <readme-path>
```

Check Markdown fences and headings, relative links and images, Mermaid blocks, command provenance, placeholder text, secrets, and evidence-backed claims. If a local Mermaid renderer is unavailable, say that rendering was not locally verified rather than claiming success.
- Check local raster dimensions, aspect ratio, and the hero's rendered width. Flag an oversized 2:1 source or a full-width 2:1 hero that is likely to dominate the first viewport; treat this as a warning or note unless it harms readability.

### 7. Present the review gate

The draft response must include:

1. repository profile and detected audience;
2. selected and omitted sections with reasons;
3. evidence summary and unresolved questions;
4. proposed README content or a focused diff;
5. Mermaid diagram type and code;
6. validation findings with `blocker`, `warning`, or `note` severity;
7. the exact files that would change after approval.

Do not write `README.md` or create a banner merely because a draft was generated.

### 8. Apply only explicit approval

After the user explicitly approves the proposal, update only the confirmed files. Preserve unrelated worktree changes. Re-run the validator after writing and report the resulting paths and findings. If approval is partial, apply only the approved subset and keep the remaining suggestions in the review.

## Supporting references

- Read [references/readme-contract.md](references/readme-contract.md) for the section contract, visual hierarchy, and merge behavior.
- Read [references/mermaid-guidelines.md](references/mermaid-guidelines.md) for project-type mapping, evidence rules, and safe diagram patterns.
- Read [references/quality-gates.md](references/quality-gates.md) for deterministic checks, severity levels, and review output.

## Response contract

In draft mode, lead with the proposed outcome and keep the review self-contained. Distinguish `verified`, `inferred`, and `open question` facts. Never present an unverified command, badge, link, architecture edge, version, or deployment detail as confirmed.
