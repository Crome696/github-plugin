import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Host = "cursor" | "codex";
type RecoveryOption = "--continue" | "--skip" | "--abort";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const generatorPath = join(repositoryRoot, "plugin", "hooks", "generate-project-hooks.mjs");
const repository = "Crome696/github-plugin";
const branch = "feature/rebase-recovery-test";
const baseBranch = "master";
const pullRequestNumber = 6;

interface Fixture {
  root: string;
  primary: string;
  target: string;
  other: string;
  gatePath: string;
  baseSha: string;
  headSha: string;
  targetSha: string;
  primarySnapshot: { head: string; status: string; branch: string };
}

const gitEnvironment = (root: string): NodeJS.ProcessEnv => {
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
    HOME: home,
    USERPROFILE: home,
    CI: "1",
  };
};

const runGit = (
  cwd: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): string => {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with ${result.status}: ${result.stderr ?? result.error?.message ?? ""}`,
    );
  }
  return (result.stdout ?? "").trim();
};

const runGitAllowFailure = (
  cwd: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
) =>
  spawnSync("git", ["-C", cwd, ...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });

const commit = (cwd: string, message: string, environment: NodeJS.ProcessEnv) => {
  runGit(cwd, ["add", "--", "."], environment);
  runGit(cwd, ["commit", "-m", message], environment);
};

const writeGate = (
  fixture: Omit<Fixture, "primarySnapshot">,
  operation: "pre-rebase-start" | "pre-rebase-continue" | "pre-rebase-skip" | "pre-rebase-abort" = "pre-rebase-start",
) => {
  const issuedAt = Date.now() - 1_000;
  const gate = {
    schema: "PreRebaseGate",
    version: 2,
    lifecycle: {
      schema: "GateLifecycle",
      version: 1,
      operation,
      nonce: randomUUID(),
      state: "authority",
      authorizes: true,
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(issuedAt + 5 * 60 * 1000).toISOString(),
      consumed_at: null,
      receipt_expires_at: null,
    },
    workspace: {
      repository,
      path: fixture.target,
      branch,
      head_sha: fixture.headSha,
    },
    pull_request: {
      repository,
      number: pullRequestNumber,
      url: `https://github.com/${repository}/pull/${pullRequestNumber}`,
      base_branch: baseBranch,
      base_branch_candidates: [baseBranch],
      head_branch: branch,
      head_sha: fixture.headSha,
    },
    target_fetch: {
      schema: "TargetBranchFetch",
      version: 1,
      status: "verified",
      repository,
      remote: {
        name: "origin",
        owner_repository: repository,
        fetch_url_sanitized: `https://github.com/${repository}.git`,
      },
      branch_name: baseBranch,
      remote_ref: `refs/heads/${baseBranch}`,
      tracking_ref: `refs/remotes/origin/${baseBranch}`,
      remote_sha: fixture.targetSha,
      tracking_sha: fixture.targetSha,
      authorization: { approved: true, evidence: "Issue #6 recovery fixture target fetch" },
      fetch: { attempted: true, result: "success", evidence: ["isolated fixture"] },
      verification: {
        repository_match: "pass",
        remote_branch_exists: "pass",
        tracking_ref_exists: "pass",
        sha_match: "pass",
      },
      failure: null,
      recommended_next_skill: null,
    },
    authorization: {
      approved: true,
      exact_target: true,
      exact_operation: true,
      source: "explicit_user",
      evidence: "Issue #6 recovery fixture exact rebase authorization",
      approved_at: new Date(Date.now() - 1_000).toISOString(),
    },
    written_at: new Date(Date.now() - 1_000).toISOString(),
  };
  mkdirSync(dirname(fixture.gatePath), { recursive: true });
  writeFileSync(fixture.gatePath, `${JSON.stringify(gate, null, 2)}\n`, "utf8");
};

const createFixture = (): Fixture => {
  const root = mkdtempSync(join(tmpdir(), "cromesdk-issue-6-rebase-"));
  const primary = join(root, "primary");
  const target = join(root, "target");
  const other = join(root, "other");
  const environment = gitEnvironment(root);

  try {
    execFileSync("git", ["init", "--initial-branch", baseBranch, primary], {
      cwd: root,
      env: environment,
      encoding: "utf8",
      windowsHide: true,
    });
    runGit(primary, ["config", "user.name", "Issue 6 Runtime Test"], environment);
    runGit(primary, ["config", "user.email", "issue-6@example.invalid"], environment);
    writeFileSync(join(primary, ".gitignore"), ".cursor/\n.codex/\nAGENTS.md\n", "utf8");
    writeFileSync(join(primary, "conflict.txt"), "base\n", "utf8");
    commit(primary, "base", environment);
    const baseSha = runGit(primary, ["rev-parse", "HEAD"], environment);

    runGit(primary, ["branch", branch, baseSha], environment);
    runGit(primary, ["worktree", "add", target, branch], environment);
    runGit(target, ["config", "user.name", "Issue 6 Runtime Test"], environment);
    runGit(target, ["config", "user.email", "issue-6@example.invalid"], environment);
    writeFileSync(join(target, "conflict.txt"), "feature\n", "utf8");
    commit(target, "feature conflict", environment);
    const featureCommitSha = runGit(target, ["rev-parse", "HEAD"], environment);

    writeFileSync(join(primary, "conflict.txt"), "master\n", "utf8");
    commit(primary, "master conflict", environment);
    const targetSha = runGit(primary, ["rev-parse", "HEAD"], environment);

    runGit(primary, ["remote", "add", "origin", `https://github.com/${repository}.git`], environment);
    runGit(primary, ["update-ref", `refs/remotes/origin/${baseBranch}`, targetSha], environment);
    runGit(primary, ["update-ref", `refs/remotes/origin/${branch}`, featureCommitSha], environment);
    runGit(primary, ["symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${baseBranch}`], environment);
    runGit(target, ["config", `branch.${branch}.remote`, "origin"], environment);
    runGit(target, ["config", `branch.${branch}.merge`, `refs/heads/${branch}`], environment);

    execFileSync(process.execPath, [generatorPath, "--target", target, "--hosts", "both"], {
      cwd: repositoryRoot,
      env: environment,
      encoding: "utf8",
      windowsHide: true,
    });
    runGit(target, ["add", ".gitignore"], environment);
    runGit(target, ["commit", "-m", "generate isolated host hook projections"], environment);
    const headSha = runGit(target, ["rev-parse", "HEAD"], environment);
    runGit(primary, ["update-ref", `refs/remotes/origin/${branch}`, headSha], environment);

    const fixture = {
      root,
      primary,
      target,
      other,
      gatePath: join(target, ".github", "github-plugin", "state", "pre-rebase.json"),
      baseSha,
      headSha,
      targetSha,
    };
    writeGate(fixture);
    return {
      ...fixture,
      primarySnapshot: snapshot(primary, environment),
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
};

const snapshot = (primary: string, environment: NodeJS.ProcessEnv) => ({
  head: runGit(primary, ["rev-parse", "HEAD"], environment),
  status: runGit(primary, ["status", "--porcelain=v1", "--untracked-files=all"], environment),
  branch: runGit(primary, ["branch", "--show-current"], environment),
});

const generatedEntrypoint = (fixture: Fixture, host: Host) =>
  join(fixture.target, host === "cursor" ? ".cursor" : ".codex", "hooks", "pre-rebase.mjs");

const payloadFor = (host: Host, command: string, cwd: string) =>
  host === "cursor"
    ? { hook_event_name: "beforeShellExecution", command, cwd }
    : { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command, cwd } };

const invokeHook = (
  fixture: Fixture,
  host: Host,
  command: string,
  cwd = fixture.target,
) => {
  const environment = gitEnvironment(fixture.root);
  const child = spawnSync(process.execPath, [generatedEntrypoint(fixture, host)], {
    cwd,
    env: environment,
    input: `${JSON.stringify(payloadFor(host, command, cwd))}\n`,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  const lines = (child.stdout ?? "").split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(`Expected one hook JSON line, received ${lines.length}: ${child.stdout}\n${child.stderr}`);
  }
  return { status: child.status, output: JSON.parse(lines[0]) as Record<string, unknown> };
};

const assertDecision = (
  fixture: Fixture,
  host: Host,
  command: string,
  allow: boolean,
  cwd = fixture.target,
) => {
  const result = invokeHook(fixture, host, command, cwd);
  expect(result.status, JSON.stringify(result.output)).toBe(allow ? 0 : 2);
  if (host === "cursor") {
    expect(result.output.permission).toBe(allow ? "allow" : "deny");
    if (!allow) {
      expect(typeof result.output.user_message).toBe("string");
      expect(typeof result.output.agent_message).toBe("string");
    }
  } else {
    const specific = result.output.hookSpecificOutput as Record<string, unknown>;
    expect(specific.hookEventName).toBe("PreToolUse");
    expect(specific.permissionDecision).toBe(allow ? "allow" : "deny");
    if (!allow) expect(typeof specific.permissionDecisionReason).toBe("string");
  }
};

const activeRebasePaths = (fixture: Fixture, environment: NodeJS.ProcessEnv) =>
  ["rebase-merge", "rebase-apply"]
    .map((marker) => {
      const value = runGit(fixture.target, ["rev-parse", "--git-path", marker], environment);
      return {
        marker,
        path: resolve(value),
      };
    })
    .filter(({ path }) => existsSync(path));

const startConflict = (fixture: Fixture) => {
  const environment = gitEnvironment(fixture.root);
  const status = runGit(fixture.target, ["status", "--porcelain=v1", "--untracked-files=all"], environment);
  if (status.length > 0) throw new Error(`fixture is dirty before rebase: ${status}`);
  for (const host of ["cursor", "codex"] as Host[]) {
    writeGate(fixture, "pre-rebase-start");
    assertDecision(fixture, host, `git rebase ${fixture.targetSha}`, true);
  }
  const result = runGitAllowFailure(fixture.target, ["rebase", fixture.targetSha], environment);
  expect(result.status).not.toBe(0);
  expect(activeRebasePaths(fixture, environment)).toHaveLength(1);
};

const finishFixture = (fixture: Fixture) => {
  const environment = gitEnvironment(fixture.root);
  runGitAllowFailure(fixture.target, ["rebase", "--abort"], environment);
  rmSync(fixture.root, { recursive: true, force: true });
};

describe.sequential("Issue #6 guarded rebase recovery", () => {
  it("allows continue, skip, and abort only after a real conflict rebase in both hosts", () => {
    for (const option of ["--continue", "--skip", "--abort"] as RecoveryOption[]) {
      const fixture = createFixture();
      try {
        startConflict(fixture);
        const environment = gitEnvironment(fixture.root);

        if (option === "--continue") {
          writeFileSync(join(fixture.target, "conflict.txt"), "resolved\n", "utf8");
          runGit(fixture.target, ["add", "conflict.txt"], environment);
        }
        for (const host of ["cursor", "codex"] as Host[]) {
          writeGate(fixture, option === "--continue" ? "pre-rebase-continue" : option === "--skip" ? "pre-rebase-skip" : "pre-rebase-abort");
          assertDecision(fixture, host, `git rebase ${option}`, true);
        }
        const commandEnvironment = { ...environment, GIT_EDITOR: "true" };
        const result = runGitAllowFailure(fixture.target, ["rebase", option], commandEnvironment);
        expect(result.status).toBe(0);
        expect(activeRebasePaths(fixture, environment)).toHaveLength(0);
        expect(snapshot(fixture.primary, environment)).toEqual(fixture.primarySnapshot);
      } finally {
        finishFixture(fixture);
      }
    }
  }, 120_000);

  it("denies recovery without exact standalone command and active identity", () => {
    const fixture = createFixture();
    try {
      startConflict(fixture);
      const environment = gitEnvironment(fixture.root);
      const malformedCases = [
        "git rebase --continue --no-edit",
        "git rebase --continue && echo unsupported",
        "env git rebase --continue",
        `git -C "${fixture.target}" rebase --continue --no-edit`,
      ];
      for (const command of malformedCases) {
        for (const host of ["cursor", "codex"] as Host[]) {
          assertDecision(fixture, host, command, false);
        }
      }

      const metadataDirectory = activeRebasePaths(fixture, environment)[0].path;
      const ontoPath = join(metadataDirectory, "onto");
      const originalOnto = readFileSync(ontoPath, "utf8");
      writeFileSync(ontoPath, `${"0".repeat(40)}\n`, "utf8");
      for (const host of ["cursor", "codex"] as Host[]) {
        assertDecision(fixture, host, "git rebase --continue", false);
      }
      writeFileSync(ontoPath, originalOnto, "utf8");

      const applyPath = resolve(runGit(fixture.target, ["rev-parse", "--git-path", "rebase-apply"], environment));
      mkdirSync(applyPath, { recursive: true });
      try {
        for (const host of ["cursor", "codex"] as Host[]) {
          assertDecision(fixture, host, "git rebase --continue", false);
        }
      } finally {
        rmSync(applyPath, { recursive: true, force: true });
      }

      runGit(fixture.primary, ["worktree", "add", "--detach", fixture.other, baseBranch], environment);
      const otherGatePath = join(fixture.other, ".github", "github-plugin", "state", "pre-rebase.json");
      writeGate({ ...fixture, target: fixture.target, gatePath: otherGatePath });
      for (const host of ["cursor", "codex"] as Host[]) {
        assertDecision(fixture, host, "git rebase --continue", false, fixture.other);
      }

      runGit(fixture.target, ["rebase", "--abort"], environment);
      for (const host of ["cursor", "codex"] as Host[]) {
        assertDecision(fixture, host, "git rebase --continue", false);
      }
      expect(snapshot(fixture.primary, environment)).toEqual(fixture.primarySnapshot);
    } finally {
      finishFixture(fixture);
    }
  }, 120_000);

  it("accepts direct Windows/POSIX and -C recovery forms while rejecting compound starts", () => {
    const fixture = createFixture();
    try {
      startConflict(fixture);
      for (const command of [
        "git.exe rebase --abort",
        `git -C "${fixture.target}" rebase --abort`,
      ]) {
        for (const host of ["cursor", "codex"] as Host[]) {
          writeGate(fixture, "pre-rebase-abort");
          assertDecision(fixture, host, command, true);
        }
      }
      for (const command of [
        `git rebase ${fixture.targetSha} && echo unsupported`,
        `echo unsupported && git rebase ${fixture.targetSha}`,
        `git rebase ${fixture.targetSha} | echo unsupported`,
      ]) {
        for (const host of ["cursor", "codex"] as Host[]) {
          assertDecision(fixture, host, command, false);
        }
      }
    } finally {
      finishFixture(fixture);
    }
  }, 120_000);

  it("validates the apply-backend administrative state as well as merge-backend state", () => {
    const fixture = createFixture();
    try {
      const environment = gitEnvironment(fixture.root);
      runGit(fixture.target, ["config", "rebase.backend", "apply"], environment);
      startConflict(fixture);
      expect(activeRebasePaths(fixture, environment)[0].marker).toBe("rebase-apply");
      for (const host of ["cursor", "codex"] as Host[]) {
        writeGate(fixture, "pre-rebase-abort");
        assertDecision(fixture, host, "git rebase --abort", true);
      }
      runGit(fixture.target, ["rebase", "--abort"], environment);
      expect(activeRebasePaths(fixture, environment)).toHaveLength(0);
      expect(snapshot(fixture.primary, environment)).toEqual(fixture.primarySnapshot);
    } finally {
      finishFixture(fixture);
    }
  }, 120_000);
});
