# Repository Policy

The generated GitHub project hooks read an optional versioned policy from
`.github/github-plugin-policy.json` at the target repository root.

When the file is absent, malformed, or uses an unsupported schema version, the
hooks use the compatibility default that preserves the historical behavior.
The policy can change repository-owned preferences only; operation identity,
authorization, gate integrity, evidence, and other deterministic safety guards
remain non-configurable and fail closed.

The supported version-1 shape is:

```json
{
  "schema": "RepositoryPolicy",
  "version": 1,
  "pull_request": {
    "mode": "enforce",
    "language": "en",
    "required_headings": [
      { "names": ["problem / issue context"], "label": "Problem / issue context" }
    ]
  },
  "rebase": {
    "mode": "enforce",
    "worktree": "dedicated",
    "require_remote_upstream": true,
    "require_remote_backup": true
  },
  "secrets": {
    "mode": "enforce",
    "filename_patterns": ["credential-like", "private-key-like", "environment-secret"],
    "content_patterns": ["-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----"],
    "scan_scope": "index_and_worktree",
    "max_file_bytes": 26214400
  }
}
```

Each configurable section accepts `enforce`, `warn`, or `disable`. `warn` and
`disable` apply only to that section's repository preference and never waive
the exact command, target, repository, identity, authorization, gate, or
evidence checks. Secret content is represented only by pattern configuration;
the plugin never stores or prints matched secret values.
