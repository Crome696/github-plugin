# README Quality Gates

Use these gates before presenting a README proposal for approval and again after an approved write.

## Severity levels

- `blocker`: the proposal is technically misleading, contains a high-confidence secret, has an invalid structural element, or documents a command that cannot be supported by the repository.
- `warning`: important context is missing, a path is unresolved, a claim is weakly evidenced, or a local check could not be completed.
- `note`: a low-risk style, scannability, or maintainability improvement.

Every finding should include a short code, severity, message, and location when one exists.

## Required checks

### Repository and merge checks

- identify the README candidate and report multiple candidates;
- preserve unrelated worktree changes;
- retain useful existing links and examples;
- report non-trivial deletions and moves;
- confirm every proposed asset path exists or mark it as a requested follow-up.

### Markdown checks

- code fences are balanced;
- Mermaid blocks are fenced with the `mermaid` language identifier;
- heading levels are coherent;
- canonical chapters appear in the intended order when present;
- no unfinished placeholders remain;
- links and images use valid relative paths or explicitly approved external URLs;
- image alt text is present and useful.

### Banner and image sizing checks

- inspect the intrinsic dimensions and aspect ratio of the first local hero image when its format can be read locally;
- for a dense 2:1 raster hero, recommend a proportional source near `1280x640` and flag materially larger sources as a warning or note;
- flag an explicit `width="100%"` on a 2:1 hero when the resulting height is likely to dominate the first README viewport;
- prefer a centered responsive width of roughly `70-75%` for a 2:1 hero and no fixed height;
- do not fail validation merely because an image uses a different ratio when the composition and rendered height are demonstrably appropriate.

### Mermaid checks

- the first meaningful line identifies a supported Mermaid diagram type;
- the diagram is non-empty;
- the overview has a clear entry point;
- nodes and edges have evidence in the analysis ledger;
- no secrets or private paths appear in labels;
- local rendering is attempted when a renderer exists and otherwise reported as unverified.

### Command checks

- package-manager scripts resolve against the relevant manifest;
- Make targets resolve against a Makefile;
- Docker or Compose commands have corresponding files;
- language-specific commands are only presented when the repository exposes the relevant toolchain or configuration;
- commands are copied from repository evidence or clearly labelled as user-supplied.

### Safety and truthfulness checks

- scan the proposed output for high-confidence token and private-key patterns;
- do not expose `.env` values, credentials, or private absolute paths;
- do not invent badges, versions, integrations, deployment targets, support channels, or performance claims;
- distinguish verified facts, inferences, and open questions in the review.

## Review response

Present the review in this order:

1. outcome and repository profile;
2. selected README chapters;
3. evidence-backed architecture summary;
4. diff or complete draft;
5. findings grouped by severity;
6. open questions and assumptions;
7. exact files that require approval.

Do not imply that the README was written when the response only contains a draft. After approval, report the write result and the post-write validation result separately.

## Network policy

Local validation is the default. Do not require network access for external link checks, badge endpoints, registry versions, or hosted Mermaid rendering. If the user explicitly authorizes a live check, keep it read-only and report which checks were performed remotely.
