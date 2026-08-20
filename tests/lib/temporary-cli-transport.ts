import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type PrimaryResultKind =
  | "success"
  | "nonzero"
  | "timeout"
  | "parse-error"
  | "exception"
  | "blocked"
  | "not-started";

export interface PrimaryResult {
  kind: PrimaryResultKind;
  exitCode?: number;
  reason?: string;
}

export type CleanupResult =
  | { status: "deleted" }
  | { status: "absent" }
  | { status: "failed"; warning: string }
  | { status: "blocked"; reason: string }
  | { status: "not-created" };

export type CliResult =
  | { kind: "success" }
  | { kind: "nonzero"; exitCode: number }
  | { kind: "parse-error" };

export type CliTransportErrorKind = "timeout" | "exception";

export class CliTransportError extends Error {
  public readonly kind: CliTransportErrorKind;

  public constructor(kind: CliTransportErrorKind) {
    super(kind);
    this.name = "CliTransportError";
    this.kind = kind;
  }
}

class TransportSetupError extends Error {
  public readonly reason: string;

  public constructor(reason: string) {
    super(reason);
    this.name = "TransportSetupError";
    this.reason = reason;
  }
}

export interface TransportOptions {
  worktreePath: string;
  tempDirectory?: string;
  prefix?: string;
  randomId?: () => string;
  maxAttempts?: number;
  verifyPrivatePermissions?: (path: string) => boolean;
  unlinkFile?: (path: string) => void;
}

export interface TransportLifecycleResult {
  filePath: string | null;
  invocationCount: number;
  primary: PrimaryResult;
  cleanup: CleanupResult;
}

const safeToken = /^[A-Za-z0-9._-]+$/;

const isWithin = (root: string, target: string): boolean => {
  const child = relative(root, target);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
};

const errorCode = (error: unknown): string => {
  if (typeof error !== "object" || error === null || !("code" in error)) return "UNKNOWN";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_-]{1,32}$/.test(code) ? code : "UNKNOWN";
};

const tempRootFor = (tempDirectory: string): string => {
  const candidate = resolve(tempDirectory);
  if (!isAbsolute(candidate)) throw new TransportSetupError("TEMP_DIRECTORY_NOT_ABSOLUTE");
  try {
    if (!statSync(candidate).isDirectory()) throw new TransportSetupError("TEMP_DIRECTORY_NOT_DIRECTORY");
    return realpathSync(candidate);
  } catch (error) {
    if (error instanceof TransportSetupError) throw error;
    throw new TransportSetupError("TEMP_DIRECTORY_UNVERIFIED");
  }
};

const worktreeRootFor = (worktreePath: string): string => {
  const candidate = resolve(worktreePath);
  if (!isAbsolute(candidate)) throw new TransportSetupError("WORKTREE_NOT_ABSOLUTE");
  try {
    if (!statSync(candidate).isDirectory()) throw new TransportSetupError("WORKTREE_NOT_DIRECTORY");
    return realpathSync(candidate);
  } catch (error) {
    if (error instanceof TransportSetupError) throw error;
    throw new TransportSetupError("WORKTREE_UNVERIFIED");
  }
};

const candidateFor = (tempRoot: string, worktreeRoot: string, filePath: string): string => {
  if (!isAbsolute(filePath)) throw new TransportSetupError("TARGET_NOT_ABSOLUTE");
  const resolvedTarget = resolve(filePath);
  if (resolvedTarget === tempRoot) throw new TransportSetupError("TARGET_IS_TEMP_DIRECTORY");

  const parent = dirname(resolvedTarget);
  let physicalParent: string;
  try {
    physicalParent = realpathSync(parent);
  } catch {
    throw new TransportSetupError("TARGET_PARENT_UNRESOLVED");
  }
  const physicalTarget = resolve(physicalParent, basename(resolvedTarget));
  if (!isWithin(tempRoot, physicalTarget)) throw new TransportSetupError("TARGET_OUTSIDE_TEMP");
  if (isWithin(worktreeRoot, physicalTarget)) throw new TransportSetupError("TARGET_IN_WORKTREE");
  return resolvedTarget;
};

const writeAll = (fd: number, bytes: Buffer): void => {
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  fsyncSync(fd);
};

const defaultPermissionCheck = (path: string): boolean => {
  if (process.platform === "win32") return true;
  return (lstatSync(path).mode & 0o777) === 0o600;
};

export const createUniqueTransportFile = (
  payload: Uint8Array,
  options: TransportOptions,
): string => {
  const tempRoot = tempRootFor(options.tempDirectory ?? tmpdir());
  const worktreeRoot = worktreeRootFor(options.worktreePath);
  const prefix = options.prefix ?? "cromesdk-github-transport";
  const randomId = options.randomId ?? randomUUID;
  const maxAttempts = options.maxAttempts ?? 32;
  if (!safeToken.test(prefix)) throw new TransportSetupError("PREFIX_INVALID");

  const bytes = Buffer.from(payload);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const id = randomId();
    if (!safeToken.test(id)) throw new TransportSetupError("IDENTIFIER_INVALID");
    const target = candidateFor(tempRoot, worktreeRoot, join(tempRoot, `${prefix}-${id}.payload`));
    let fd: number | null = null;
    let created = false;
    try {
      fd = openSync(target, "wx", 0o600);
      created = true;
      writeAll(fd, bytes);
      closeSync(fd);
      fd = null;
      const verifyPermissions = options.verifyPrivatePermissions ?? defaultPermissionCheck;
      if (!verifyPermissions(target)) throw new TransportSetupError("PRIVATE_PERMISSIONS_UNVERIFIED");
      return target;
    } catch (error) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // Preserve the setup failure; the bounded cleanup below is best effort.
        }
      }
      if (created) {
        try {
          unlinkSync(target);
        } catch {
          // Do not hide the primary setup failure with cleanup diagnostics here.
        }
      }
      if (errorCode(error) === "EEXIST") continue;
      throw error;
    }
  }
  throw new TransportSetupError("UNIQUE_NAME_UNAVAILABLE");
};

export const cleanupTransportFile = (
  filePath: string,
  options: Pick<TransportOptions, "worktreePath" | "tempDirectory" | "unlinkFile">,
): CleanupResult => {
  let tempRoot: string;
  let worktreeRoot: string;
  try {
    tempRoot = tempRootFor(options.tempDirectory ?? tmpdir());
    worktreeRoot = worktreeRootFor(options.worktreePath);
  } catch (error) {
    return { status: "blocked", reason: error instanceof TransportSetupError ? error.reason : "CONTEXT_UNVERIFIED" };
  }

  let target: string;
  try {
    target = candidateFor(tempRoot, worktreeRoot, filePath);
  } catch (error) {
    return { status: "blocked", reason: error instanceof TransportSetupError ? error.reason : "TARGET_UNSAFE" };
  }

  try {
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink()) return { status: "blocked", reason: "TARGET_SYMLINK" };
    if (!metadata.isFile()) return { status: "blocked", reason: "TARGET_NOT_REGULAR_FILE" };
    const physicalTarget = realpathSync(target);
    if (!isWithin(tempRoot, physicalTarget)) return { status: "blocked", reason: "TARGET_REALPATH_OUTSIDE_TEMP" };
    if (isWithin(worktreeRoot, physicalTarget)) return { status: "blocked", reason: "TARGET_REALPATH_IN_WORKTREE" };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "absent" };
    return { status: "failed", warning: `Temporary CLI transport cleanup failed (${errorCode(error)}); primary operation result is preserved.` };
  }

  try {
    (options.unlinkFile ?? unlinkSync)(target);
    return { status: "deleted" };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "absent" };
    return { status: "failed", warning: `Temporary CLI transport cleanup failed (${errorCode(error)}); primary operation result is preserved.` };
  }
};

const primaryFrom = (error: unknown): PrimaryResult => {
  if (error instanceof TransportSetupError) return { kind: "blocked", reason: error.reason };
  if (error instanceof CliTransportError) return { kind: error.kind };
  return { kind: "exception" };
};

export const runCliTransport = async (
  payload: Uint8Array,
  invokeCli: (filePath: string) => Promise<CliResult> | CliResult,
  options: TransportOptions,
): Promise<TransportLifecycleResult> => {
  let filePath: string | null = null;
  let invocationCount = 0;
  let primary: PrimaryResult = { kind: "not-started" };
  let cleanup: CleanupResult = { status: "not-created" };

  try {
    filePath = createUniqueTransportFile(payload, options);
    invocationCount += 1;
    try {
      const result = await invokeCli(filePath);
      primary = result.kind === "nonzero"
        ? { kind: "nonzero", exitCode: result.exitCode }
        : { kind: result.kind };
    } catch (error) {
      primary = primaryFrom(error);
    }
  } catch (error) {
    primary = primaryFrom(error);
  } finally {
    cleanup = filePath === null
      ? { status: "not-created" }
      : cleanupTransportFile(filePath, options);
  }

  return { filePath, invocationCount, primary, cleanup };
};
