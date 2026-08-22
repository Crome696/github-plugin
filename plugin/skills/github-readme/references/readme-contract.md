# README Contract

This reference defines the content and visual contract for a professional GitHub README generated or reviewed by `github-readme`.

## Fixed spine with selective chapters

Keep the following order. Omit a conditional chapter only when it is not relevant to the detected project type or no reliable repository evidence supports it.

| Order | Chapter | Default policy |
| --- | --- | --- |
| 1 | Hero and project snapshot | Required |
| 2 | What it does | Required |
| 3 | Key features | Required when the repository exposes distinct capabilities |
| 4 | Architecture | Required for code, service, data, or infrastructure repositories when a meaningful flow is evidenced |
| 5 | Project structure | Include when the repository has a useful module or package layout |
| 6 | Getting started | Required for an executable, installable, or consumable project |
| 7 | Usage and examples | Include when a consumer-facing invocation or example is available |
| 8 | Configuration | Include when environment, config files, flags, or settings are part of operation |
| 9 | Development and testing | Include when contributor or maintainer workflows are discoverable |
| 10 | Deployment and operations | Include when deploy, hosting, runtime, or operational evidence exists |
| 11 | Security, data, and limitations | Include when the project handles data, credentials, permissions, or meaningful constraints |
| 12 | Contributing and support | Include when contribution, issue, support, or maintainer guidance exists |
| 13 | License and credits | Include confirmed license, attribution, and credits; flag missing licensing evidence |

Do not render empty headings, `TBD`, `TODO`, `Not applicable`, or generic filler merely to satisfy the order.

## Hero and snapshot

The hero should answer what the project is and why it matters without requiring the reader to scroll.

Preferred composition:

1. existing banner, logo, or screenshot when available;
2. project title;
3. one-sentence value proposition;
4. a compact row of verified badges;
5. quick links only when their targets are confirmed.

Badge row rule:
- For public repositories (including archived ones), the hero must include a compact row of verified badges.
- When a repository is archived, include an `Archived` badge derived from the repository's archived status.
- Do not fabricate badge links. If badge-worthy evidence does not exist, omit the badge row and surface the missing evidence as an `open question` in the review.

Use the description pattern:

> `[Project] is a [project type] for [audience] that [primary outcome].`

The snapshot may contain a compact table or definition list for verified facts such as status, runtime, package manager, license, supported platforms, demo, and documentation. Omit unknown fields instead of using guessed values.

## Visual rules

- Prefer the repository's existing visual identity and assets.
- Use relative image paths and meaningful alt text.
- Keep the badge row focused on high-signal facts such as CI, license, release, coverage, or package availability.
- Do not add more than six badges unless the user explicitly requests a larger status panel.
- Use text equivalents for information conveyed by color or imagery.
- Use GitHub-compatible Markdown and restrained HTML only when it improves the hero layout or accessibility.
- Keep the first screen clean; move advanced content into later chapters or a linked document.
- Do not create a new binary banner in the default workflow. If no asset exists, use a strong typographic hero and report the missing asset as an optional follow-up.

### Banner sizing

- Treat the source dimensions and the rendered README width as separate decisions.
- For a dense side-panel raster hero, use a proportional source near `1280x640` (`2:1`) when the existing artwork supports that ratio. This is a practical default, not a GitHub-mandated size.
- If an existing raster is materially larger, resize a derived copy proportionally with high-quality resampling. Do not crop, stretch, redraw, or infer new visual claims from a user-provided asset.
- Center a 2:1 hero and normally render it at `width="70%"` to `width="75%"`; omit a fixed `height` so GitHub preserves the aspect ratio. Use a wider display only when the asset is substantially flatter or a visual check shows that the hero remains proportionate.
- At a reference GitHub README content width of roughly `830px`, keep a 2:1 hero near or below `300-320px` rendered height where practical. Reduce the display width when the first screen becomes dominated by the image.
- Prefer a reasonably compressed local asset and report unusually large files as a review note. GitHub has no universal README-banner dimension standard, so the rendered result remains the final check.

## Content rules by project type

### Libraries and SDKs

Prioritize installation, supported runtime, primary API path, short usage example, compatibility, and module architecture. Do not claim API stability unless release or documentation evidence supports it.

### CLI tools

Prioritize prerequisites, install command, command examples, input/output behavior, configuration flags, and exit or error behavior when evidenced.

### Web applications and APIs

Prioritize user or client value, local startup, main flows, runtime components, integrations, persistence, environment configuration, and deployment path.

### Data and infrastructure repositories

Prioritize inputs, transformations, outputs, providers, environments, operational assumptions, and security boundaries. Use a data-flow or deployment-oriented architecture diagram rather than a generic application diagram.

### Monorepos

Describe the workspace as a product or platform, then summarize apps, packages, shared tooling, and relevant cross-package flows. Keep internal detail out of the main diagram unless it changes how the repository is used or operated.

### Documentation-only repositories

Describe the audience, documentation scope, navigation, contribution workflow, and publication process when evidenced. Do not invent a software architecture diagram.

## Progressive disclosure

The first screen should cover purpose, audience, capabilities, and the path to getting started. Architecture and examples should be understandable without reading every implementation detail. Maintainer, deployment, security, and contribution details belong later in the fixed spine or in linked documents.

Do not add a manual table of contents by default. Add a small navigation block only when the final README is long enough that the generated GitHub outline is not sufficient for the intended audience.

## Existing README merge policy

When improving an existing README:

- preserve useful custom content and working links unless the user approves removal;
- map existing material into the fixed spine before rewriting it;
- retain project-specific examples that remain valid;
- replace stale or contradicted claims only when repository evidence supports the correction;
- show non-trivial deletions and moves in the review diff;
- keep unrelated documentation files untouched unless the user explicitly includes them.
