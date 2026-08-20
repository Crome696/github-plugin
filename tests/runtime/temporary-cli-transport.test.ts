import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  cleanupTransportFile,
  CliTransportError,
  runCliTransport,
} from "../lib/temporary-cli-transport.js";

const worktreePath = resolve(process.cwd());
const tempDirectory = resolve(tmpdir());

const affectedSkills = [
  "create-commit",
  "create-draft-pr",
  "submit-pr-review",
  "create-github-issue",
  "update-github-issue",
] as const;

const payloads: Record<(typeof affectedSkills)[number], Buffer> = {
  "create-commit": Buffer.from("fix: exact bytes …\r\n\r\n# Keep Markdown\n trailing ", "utf8"),
  "create-draft-pr": Buffer.from("## Problem\r\n\r\nUnicode: ä, 中, 🚀\n", "utf8"),
  "submit-pr-review": Buffer.from(
    '{"body":"line 1\\nline 2","event":"COMMENT","comments":[{"path":"x\\\"y.ts","line":7}]}',
    "utf8",
  ),
  "create-github-issue": Buffer.from("Issue body with leading and trailing spaces  \n", "utf8"),
  "update-github-issue": Buffer.from("Updated body\r\n\r\n- preserve *exactly*\n", "utf8"),
};

const matchingFiles = (prefix: string): string[] =>
  readdirSync(tempDirectory)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(tempDirectory, name))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });

describe.sequential("temporary CLI transport lifecycle", () => {
  it("keeps exact bytes and removes the file for every handled primary outcome on every affected path", async () => {
    const outcomes = [
      { name: "success", expected: { kind: "success" } as const, invoke: () => ({ kind: "success" } as const) },
      { name: "nonzero exit", expected: { kind: "nonzero" } as const, invoke: () => ({ kind: "nonzero", exitCode: 17 } as const) },
      { name: "timeout", expected: { kind: "timeout" } as const, invoke: () => { throw new CliTransportError("timeout"); } },
      { name: "parse failure", expected: { kind: "parse-error" } as const, invoke: () => ({ kind: "parse-error" } as const) },
      { name: "handled exception", expected: { kind: "exception" } as const, invoke: () => { throw new Error("payload must never appear in diagnostics"); } },
    ];

    for (const skill of affectedSkills) {
      for (const outcome of outcomes) {
        const prefix = `cromesdk-issue12-${skill}-${outcome.name.replaceAll(" ", "-")}-${randomUUID()}`;
        const received: Buffer[] = [];
        const payload = payloads[skill];
        expect(matchingFiles(prefix)).toEqual([]);

        const lifecycle = await runCliTransport(
          payload,
          (path) => {
            received.push(readFileSync(path));
            return outcome.invoke();
          },
          { worktreePath, tempDirectory, prefix },
        );

        expect(lifecycle.invocationCount, `${skill}/${outcome.name}`).toBe(1);
        expect(received, `${skill}/${outcome.name}`).toHaveLength(1);
        expect(received[0], `${skill}/${outcome.name}`).toEqual(payload);
        expect(lifecycle.primary.kind, `${skill}/${outcome.name}`).toBe(outcome.expected.kind);
        if (outcome.expected.kind === "nonzero") {
          expect(lifecycle.primary.exitCode, `${skill}/${outcome.name}`).toBe(17);
        }
        expect(lifecycle.cleanup, `${skill}/${outcome.name}`).toEqual({ status: "deleted" });
        expect(matchingFiles(prefix), `${skill}/${outcome.name}`).toEqual([]);
      }
    }
  });

  it("preserves the primary result and redacts cleanup failures", async () => {
    const secretPayload = Buffer.from("TOP-SECRET-ISSUE-12-PAYLOAD\r\n", "utf8");
    for (const skill of affectedSkills) {
      const prefix = `cromesdk-issue12-cleanup-failure-${skill}-${randomUUID()}`;
      const lifecycle = await runCliTransport(
        secretPayload,
        (path) => {
          expect(readFileSync(path)).toEqual(secretPayload);
          return { kind: "nonzero", exitCode: 9 } as const;
        },
        {
          worktreePath,
          tempDirectory,
          prefix,
          unlinkFile: () => {
            const error = new Error(secretPayload.toString("utf8")) as Error & { code: string };
            error.code = "EPERM";
            throw error;
          },
        },
      );

      expect(lifecycle.primary).toEqual({ kind: "nonzero", exitCode: 9 });
      expect(lifecycle.cleanup.status).toBe("failed");
      if (lifecycle.cleanup.status === "failed") {
        expect(lifecycle.cleanup.warning).toContain("primary operation result is preserved");
        expect(lifecycle.cleanup.warning).not.toContain(secretPayload.toString("utf8"));
        expect(lifecycle.cleanup.warning).not.toContain("TOP-SECRET-ISSUE-12-PAYLOAD");
      }
      expect(JSON.stringify(lifecycle)).not.toContain(secretPayload.toString("utf8"));
      expect(lifecycle.filePath).not.toBeNull();
      if (lifecycle.filePath !== null) unlinkSync(lifecycle.filePath);
      expect(matchingFiles(prefix)).toEqual([]);
    }
  });

  it("exercises the native locked-file path on Windows when the OS denies unlink", async () => {
    if (process.platform !== "win32") return;

    const prefix = `cromesdk-issue12-locked-${randomUUID()}`;
    let lockedHandle: number | null = null;
    const lifecycle = await runCliTransport(
      payloads["update-github-issue"],
      (path) => {
        lockedHandle = openSync(path, "r");
        return { kind: "success" } as const;
      },
      { worktreePath, tempDirectory, prefix },
    );

    if (lockedHandle !== null) closeSync(lockedHandle);
    expect(lifecycle.primary).toEqual({ kind: "success" });
    if (lifecycle.cleanup.status === "failed") {
      expect(lifecycle.cleanup.warning).not.toContain(payloads["update-github-issue"].toString("utf8"));
      if (lifecycle.filePath !== null && existsSync(lifecycle.filePath)) unlinkSync(lifecycle.filePath);
    } else {
      expect(lifecycle.cleanup).toEqual({ status: "deleted" });
    }
    expect(matchingFiles(prefix)).toEqual([]);
  });

  it("reports an already missing file without changing the primary result", async () => {
    const prefix = `cromesdk-issue12-missing-${randomUUID()}`;
    const lifecycle = await runCliTransport(
      payloads["create-draft-pr"],
      (path) => {
        expect(existsSync(path)).toBe(true);
        unlinkSync(path);
        return { kind: "success" } as const;
      },
      { worktreePath, tempDirectory, prefix },
    );

    expect(lifecycle.primary).toEqual({ kind: "success" });
    expect(lifecycle.cleanup).toEqual({ status: "absent" });
    expect(matchingFiles(prefix)).toEqual([]);
  });

  it("blocks the CLI when private permissions cannot be verified", async () => {
    const prefix = `cromesdk-issue12-permissions-${randomUUID()}`;
    let calls = 0;
    const lifecycle = await runCliTransport(
      payloads["create-commit"],
      () => {
        calls += 1;
        return { kind: "success" } as const;
      },
      {
        worktreePath,
        tempDirectory,
        prefix,
        verifyPrivatePermissions: () => false,
      },
    );

    expect(calls).toBe(0);
    expect(lifecycle.invocationCount).toBe(0);
    expect(lifecycle.primary).toEqual({ kind: "blocked", reason: "PRIVATE_PERMISSIONS_UNVERIFIED" });
    expect(lifecycle.cleanup).toEqual({ status: "not-created" });
    expect(matchingFiles(prefix)).toEqual([]);
  });

  it("uses exclusive creation and does not overwrite a colliding transport name", async () => {
    const prefix = `cromesdk-issue12-collision-${randomUUID()}`;
    const collision = join(tempDirectory, `${prefix}-collision.payload`);
    const sentinel = Buffer.from("pre-existing file", "utf8");
    writeFileSync(collision, sentinel, { flag: "wx" });
    const ids = ["collision", "unique"];

    try {
      const lifecycle = await runCliTransport(
        payloads["submit-pr-review"],
        (path) => ({ kind: readFileSync(path).equals(payloads["submit-pr-review"]) ? "success" : "parse-error" } as const),
        { worktreePath, tempDirectory, prefix, randomId: () => ids.shift() ?? "exhausted" },
      );

      expect(lifecycle.primary).toEqual({ kind: "success" });
      expect(lifecycle.cleanup).toEqual({ status: "deleted" });
      expect(readFileSync(collision)).toEqual(sentinel);
      expect(matchingFiles(prefix)).toEqual([collision]);
    } finally {
      if (existsSync(collision)) unlinkSync(collision);
    }
  });

  it("rejects unsafe, directory, worktree, traversal, and symlink cleanup targets", () => {
    const prefix = `cromesdk-issue12-target-validation-${randomUUID()}`;
    const directory = join(tempDirectory, `${prefix}-directory`);
    const realFile = join(tempDirectory, `${prefix}-real.payload`);
    const symlink = join(tempDirectory, `${prefix}-link.payload`);
    mkdirSync(directory);
    writeFileSync(realFile, Buffer.from("do not delete through a link", "utf8"), { flag: "wx" });

    try {
      expect(cleanupTransportFile(directory, { worktreePath, tempDirectory })).toEqual({
        status: "blocked",
        reason: "TARGET_NOT_REGULAR_FILE",
      });
      expect(cleanupTransportFile(worktreePath, { worktreePath, tempDirectory }).status).toBe("blocked");
      expect(
        cleanupTransportFile(join(tempDirectory, prefix, "..", "..", `${prefix}-outside.payload`), {
          worktreePath,
          tempDirectory,
        }),
      ).toEqual({ status: "blocked", reason: "TARGET_OUTSIDE_TEMP" });

      try {
        symlinkSync(realFile, symlink);
      } catch (error) {
        if (process.platform !== "win32") throw error;
        return;
      }
      expect(cleanupTransportFile(symlink, { worktreePath, tempDirectory })).toEqual({
        status: "blocked",
        reason: "TARGET_SYMLINK",
      });
      expect(existsSync(realFile)).toBe(true);
    } finally {
      if (existsSync(symlink)) unlinkSync(symlink);
      if (existsSync(realFile)) unlinkSync(realFile);
      if (existsSync(directory)) rmdirSync(directory);
    }
  });

  it("documents the same lifecycle reference on exactly the five affected Skills", () => {
    for (const skill of affectedSkills) {
      const source = readFileSync(resolve(process.cwd(), "plugin", "skills", skill, "SKILL.md"), "utf8");
      expect(source, skill).toContain("cli-transport-file-lifecycle.mdc");
      expect(source, skill).not.toMatch(/remove (?:it|the file) after the operation when safe/i);
      expect(source, skill).not.toMatch(/remove the temporary file only after Git returns/i);
    }
  });
});
