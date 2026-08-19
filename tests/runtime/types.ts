export const HOOK_NAMES = [
  "pre-commit",
  "pre-pr-create",
  "pre-review-submit",
  "pre-rebase",
  "pre-pr-ready",
  "pre-merge",
  "post-merge",
] as const;

export type HookName = (typeof HOOK_NAMES)[number];
export type Host = "cursor" | "codex";

export type RuntimeMode =
  | "irrelevant"
  | "missing-gate"
  | "allow"
  | "stale-gate"
  | "mismatched-gate"
  | "malformed-gate"
  | "unmerged-index"
  | "active-operation"
  | "cli-failure"
  | "cli-invalid-json"
  | "cli-auth-failure"
  | "cli-delay";

export interface RuntimeContext {
  repositoryRoot: string;
  repository: string;
  branch: string;
  baseBranch: string;
  headSha: string;
  baseSha: string;
  mergeCommitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  issueNumber: number;
  issueUrl: string;
  bodyPath: string;
  reviewPayloadPath: string;
  runtimeFilePath: string;
  runtimeFileRelativePath: string;
  fakeConfigPath: string;
  fakeLogPath: string;
  shimDirectory: string;
  fakeRunnerPath: string;
}

export interface ExactCommandRule {
  executable: "git" | "gh";
  args: string[];
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
}

export interface GraphqlCommandRule {
  executable: "gh";
  match: "graphql";
  queryIncludes: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
}

export type FakeCommandRule = ExactCommandRule | GraphqlCommandRule;

export interface FakeCommandConfig {
  rules: FakeCommandRule[];
  defaultDelayMs?: number;
}

export interface FakeCommandLogEntry {
  executable: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  delayMs: number;
  matched: boolean;
}

export interface RuntimeExecution {
  host: Host;
  hook: HookName;
  mode: RuntimeMode;
  entrypoint: string | null;
  route: string | null;
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  logs: FakeCommandLogEntry[];
}

export interface GateOptions {
  malformed?: boolean;
  stale?: boolean;
  mismatched?: boolean;
}
