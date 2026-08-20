import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  GATE_TTL_MS,
  MAX_FUTURE_SKEW_MS,
  canonicalStatePath,
  claimGate,
  cleanupAbandonedState,
  consumePostMergeReceipt,
  createPreMergeReceipt,
  validateGateLifecycle,
  writeGate,
} from "../../plugin/hooks/lib/gate-state.mjs";

const fixedNow = Date.UTC(2040, 0, 1, 12, 0, 0);

const lifecycle = (operation: string, now = fixedNow, nonce = "0123456789abcdef0123456789abcdef") => ({
  schema: "GateLifecycle",
  version: 1,
  operation,
  nonce,
  state: "authority",
  authorizes: true,
  issued_at: new Date(now).toISOString(),
  expires_at: new Date(now + GATE_TTL_MS).toISOString(),
  consumed_at: null,
  receipt_expires_at: null,
});

const authorityGate = (operation: string, now = fixedNow, nonce?: string) => ({
  schema: "PreCommitGate",
  version: 4,
  lifecycle: lifecycle(operation, now, nonce),
  written_at: new Date(now).toISOString(),
});

const temporaryRepository = () =>
  mkdtempSync(join(tmpdir(), "cromesdk-gate-lifecycle-"));

const withRepository = <T>(callback: (repositoryRoot: string) => T): T => {
  const repositoryRoot = temporaryRepository();
  try {
    return callback(repositoryRoot);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
};

const withRepositoryAsync = async <T>(
  callback: (repositoryRoot: string) => Promise<T>,
): Promise<T> => {
  const repositoryRoot = temporaryRepository();
  try {
    return await callback(repositoryRoot);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
};

const claimInChild = (repositoryRoot: string): Promise<{ claimed: boolean; error: string | null }> =>
  new Promise((resolvePromise, reject) => {
    const helperUrl = pathToFileURL(
      resolve("plugin/hooks/lib/gate-state.mjs"),
    ).href;
    const script = [
      `import { claimGate } from ${JSON.stringify(helperUrl)};`,
      `const result = claimGate(process.argv[1], "pre-commit.json", "pre-commit");`,
      `console.log(JSON.stringify({ claimed: Boolean(result.gate), error: result.error ?? null }));`,
    ].join(" ");
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, repositoryRoot],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Concurrent claim child failed: ${stderr || stdout}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout.trim()) as { claimed: boolean; error: string | null });
      } catch (error) {
        reject(new Error(`Concurrent claim child returned malformed output: ${String(error)}`));
      }
    });
  });

describe("GateLifecycle runtime", () => {
  it("enforces the exact five-minute TTL and future-skew boundary", () => {
    const valid = lifecycle("pre-commit");
    expect(validateGateLifecycle(valid, "pre-commit", fixedNow + GATE_TTL_MS - 1).ok).toBe(true);
    expect(validateGateLifecycle(valid, "pre-commit", fixedNow + GATE_TTL_MS).ok).toBe(false);

    const futureIssued = lifecycle("pre-commit", fixedNow + MAX_FUTURE_SKEW_MS);
    expect(
      validateGateLifecycle(futureIssued, "pre-commit", fixedNow).ok,
    ).toBe(true);
    const tooFarFuture = lifecycle("pre-commit", fixedNow + MAX_FUTURE_SKEW_MS + 1);
    expect(
      validateGateLifecycle(tooFarFuture, "pre-commit", fixedNow).ok,
    ).toBe(false);
  });

  it("claims a gate once and keeps the nonce consumed across a restart", () =>
    withRepository((repositoryRoot) => {
      writeGate(
        repositoryRoot,
        "pre-commit.json",
        authorityGate("pre-commit"),
        fixedNow,
      );
      const first = claimGate(repositoryRoot, "pre-commit.json", "pre-commit", fixedNow);
      expect(first.error).toBeNull();
      expect(first.gate).not.toBeNull();

      const replay = claimGate(repositoryRoot, "pre-commit.json", "pre-commit", fixedNow);
      expect(replay.gate).toBeNull();
      expect(replay.error).toContain("missing");
      expect(
        existsSync(join(repositoryRoot, ".github", "github-plugin", "state", ".consumed")),
      ).toBe(true);
    }));

  it("allows only one of two concurrent claimers to win the atomic rename", async () =>
    await withRepositoryAsync(async (repositoryRoot) => {
      const now = Date.now();
      writeGate(
        repositoryRoot,
        "pre-commit.json",
        authorityGate("pre-commit", now, "concurrent0123456789abcdef012345"),
        now,
      );
      const results = await Promise.all([
        claimInChild(repositoryRoot),
        claimInChild(repositoryRoot),
      ]);
      expect(results.filter((result) => result.claimed)).toHaveLength(1);
      expect(results.filter((result) => !result.claimed)).toHaveLength(1);
    }));

  it("quarantines malformed, mismatched, expired, and legacy state", () =>
    withRepository((repositoryRoot) => {
      const state = join(repositoryRoot, ".github", "github-plugin", "state");
      mkdirSync(state, { recursive: true });
      const malformedPath = canonicalStatePath(repositoryRoot, "pre-commit.json");
      writeFileSync(malformedPath, "{not-json", "utf8");
      expect(claimGate(repositoryRoot, "pre-commit.json", "pre-commit", fixedNow).gate).toBeNull();

      writeFileSync(
        canonicalStatePath(repositoryRoot, "pre-commit.json"),
        JSON.stringify(authorityGate("pre-pr-create")),
        "utf8",
      );
      expect(claimGate(repositoryRoot, "pre-commit.json", "pre-commit", fixedNow).gate).toBeNull();

      writeFileSync(
        canonicalStatePath(repositoryRoot, "pre-commit.json"),
        JSON.stringify(authorityGate("pre-commit", fixedNow - GATE_TTL_MS - 1)),
        "utf8",
      );
      expect(claimGate(repositoryRoot, "pre-commit.json", "pre-commit", fixedNow).gate).toBeNull();

      const legacyDirectory = join(repositoryRoot, ".cursor", "hooks", "state");
      mkdirSync(legacyDirectory, { recursive: true });
      writeFileSync(
        join(legacyDirectory, "pre-commit.json"),
        JSON.stringify(authorityGate("pre-commit")),
        "utf8",
      );
      const userOwned = join(legacyDirectory, "user-owned.json");
      writeFileSync(userOwned, "keep", "utf8");
      const legacyResult = claimGate(repositoryRoot, "pre-commit.json", "pre-commit", fixedNow);
      expect(legacyResult.gate).toBeNull();
      expect(legacyResult.migration.found).toHaveLength(1);
      expect(existsSync(userOwned)).toBe(true);
      expect(readdirSync(join(state, ".quarantine", "legacy")).length).toBeGreaterThan(0);
    }));

  it("creates exactly one non-authorizing pre-merge receipt and consumes it once", () =>
    withRepository((repositoryRoot) => {
      const gate = authorityGate("pre-merge");
      writeGate(repositoryRoot, "pre-merge.json", gate, fixedNow);
      const claimed = claimGate(repositoryRoot, "pre-merge.json", "pre-merge", fixedNow);
      expect(claimed.gate).not.toBeNull();

      const firstReceipt = createPreMergeReceipt(repositoryRoot, claimed.gate, fixedNow);
      expect(firstReceipt.ok).toBe(true);
      const secondReceipt = createPreMergeReceipt(repositoryRoot, claimed.gate, fixedNow);
      expect(secondReceipt.ok).toBe(false);

      const consumed = consumePostMergeReceipt(repositoryRoot, fixedNow + 1_000);
      expect(consumed.error).toBeNull();
      expect(consumed.receipt?.lifecycle.state).toBe("receipt");
      expect(consumed.receipt?.lifecycle.authorizes).toBe(false);
      expect(existsSync(canonicalStatePath(repositoryRoot, "post-merge-receipt.json"))).toBe(false);

      const replay = consumePostMergeReceipt(repositoryRoot, fixedNow + 1_000);
      expect(replay.available).toBe(false);
    }));

  it("refuses replacement and removes only stale plugin temporary files", () =>
    withRepository((repositoryRoot) => {
      const gate = authorityGate("pre-commit");
      writeGate(repositoryRoot, "pre-commit.json", gate, fixedNow);
      expect(() => writeGate(repositoryRoot, "pre-commit.json", gate, fixedNow)).toThrow(
        "already exists",
      );

      const state = join(repositoryRoot, ".github", "github-plugin", "state");
      const staleTemp = join(state, ".tmp-old.json");
      writeFileSync(staleTemp, "stale", "utf8");
      const old = new Date(fixedNow - GATE_TTL_MS - 1);
      utimesSync(staleTemp, old, old);
      const userOwned = join(state, "user-owned.json");
      writeFileSync(userOwned, "keep", "utf8");
      const result = cleanupAbandonedState(repositoryRoot, fixedNow);
      expect(result.removed).toContain(staleTemp);
      expect(existsSync(staleTemp)).toBe(false);
      expect(readFileSync(userOwned, "utf8")).toBe("keep");
      expect(statSync(userOwned).isFile()).toBe(true);
      unlinkSync(userOwned);
      expect(existsSync(userOwned)).toBe(false);
    }));
});
