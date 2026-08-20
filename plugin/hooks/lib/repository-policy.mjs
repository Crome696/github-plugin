import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const POLICY_RELATIVE_PATH = ".github/github-plugin-policy.json";
export const POLICY_SCHEMA = "RepositoryPolicy";
export const POLICY_VERSION = 1;

const MODES = new Set(["enforce", "warn", "disable"]);
const WORKTREE_MODES = new Set(["dedicated", "primary", "any"]);
const SCAN_SCOPES = new Set(["index_and_worktree", "index", "worktree"]);
const DEFAULT_HEADINGS = [
  { names: ["problem / issue context"], label: "Problem / issue context" },
  { names: ["solution summary"], label: "Solution summary" },
  { names: ["key changes", "key changes and scope"], label: "Key changes or Key changes and scope" },
  { names: ["tests and validations"], label: "Tests and validations" },
  { names: ["known limitations"], label: "Known limitations" },
  { names: ["risks"], label: "Risks" },
  { names: ["issue linkage"], label: "Issue linkage" },
];
const DEFAULT_FILENAME_PATTERNS = [
  "credential-like",
  "private-key-like",
  "environment-secret",
];
const DEFAULT_CONTENT_PATTERNS = [
  { name: "private-key material", source: "-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----", flags: "i" },
  { name: "GitHub token", source: "\\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\\b", flags: "" },
  { name: "AWS access key", source: "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b", flags: "" },
  { name: "credential-like assignment", source: "\\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret|private[_-]?key)\\b\\s*[:=]\\s*[\\\"']?[A-Za-z0-9/+_.-]{20,}", flags: "i" },
];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

export const compatibilityPolicy = () => ({
  schema: POLICY_SCHEMA,
  version: POLICY_VERSION,
  source: "compatibility_default",
  policy_path: POLICY_RELATIVE_PATH,
  warnings: [],
  pull_request: { mode: "enforce", language: "en", required_headings: clone(DEFAULT_HEADINGS) },
  rebase: { mode: "enforce", worktree: "dedicated", require_remote_upstream: true, require_remote_backup: true },
  secrets: { mode: "enforce", filename_patterns: [...DEFAULT_FILENAME_PATTERNS], content_patterns: clone(DEFAULT_CONTENT_PATTERNS), scan_scope: "index_and_worktree", max_file_bytes: 25 * 1024 * 1024 },
});

const validMode = (value) => typeof value === "string" && MODES.has(value);
const validStringList = (value) => Array.isArray(value) && value.length <= 64 && value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 200);

function validateSectionMode(section, fallback, warnings) {
  if (section === undefined) return fallback;
  if (!isRecord(section) || !validMode(section.mode)) {
    warnings.push("invalid policy section mode; compatibility default applied");
    return fallback;
  }
  return section.mode;
}

function compilePatterns(value, warnings) {
  if (!validStringList(value)) {
    warnings.push("invalid secret content patterns; compatibility default applied");
    return clone(DEFAULT_CONTENT_PATTERNS);
  }
  const result = [];
  for (const source of value) {
    try {
      new RegExp(source, "i");
      result.push({ name: source.slice(0, 80), source, flags: "i" });
    } catch {
      warnings.push("invalid secret content pattern; compatibility default applied");
      return clone(DEFAULT_CONTENT_PATTERNS);
    }
  }
  return result;
}

export function loadRepositoryPolicy(repositoryRoot) {
  const fallback = compatibilityPolicy();
  const policyPath = resolve(repositoryRoot, POLICY_RELATIVE_PATH);
  if (!existsSync(policyPath)) return fallback;

  let raw;
  try {
    raw = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch {
    fallback.warnings.push("policy file is not valid JSON; compatibility default applied");
    fallback.source = "invalid_policy_fallback";
    return fallback;
  }
  if (!isRecord(raw) || raw.schema !== POLICY_SCHEMA || raw.version !== POLICY_VERSION) {
    fallback.warnings.push("policy schema or version is unsupported; compatibility default applied");
    fallback.source = "unsupported_policy_fallback";
    return fallback;
  }

  const warnings = [];
  const result = compatibilityPolicy();
  result.source = "repository_policy";
  result.policy_path = POLICY_RELATIVE_PATH;
  result.pull_request.mode = validateSectionMode(raw.pull_request, result.pull_request.mode, warnings);
  if (isRecord(raw.pull_request)) {
    if (raw.pull_request.language !== undefined && typeof raw.pull_request.language === "string" && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(raw.pull_request.language)) result.pull_request.language = raw.pull_request.language;
    if (raw.pull_request.required_headings !== undefined && Array.isArray(raw.pull_request.required_headings) && raw.pull_request.required_headings.every((item) => isRecord(item) && validStringList(item.names) && typeof item.label === "string")) result.pull_request.required_headings = clone(raw.pull_request.required_headings);
    else if (raw.pull_request.required_headings !== undefined) warnings.push("invalid required headings; compatibility default applied");
  }
  result.rebase.mode = validateSectionMode(raw.rebase, result.rebase.mode, warnings);
  if (isRecord(raw.rebase)) {
    if (raw.rebase.worktree !== undefined && WORKTREE_MODES.has(raw.rebase.worktree)) result.rebase.worktree = raw.rebase.worktree; else if (raw.rebase.worktree !== undefined) warnings.push("invalid rebase worktree mode; compatibility default applied");
    for (const key of ["require_remote_upstream", "require_remote_backup"]) {
      if (raw.rebase[key] !== undefined && typeof raw.rebase[key] === "boolean") result.rebase[key] = raw.rebase[key]; else if (raw.rebase[key] !== undefined) warnings.push(`invalid ${key}; compatibility default applied`);
    }
  }
  result.secrets.mode = validateSectionMode(raw.secrets, result.secrets.mode, warnings);
  if (isRecord(raw.secrets)) {
    if (raw.secrets.filename_patterns !== undefined && validStringList(raw.secrets.filename_patterns)) result.secrets.filename_patterns = [...raw.secrets.filename_patterns]; else if (raw.secrets.filename_patterns !== undefined) warnings.push("invalid secret filename patterns; compatibility default applied");
    if (raw.secrets.content_patterns !== undefined) result.secrets.content_patterns = compilePatterns(raw.secrets.content_patterns, warnings);
    if (raw.secrets.scan_scope !== undefined && SCAN_SCOPES.has(raw.secrets.scan_scope)) result.secrets.scan_scope = raw.secrets.scan_scope; else if (raw.secrets.scan_scope !== undefined) warnings.push("invalid secret scan scope; compatibility default applied");
    if (raw.secrets.max_file_bytes !== undefined && Number.isInteger(raw.secrets.max_file_bytes) && raw.secrets.max_file_bytes > 0 && raw.secrets.max_file_bytes <= 100 * 1024 * 1024) result.secrets.max_file_bytes = raw.secrets.max_file_bytes; else if (raw.secrets.max_file_bytes !== undefined) warnings.push("invalid secret scan size; compatibility default applied");
  }
  result.warnings = warnings;
  return result;
}

export function policyEnforces(section) { return section?.mode === "enforce"; }
export function policyWarns(section) { return section?.mode === "warn"; }
