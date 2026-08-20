import {
  closeSync,
  existsSync,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

/**
 * Shared runtime state for every generated Cursor and Codex project hook.
 *
 * The helper deliberately uses synchronous filesystem primitives because the
 * protected hooks are short-lived, deterministic processes. The authority
 * file is renamed out of the canonical directory before it is parsed or
 * semantically validated. A failed command therefore cannot leave a bearer
 * token behind for a retry.
 */

export const CANONICAL_STATE_RELATIVE_PATH = ".github/github-plugin/state/";
export const GATE_LIFECYCLE_SCHEMA = "GateLifecycle";
export const GATE_LIFECYCLE_VERSION = 1;
export const GATE_TTL_MS = 5 * 60 * 1000;
export const MAX_FUTURE_SKEW_MS = 60 * 1000;
export const LEGACY_MIGRATION_GENERATION = 1;

export const GATE_FILE_NAMES = Object.freeze([
  "pre-commit.json",
  "pre-pr-create.json",
  "pre-review-submit.json",
  "pre-rebase.json",
  "pre-pr-ready.json",
  "pre-merge.json",
  "post-merge-receipt.json",
]);

const GATE_FILE_SET = new Set(GATE_FILE_NAMES);
const AUTHORITY_OPERATIONS = new Set([
  "pre-commit",
  "pre-pr-create",
  "pre-review-submit",
  "pre-rebase-start",
  "pre-rebase-continue",
  "pre-rebase-skip",
  "pre-rebase-abort",
  "pre-pr-ready",
  "pre-reviewer-request",
  "pre-merge",
]);
const FILE_OPERATIONS = new Map([
  ["pre-commit.json", new Set(["pre-commit"])],
  ["pre-pr-create.json", new Set(["pre-pr-create"])],
  ["pre-review-submit.json", new Set(["pre-review-submit"])],
  [
    "pre-rebase.json",
    new Set([
      "pre-rebase-start",
      "pre-rebase-continue",
      "pre-rebase-skip",
      "pre-rebase-abort",
    ]),
  ],
  ["pre-pr-ready.json", new Set(["pre-pr-ready", "pre-reviewer-request"])],
  ["pre-merge.json", new Set(["pre-merge"])],
]);
const LEGACY_STATE_RELATIVE_PATHS = [
  ".cursor/hooks/state/",
  ".codex/hooks/state/",
];
const PLUGIN_DIRECTORIES = [".processing", ".quarantine", ".consumed"];
const MAX_STATE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DIAGNOSTIC_LENGTH = 160;

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const safePathLabel = (value) =>
  String(value).replace(/[^A-Za-z0-9_.:/\\-]/g, "_").slice(0, MAX_DIAGNOSTIC_LENGTH);

const safeFileLabel = (value) =>
  String(value).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, MAX_DIAGNOSTIC_LENGTH);

const safeNonce = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(value);

const timestampMs = (value) => {
  if (!isNonEmptyString(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const rootPath = (repositoryRoot) => resolve(repositoryRoot);

const stateDirectory = (repositoryRoot) =>
  join(rootPath(repositoryRoot), ...CANONICAL_STATE_RELATIVE_PATH.split("/").filter(Boolean));

const assertGateFileName = (fileName) => {
  if (!GATE_FILE_SET.has(fileName)) {
    throw new Error(`Unsupported plugin gate file ${safePathLabel(fileName)}.`);
  }
};

export const canonicalStatePath = (repositoryRoot, fileName) => {
  assertGateFileName(fileName);
  return join(stateDirectory(repositoryRoot), fileName);
};

export const canonicalStateDirectory = (repositoryRoot) => stateDirectory(repositoryRoot);

const ensurePluginDirectories = (repositoryRoot) => {
  const directory = stateDirectory(repositoryRoot);
  mkdirSync(directory, { recursive: true });
  for (const child of PLUGIN_DIRECTORIES) {
    mkdirSync(join(directory, child), { recursive: true });
  }
  return directory;
};

const readRegularFile = (path, maxBytes = MAX_STATE_FILE_BYTES) => {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.size > maxBytes) {
    throw new Error("state file is not a bounded regular file");
  }
  return readFileSync(path, "utf8");
};

const uniqueFilePath = (directory, prefix, suffix = ".json") =>
  join(directory, `${prefix}-${Date.now()}-${randomUUID()}${suffix}`);

const removePluginFile = (path) => {
  if (!existsSync(path)) return;
  const stats = lstatSync(path);
  if (!stats.isFile()) {
    throw new Error("plugin cleanup target is not a regular file");
  }
  unlinkSync(path);
};

/**
 * Write one plugin-owned JSON file without replacing an existing target.
 * A hard-link publish gives both POSIX and Windows a non-overwriting commit
 * point; the temporary file is always created beside the final target.
 */
export const writeJsonAtomically = (path, value) => {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = uniqueFilePath(directory, ".tmp");
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  let descriptor = null;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeSync(descriptor, bytes, 0, bytes.length, 0);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    linkSync(temporaryPath, path);
    unlinkSync(temporaryPath);
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original write failure.
      }
    }
    try {
      removePluginFile(temporaryPath);
    } catch {
      // A leftover temporary file is reported by the caller on the next run.
    }
    if (error?.code === "EEXIST") {
      throw new Error("plugin state target already exists");
    }
    throw error;
  }
};

const quarantineFile = (repositoryRoot, path, category) => {
  if (!existsSync(path)) return { ok: true, path: null };
  const quarantineDirectory = join(stateDirectory(repositoryRoot), ".quarantine", category);
  mkdirSync(quarantineDirectory, { recursive: true });
  const target = uniqueFilePath(quarantineDirectory, safeFileLabel(path).replace(/\.json$/i, ""));
  try {
    renameSync(path, target);
    return { ok: true, path: target };
  } catch (error) {
    return {
      ok: false,
      error: `Could not quarantine plugin state ${safePathLabel(path)} (${safePathLabel(error?.code ?? error?.name ?? "io-error")}).`,
    };
  }
};

const legacyStatePath = (repositoryRoot, relativeDirectory, fileName) =>
  join(rootPath(repositoryRoot), ...relativeDirectory.split("/").filter(Boolean), fileName);

/**
 * During migration generation 1, only known legacy gate names are inspected.
 * Unknown files and directories are never recursively enumerated or removed.
 */
export const migrateLegacyState = (repositoryRoot) => {
  const result = { found: [], quarantined: [], errors: [] };
  ensurePluginDirectories(repositoryRoot);
  for (const relativeDirectory of LEGACY_STATE_RELATIVE_PATHS) {
    const directory = join(rootPath(repositoryRoot), ...relativeDirectory.split("/").filter(Boolean));
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      result.errors.push(`Could not inspect legacy state ${safePathLabel(directory)}.`);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !GATE_FILE_SET.has(entry.name)) continue;
      const source = join(directory, entry.name);
      result.found.push(source);
      const moved = quarantineFile(repositoryRoot, source, "legacy");
      if (moved.ok) {
        result.quarantined.push(source);
      } else {
        result.errors.push(moved.error);
      }
    }
  }
  return result;
};

/** Remove only stale plugin-created temp/processing files; never recurse. */
export const cleanupAbandonedState = (repositoryRoot, now = Date.now()) => {
  ensurePluginDirectories(repositoryRoot);
  const root = stateDirectory(repositoryRoot);
  const processingDirectory = join(root, ".processing");
  const removed = [];
  const errors = [];
  const inspect = (directory, pattern) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      errors.push(`Could not inspect plugin processing state ${safePathLabel(directory)}.`);
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !pattern.test(entry.name)) continue;
      const path = join(directory, entry.name);
      try {
        const stats = lstatSync(path);
        if (!stats.isFile() || now - stats.mtimeMs < GATE_TTL_MS) continue;
        unlinkSync(path);
        removed.push(path);
      } catch {
        errors.push(`Could not clean abandoned plugin state ${safePathLabel(path)}.`);
      }
    }
  };
  inspect(root, /^\.tmp-[A-Za-z0-9_.:-]+\.json$/);
  inspect(processingDirectory, /^\.processing-[A-Za-z0-9_.:-]+\.json$/);
  inspect(join(root, ".consumed"), /^\.tmp-[A-Za-z0-9_.:-]+\.json$/);
  return { removed, errors };
};

const lifecycleError = (message) => ({ ok: false, error: message });

const preparationErrors = (migration, abandoned) => [
  ...(migration?.errors ?? []),
  ...(abandoned?.errors ?? []),
];

const preparationErrorMessage = (migration, abandoned) => {
  const errors = preparationErrors(migration, abandoned);
  return errors.length === 0
    ? null
    : `Plugin-owned lifecycle inspection or cleanup failed safely: ${errors
        .slice(0, 3)
        .map((error) => safePathLabel(error))
        .join("; ")}`;
};

const validateAuthorityLifecycle = (lifecycle, expectedOperation, now) => {
  if (!isRecord(lifecycle)) return lifecycleError("GateLifecycle is missing or malformed.");
  if (lifecycle.schema !== GATE_LIFECYCLE_SCHEMA || lifecycle.version !== GATE_LIFECYCLE_VERSION) {
    return lifecycleError("GateLifecycle schema or version is unsupported.");
  }
  if (!AUTHORITY_OPERATIONS.has(lifecycle.operation)) {
    return lifecycleError("GateLifecycle.operation is unsupported.");
  }
  if (expectedOperation !== undefined && lifecycle.operation !== expectedOperation) {
    return lifecycleError("GateLifecycle.operation does not match the protected invocation.");
  }
  if (!safeNonce(lifecycle.nonce)) return lifecycleError("GateLifecycle.nonce is missing or malformed.");
  if (lifecycle.state !== "authority" || lifecycle.authorizes !== true) {
    return lifecycleError("GateLifecycle is not an authorizing authority state.");
  }
  if (lifecycle.consumed_at !== null || lifecycle.receipt_expires_at !== null) {
    return lifecycleError("An authority GateLifecycle cannot carry consumption or receipt timestamps.");
  }
  const issuedAt = timestampMs(lifecycle.issued_at);
  const expiresAt = timestampMs(lifecycle.expires_at);
  if (issuedAt === null || expiresAt === null) {
    return lifecycleError("GateLifecycle issued_at or expires_at is missing or malformed.");
  }
  if (expiresAt - issuedAt !== GATE_TTL_MS) {
    return lifecycleError("GateLifecycle does not use the central five-minute TTL.");
  }
  if (issuedAt > now + MAX_FUTURE_SKEW_MS) {
    return lifecycleError("GateLifecycle.issued_at is too far in the future.");
  }
  if (now >= expiresAt) return lifecycleError("GateLifecycle has expired.");
  return { ok: true, issuedAt, expiresAt };
};

const validateReceiptLifecycle = (lifecycle, now) => {
  if (!isRecord(lifecycle)) return lifecycleError("Receipt GateLifecycle is missing or malformed.");
  if (lifecycle.schema !== GATE_LIFECYCLE_SCHEMA || lifecycle.version !== GATE_LIFECYCLE_VERSION) {
    return lifecycleError("Receipt GateLifecycle schema or version is unsupported.");
  }
  if (lifecycle.operation !== "pre-merge" || !safeNonce(lifecycle.nonce)) {
    return lifecycleError("Receipt GateLifecycle is not bound to pre-merge or has a malformed nonce.");
  }
  if (lifecycle.state !== "receipt" || lifecycle.authorizes !== false) {
    return lifecycleError("Receipt GateLifecycle is still authorizing state.");
  }
  const issuedAt = timestampMs(lifecycle.issued_at);
  const expiresAt = timestampMs(lifecycle.expires_at);
  const consumedAt = timestampMs(lifecycle.consumed_at);
  const receiptExpiresAt = timestampMs(lifecycle.receipt_expires_at);
  if ([issuedAt, expiresAt, consumedAt, receiptExpiresAt].some((value) => value === null)) {
    return lifecycleError("Receipt GateLifecycle timestamps are missing or malformed.");
  }
  if (expiresAt - issuedAt !== GATE_TTL_MS || receiptExpiresAt - consumedAt !== GATE_TTL_MS) {
    return lifecycleError("Receipt GateLifecycle does not use the central five-minute TTL.");
  }
  if (consumedAt < issuedAt || consumedAt >= expiresAt) {
    return lifecycleError("Receipt GateLifecycle was not consumed during the authority lifetime.");
  }
  if (consumedAt > now + MAX_FUTURE_SKEW_MS) {
    return lifecycleError("Receipt GateLifecycle.consumed_at is too far in the future.");
  }
  if (now >= receiptExpiresAt) return lifecycleError("The post-merge receipt has expired.");
  return { ok: true, consumedAt, receiptExpiresAt };
};

const consumedMarkerPath = (repositoryRoot, nonce, prefix = "") =>
  join(stateDirectory(repositoryRoot), ".consumed", `${prefix}${nonce}.json`);

const writeConsumptionMarker = (repositoryRoot, lifecycle, kind) => {
  const path = consumedMarkerPath(repositoryRoot, lifecycle.nonce, kind === "receipt" ? "receipt-" : "");
  if (existsSync(path)) throw new Error("plugin nonce was already consumed");
  writeJsonAtomically(path, {
    schema: "GateConsumption",
    version: 1,
    operation: lifecycle.operation,
    nonce: lifecycle.nonce,
    state: kind,
    consumed_at: new Date().toISOString(),
  });
  return path;
};

const claimProcessingPath = (repositoryRoot, fileName) =>
  uniqueFilePath(join(stateDirectory(repositoryRoot), ".processing"),
    `.processing-${safePathLabel(fileName).replace(/\.json$/i, "")}`);

const claimFile = (repositoryRoot, fileName) => {
  const source = canonicalStatePath(repositoryRoot, fileName);
  if (!existsSync(source)) return { source, processing: null, error: null };
  const processing = claimProcessingPath(repositoryRoot, fileName);
  try {
    renameSync(source, processing);
    return { source, processing, error: null };
  } catch (error) {
    return {
      source,
      processing: null,
      error: `Could not atomically claim ${safePathLabel(fileName)} (${safePathLabel(error?.code ?? error?.name ?? "io-error")}).`,
    };
  }
};

/**
 * Atomically claim, parse, lifecycle-validate, and persist consumption of an
 * authorizing gate. The returned gate is no longer present in the authority
 * directory even when later semantic checks deny the protected command.
 */
export const claimGate = (repositoryRoot, fileName, expectedOperation, now = Date.now()) => {
  assertGateFileName(fileName);
  if (fileName === "post-merge-receipt.json") {
    return { gate: null, error: "Post-merge receipts must be consumed with consumePostMergeReceipt." };
  }
  const migration = migrateLegacyState(repositoryRoot);
  const abandoned = cleanupAbandonedState(repositoryRoot, now);
  const preparationError = preparationErrorMessage(migration, abandoned);
  if (preparationError !== null) {
    return { gate: null, error: preparationError, migration, abandoned };
  }
  const claimed = claimFile(repositoryRoot, fileName);
  if (claimed.error) return { gate: null, error: claimed.error, migration, abandoned };
  if (claimed.processing === null) {
    const legacyText = migration.found.length > 0
      ? " Known legacy state was quarantined and cannot authorize this invocation."
      : "";
    return {
      gate: null,
      error: `The canonical ${safePathLabel(fileName)} gate is missing.${legacyText}`,
      migration,
      abandoned,
    };
  }

  let gate;
  try {
    gate = JSON.parse(readRegularFile(claimed.processing));
  } catch {
    const moved = quarantineFile(repositoryRoot, claimed.processing, "invalid");
    return {
      gate: null,
      error: `The claimed ${safePathLabel(fileName)} gate is malformed or unreadable.${moved.ok ? "" : ` ${moved.error}`}`,
      migration,
      abandoned,
    };
  }

  const lifecycle = validateAuthorityLifecycle(gate?.lifecycle, expectedOperation, now);
  if (!lifecycle.ok) {
    const moved = quarantineFile(repositoryRoot, claimed.processing, "invalid");
    return {
      gate: null,
      error: `${lifecycle.error}${moved.ok ? "" : ` ${moved.error}`}`,
      migration,
      abandoned,
    };
  }

  try {
    writeConsumptionMarker(repositoryRoot, gate.lifecycle, "authority");
  } catch (error) {
    const moved = quarantineFile(repositoryRoot, claimed.processing, "consumption-failure");
    return {
      gate: null,
      error: `The gate nonce could not be persisted as consumed (${safePathLabel(error?.message ?? error?.code ?? "io-error")}).${moved.ok ? "" : ` ${moved.error}`}`,
      migration,
      abandoned,
    };
  }

  try {
    removePluginFile(claimed.processing);
  } catch {
    return {
      gate: null,
      error: "The claimed gate was consumed but its processing file could not be removed; execution is blocked safely.",
      migration,
      abandoned,
    };
  }

  return {
    gate,
    lifecycle: gate.lifecycle,
    migration,
    abandoned,
    error: null,
  };
};

/** Validate and atomically publish a fresh authority gate for an owner skill. */
export const writeGate = (repositoryRoot, fileName, gate, now = Date.now()) => {
  assertGateFileName(fileName);
  if (fileName === "post-merge-receipt.json") {
    throw new Error("Post-merge receipts are created only from a consumed PreMergeGate.");
  }
  const lifecycle = validateAuthorityLifecycle(
    gate?.lifecycle,
    gate?.lifecycle?.operation,
    now,
  );
  if (!lifecycle.ok) throw new Error(lifecycle.error);
  const allowedOperations = FILE_OPERATIONS.get(fileName);
  if (!allowedOperations?.has(gate.lifecycle.operation)) {
    throw new Error(`GateLifecycle.operation does not match ${fileName}.`);
  }
  const target = canonicalStatePath(repositoryRoot, fileName);
  ensurePluginDirectories(repositoryRoot);
  writeJsonAtomically(target, gate);
  try {
    const written = JSON.parse(readRegularFile(target));
    const verified = validateAuthorityLifecycle(written?.lifecycle, gate.lifecycle.operation, now);
    if (!verified.ok) {
      removePluginFile(target);
      throw new Error(`Fresh gate verification failed: ${verified.error}`);
    }
  } catch (error) {
    if (existsSync(target)) {
      try {
        removePluginFile(target);
      } catch {
        // Preserve the verification failure and keep the state fail-closed.
      }
    }
    throw error;
  }
  return target;
};

/** Create exactly one non-authorizing receipt from an already consumed merge gate. */
export const createPreMergeReceipt = (repositoryRoot, gate, now = Date.now()) => {
  const lifecycle = validateAuthorityLifecycle(gate?.lifecycle, "pre-merge", now);
  if (!lifecycle.ok) return { ok: false, error: lifecycle.error };
  const receipt = JSON.parse(JSON.stringify(gate));
  const consumedAt = new Date(now).toISOString();
  receipt.lifecycle = {
    ...receipt.lifecycle,
    state: "receipt",
    authorizes: false,
    consumed_at: consumedAt,
    receipt_expires_at: new Date(now + GATE_TTL_MS).toISOString(),
  };
  const target = canonicalStatePath(repositoryRoot, "post-merge-receipt.json");
  try {
    ensurePluginDirectories(repositoryRoot);
    writeJsonAtomically(target, receipt);
    const written = JSON.parse(readRegularFile(target));
    const verified = validateReceiptLifecycle(written?.lifecycle, now);
    if (!verified.ok) {
      removePluginFile(target);
      throw new Error(`Fresh receipt verification failed: ${verified.error}`);
    }
    return { ok: true, path: target };
  } catch (error) {
    return {
      ok: false,
      error: `The pre-merge receipt could not be published atomically (${safePathLabel(error?.message ?? error?.code ?? "io-error")}).`,
    };
  }
};

/** Atomically consume and remove the single post-merge receipt, if present. */
export const consumePostMergeReceipt = (repositoryRoot, now = Date.now()) => {
  const migration = migrateLegacyState(repositoryRoot);
  const abandoned = cleanupAbandonedState(repositoryRoot, now);
  const preparationError = preparationErrorMessage(migration, abandoned);
  if (preparationError !== null) {
    return { receipt: null, available: true, error: preparationError, migration, abandoned };
  }
  const claimed = claimFile(repositoryRoot, "post-merge-receipt.json");
  if (claimed.error) return { receipt: null, available: true, error: claimed.error, migration, abandoned };
  if (claimed.processing === null) {
    return { receipt: null, available: false, error: null, migration, abandoned };
  }

  let receipt;
  try {
    receipt = JSON.parse(readRegularFile(claimed.processing));
  } catch {
    const moved = quarantineFile(repositoryRoot, claimed.processing, "receipt-invalid");
    return {
      receipt: null,
      available: true,
      error: `The post-merge receipt is malformed or unreadable.${moved.ok ? "" : ` ${moved.error}`}`,
      migration,
      abandoned,
    };
  }

  const lifecycle = validateReceiptLifecycle(receipt?.lifecycle, now);
  if (!lifecycle.ok) {
    const moved = quarantineFile(repositoryRoot, claimed.processing, "receipt-invalid");
    return {
      receipt: null,
      available: true,
      error: `${lifecycle.error}${moved.ok ? "" : ` ${moved.error}`}`,
      migration,
      abandoned,
    };
  }

  try {
    writeConsumptionMarker(repositoryRoot, receipt.lifecycle, "receipt");
    removePluginFile(claimed.processing);
  } catch (error) {
    return {
      receipt: null,
      available: true,
      error: `The post-merge receipt could not be consumed and removed safely (${safePathLabel(error?.message ?? error?.code ?? "io-error")}).`,
      migration,
      abandoned,
    };
  }

  return {
    receipt,
    available: true,
    error: null,
    migration,
    abandoned,
  };
};

export const validateGateLifecycle = (lifecycle, expectedOperation, now = Date.now()) =>
  validateAuthorityLifecycle(lifecycle, expectedOperation, now);

export const validateReceiptLifecycleState = (lifecycle, now = Date.now()) =>
  validateReceiptLifecycle(lifecycle, now);

export const legacyStateRelativePaths = Object.freeze([...LEGACY_STATE_RELATIVE_PATHS]);
