import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadRepositoryPolicy } from "../../plugin/hooks/lib/repository-policy.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const makeRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "github-plugin-policy-"));
  temporaryRoots.push(root);
  await mkdir(join(root, ".github"));
  return root;
};

describe("RepositoryPolicy loader", () => {
  it("returns the compatibility default when the policy is absent", async () => {
    const root = await makeRoot();
    const policy = loadRepositoryPolicy(root);
    expect(policy.source).toBe("compatibility_default");
    expect(policy.pull_request.mode).toBe("enforce");
    expect(policy.rebase.worktree).toBe("dedicated");
    expect(policy.rebase.require_remote_backup).toBe(true);
    expect(policy.secrets.mode).toBe("enforce");
  });

  it("accepts valid repository preferences without changing core defaults", async () => {
    const root = await makeRoot();
    await writeFile(join(root, ".github", "github-plugin-policy.json"), JSON.stringify({
      schema: "RepositoryPolicy",
      version: 1,
      pull_request: { mode: "disable", language: "de", required_headings: [] },
      rebase: { mode: "enforce", worktree: "primary", require_remote_upstream: false, require_remote_backup: false },
      secrets: { mode: "warn", filename_patterns: ["regex:^local\\.secret$"], content_patterns: ["CUSTOM_SECRET_[A-Z]+"], scan_scope: "index", max_file_bytes: 1024 },
    }));
    const policy = loadRepositoryPolicy(root);
    expect(policy.source).toBe("repository_policy");
    expect(policy.pull_request.language).toBe("de");
    expect(policy.rebase.worktree).toBe("primary");
    expect(policy.rebase.require_remote_backup).toBe(false);
    expect(policy.secrets.content_patterns[0].source).toBe("CUSTOM_SECRET_[A-Z]+");
    expect(policy.secrets.max_file_bytes).toBe(1024);
  });

  it("fails closed to the compatibility default for malformed and unsupported policies", async () => {
    const root = await makeRoot();
    const path = join(root, ".github", "github-plugin-policy.json");
    await writeFile(path, "not-json");
    expect(loadRepositoryPolicy(root).source).toBe("invalid_policy_fallback");
    await writeFile(path, JSON.stringify({ schema: "RepositoryPolicy", version: 99 }));
    const unsupported = loadRepositoryPolicy(root);
    expect(unsupported.source).toBe("unsupported_policy_fallback");
    expect(unsupported.rebase.require_remote_backup).toBe(true);
    expect(unsupported.secrets.mode).toBe("enforce");
  });
});
