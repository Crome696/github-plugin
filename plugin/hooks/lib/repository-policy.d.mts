export interface RepositoryPolicy {
  schema: "RepositoryPolicy";
  version: 1;
  source: string;
  policy_path: string;
  warnings: string[];
  pull_request: { mode: "enforce" | "warn" | "disable"; language: string; required_headings: Array<{ names: string[]; label: string }> };
  rebase: { mode: "enforce" | "warn" | "disable"; worktree: "dedicated" | "primary" | "any"; require_remote_upstream: boolean; require_remote_backup: boolean };
  secrets: { mode: "enforce" | "warn" | "disable"; filename_patterns: string[]; content_patterns: Array<{ name: string; source: string; flags: string }>; scan_scope: "index_and_worktree" | "index" | "worktree"; max_file_bytes: number };
}
export declare const POLICY_RELATIVE_PATH: string;
export declare const POLICY_SCHEMA: string;
export declare const POLICY_VERSION: number;
export declare const compatibilityPolicy: () => RepositoryPolicy;
export declare function loadRepositoryPolicy(repositoryRoot: string): RepositoryPolicy;
export declare function policyEnforces(section: { mode?: string } | undefined): boolean;
export declare function policyWarns(section: { mode?: string } | undefined): boolean;
