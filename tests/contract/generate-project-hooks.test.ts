import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(testDirectory, "..", "..", "plugin");
const generator = join(pluginRoot, "hooks", "generate-project-hooks.mjs");
const temporaryRepositories: string[] = [];

type GeneratorResult = {
  status: string;
  target: string;
  hosts: string[];
  plugin_version: string;
  manifest_path: string;
  written_paths: string[];
  unchanged_paths: string[];
  removed_paths: string[];
  recovered_paths: string[];
  blocked: Array<{ path: string | null; reason: string }>;
  limitations: string[];
};

const createRepository = (): string => {
  const repository = mkdtempSync(join(tmpdir(), "cromesdk-project-hooks-"));
  temporaryRepositories.push(repository);
  execFileSync("git", ["init", repository], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return repository;
};

type FaultSpec = {
  phase: string;
  occurrence?: number;
  mode?: "error" | "interrupt";
};

const generate = (
  repository: string,
  hosts: string,
  fault?: FaultSpec,
): GeneratorResult => {
  const environment = { ...process.env };
  if (fault) {
    environment.CROMESDK_PROJECT_HOOKS_TEST_MODE = "1";
    environment.CROMESDK_PROJECT_HOOKS_TEST_FAULT = JSON.stringify(fault);
  } else {
    delete environment.CROMESDK_PROJECT_HOOKS_TEST_MODE;
    delete environment.CROMESDK_PROJECT_HOOKS_TEST_FAULT;
  }
  const output = execFileSync(
    process.execPath,
    [generator, "--target", repository, "--hosts", hosts],
    {
      cwd: pluginRoot,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output) as GeneratorResult;
};

const generateExpectingFailure = (
  repository: string,
  hosts: string,
  fault?: FaultSpec,
): GeneratorResult => {
  try {
    generate(repository, hosts, fault);
  } catch (error) {
    const stdout =
      error && typeof error === "object" && "stdout" in error
        ? String(error.stdout)
        : "";
    return JSON.parse(stdout) as GeneratorResult;
  }
  throw new Error("The generator unexpectedly succeeded.");
};

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const hash = (contents: Buffer): string =>
  createHash("sha256").update(contents).digest("hex");

const manifestFor = (repository: string): Record<string, unknown> =>
  readJson(join(repository, ".github", "github-plugin", "project-hooks-manifest.json"));

afterEach(() => {
  for (const repository of temporaryRepositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe("generate-project-hooks", () => {
  it("generates only the selected Cursor projection", () => {
    const repository = createRepository();
    const result = generate(repository, "cursor");

    expect(result.status).toBe("written");
    expect(result.hosts).toEqual(["cursor"]);
    expect(existsSync(join(repository, ".cursor", "hooks.json"))).toBe(true);
    expect(existsSync(join(repository, ".cursor", "hooks", "pre-commit.mjs"))).toBe(
      true,
    );
    expect(existsSync(join(repository, ".cursor", "hooks", "pre-pr-ready.mjs"))).toBe(
      true,
    );
    expect(existsSync(join(repository, ".cursor", "hooks", "dispatch.mjs"))).toBe(true);
    expect(existsSync(join(repository, ".cursor", "hooks", "lib", "read-hook-input.mjs"))).toBe(
      true,
    );
    expect(existsSync(join(repository, ".cursor", "hooks", "lib", "run-command.mjs"))).toBe(true);
    expect(existsSync(join(repository, ".cursor", "hooks", "lib", "run-command-worker.mjs"))).toBe(true);
    expect(existsSync(join(repository, ".cursor", "hooks", "lib", "repository-policy.mjs"))).toBe(true);
    expect(existsSync(join(repository, ".cursor", "hooks", "lib", "gate-state.mjs"))).toBe(true);
    expect(
      readFileSync(
        join(repository, ".cursor", "hooks", "pre-commit.mjs"),
        "utf8",
      ).endsWith(
        readFileSync(join(pluginRoot, "hooks", "pre-commit.mjs"), "utf8"),
      ),
    ).toBe(true);
    expect(existsSync(join(repository, ".codex", "hooks.json"))).toBe(false);
    expect(readFileSync(join(repository, ".gitignore"), "utf8")).toContain(
      ".github/github-plugin/state/",
    );
    expect(readFileSync(join(repository, ".gitignore"), "utf8")).not.toContain(
      ".cursor/hooks/state/",
    );

    const config = readJson(join(repository, ".cursor", "hooks.json"));
    const hookGroups = Object.values(config.hooks as Record<string, unknown[]>);
    for (const group of hookGroups) {
      for (const definition of group as Array<Record<string, unknown>>) {
        expect(definition.command).toEqual(
          expect.stringContaining("node .cursor/hooks/dispatch.mjs"),
        );
      }
    }
    expect(readFileSync(join(repository, "AGENTS.md"), "utf8")).toContain(
      "`.github/github-plugin/state/`",
    );
    expect(
      existsSync(join(repository, ".github", "github-plugin", "state", "pre-commit.json")),
    ).toBe(false);
  });

  it("generates only the selected Codex projection and keeps the canonical Cursor state ignore", () => {
    const repository = createRepository();
    const result = generate(repository, "codex");

    expect(result.status).toBe("written");
    expect(result.hosts).toEqual(["codex"]);
    expect(existsSync(join(repository, ".codex", "hooks.json"))).toBe(true);
    expect(existsSync(join(repository, ".codex", "hooks", "pre-merge.mjs"))).toBe(
      true,
    );
    expect(existsSync(join(repository, ".codex", "hooks", "pre-pr-ready.mjs"))).toBe(
      true,
    );
    expect(existsSync(join(repository, ".codex", "hooks", "dispatch.mjs"))).toBe(true);
    expect(existsSync(join(repository, ".codex", "hooks", "lib", "run-command.mjs"))).toBe(true);
    expect(existsSync(join(repository, ".codex", "hooks", "lib", "run-command-worker.mjs"))).toBe(true);
    expect(
      readFileSync(join(repository, ".codex", "hooks", "lib", "gate-state.mjs"), "utf8"),
    ).toContain(readFileSync(join(pluginRoot, "hooks", "lib", "gate-state.mjs"), "utf8"));
    expect(existsSync(join(repository, ".cursor", "hooks.json"))).toBe(false);

    const gitignore = readFileSync(join(repository, ".gitignore"), "utf8");
    expect(gitignore).toContain(".github/github-plugin/state/");
    expect(gitignore).not.toContain(".cursor/hooks/state/");
    expect(gitignore).not.toContain(".codex/hooks/state/");

    const config = readJson(join(repository, ".codex", "hooks.json"));
    const codexHooks = config.hooks as Record<string, unknown[]>;
    expect(codexHooks.PreToolUse).toHaveLength(1);
    expect(codexHooks.PostToolUse).toHaveLength(1);
    const groups = Object.values(config.hooks as Record<string, unknown[]>);
    for (const group of groups) {
      for (const matcher of group as Array<Record<string, unknown>>) {
        for (const hook of matcher.hooks as Array<Record<string, unknown>>) {
          expect(hook.command).not.toContain("PLUGIN_ROOT");
          expect(hook.command).toEqual(
            expect.stringContaining(".codex/hooks/dispatch.mjs"),
          );
          if (typeof hook.commandWindows === "string") {
            expect(hook.commandWindows).not.toContain("PLUGIN_ROOT");
            expect(hook.commandWindows).toEqual(
              expect.stringContaining(".codex\\hooks\\"),
            );
          }
        }
      }
    }
    const agents = readFileSync(join(repository, "AGENTS.md"), "utf8");
    expect(agents).toContain("generated Codex project-hook projections");
    expect(agents).toContain("`.github/github-plugin/state/`");
    expect(agents).not.toContain(".cursor/hooks/state/");
    expect(agents).not.toContain(".codex/hooks/state/");
    expect(existsSync(join(repository, ".github", "github-plugin", "state"))).toBe(false);
  });

  it("generates both projections and is unchanged on a repeat run", () => {
    const repository = createRepository();
    const first = generate(repository, "both");
    const second = generate(repository, "cursor,codex");

    expect(first.status).toBe("written");
    expect(first.hosts).toEqual(["cursor", "codex"]);
    expect(second.status).toBe("unchanged");
    expect(second.written_paths).toEqual([]);
    expect(second.unchanged_paths.length).toBeGreaterThan(0);
    expect(existsSync(join(repository, ".cursor", "hooks", "pre-rebase.mjs"))).toBe(
      true,
    );
    expect(existsSync(join(repository, ".codex", "hooks", "pre-rebase.mjs"))).toBe(
      true,
    );
    expect(
      existsSync(join(repository, ".github", "github-plugin", "state", "pre-commit.json")),
    ).toBe(false);
    expect(
      existsSync(join(repository, ".github", "github-plugin", "state", "pre-commit.json")),
    ).toBe(false);
  });

  it("writes a version-1 ownership manifest with verifiable artifact hashes", () => {
    const repository = createRepository();
    const result = generate(repository, "both");
    const manifest = manifestFor(repository);
    const artifacts = manifest.artifacts as Array<Record<string, string | null>>;

    expect(result.manifest_path).toBe(
      join(repository, ".github", "github-plugin", "project-hooks-manifest.json"),
    );
    expect(manifest.schema).toBe("ProjectHookManifest");
    expect(manifest.version).toBe(1);
    expect(manifest.plugin).toBe("github");
    expect(manifest.plugin_version).toBe("0.3.116");
    expect(manifest.hosts).toEqual(["cursor", "codex"]);
    expect(artifacts.some((artifact) => artifact.path === "AGENTS.md" && artifact.mode === "marked-block")).toBe(true);
    expect(artifacts.some((artifact) => artifact.path === ".gitignore" && artifact.mode === "managed-entries")).toBe(true);
    expect(artifacts.some((artifact) => artifact.path === ".github/github-plugin/project-hooks-manifest.json")).toBe(false);

    for (const artifact of artifacts) {
      const artifactPath = join(repository, ...(artifact.path as string).split("/"));
      const contents = readFileSync(artifactPath);
      let hashedContents = contents;
      if (artifact.mode === "marked-block") {
        const text = contents.toString("utf8");
        hashedContents = Buffer.from(
          text.slice(
            text.indexOf("<!-- BEGIN CromeSDK generated GitHub project hooks -->"),
            text.indexOf("<!-- END CromeSDK generated GitHub project hooks -->") +
              "<!-- END CromeSDK generated GitHub project hooks -->".length,
          ),
          "utf8",
        );
      }
      if (artifact.mode === "managed-entries") {
        const text = contents.toString("utf8");
        hashedContents = Buffer.from(
          text.slice(
            text.indexOf("# BEGIN CromeSDK generated GitHub hook state"),
            text.indexOf("# END CromeSDK generated GitHub hook state") +
              "# END CromeSDK generated GitHub hook state".length,
          ),
          "utf8",
        );
      }
      expect(artifact.sha256).toBe(hash(hashedContents));
    }
  });

  it("migrates a proven legacy projection into a new manifest", () => {
    const repository = createRepository();
    generate(repository, "cursor");
    rmSync(join(repository, ".github", "github-plugin", "project-hooks-manifest.json"));

    const result = generate(repository, "cursor");

    expect(result.status).toBe("written");
    expect(result.written_paths).toEqual([
      join(repository, ".github", "github-plugin", "project-hooks-manifest.json"),
    ]);
    expect(manifestFor(repository).version).toBe(1);
  });

  it("removes only unchanged manifest-owned artifacts after host deselection", () => {
    const repository = createRepository();
    generate(repository, "both");
    const userFile = join(repository, ".codex", "hooks", "user-owned.mjs");
    writeFileSync(userFile, "export const userOwned = true;\n");

    const result = generate(repository, "cursor");

    expect(result.status).toBe("written");
    expect(result.removed_paths).toContain(join(repository, ".codex", "hooks.json"));
    expect(existsSync(join(repository, ".codex", "hooks.json"))).toBe(false);
    expect(existsSync(join(repository, ".codex", "hooks", "user-owned.mjs"))).toBe(true);
    expect((manifestFor(repository).hosts as string[])).toEqual(["cursor"]);
  });

  it("blocks host deselection when a removed projection was locally changed", () => {
    const repository = createRepository();
    generate(repository, "both");
    const changedPath = join(repository, ".codex", "hooks", "pre-merge.mjs");
    writeFileSync(changedPath, `${readFileSync(changedPath, "utf8")}\n// local change\n`);

    const result = generateExpectingFailure(repository, "cursor");

    expect(result.status).toBe("blocked");
    expect(result.written_paths).toEqual([]);
    expect(result.removed_paths).toEqual([]);
    expect(readFileSync(changedPath, "utf8")).toContain("// local change");
    expect(existsSync(join(repository, ".codex", "hooks.json"))).toBe(true);
  });

  it("preserves existing repository guidance and gitignore entries", () => {
    const repository = createRepository();
    writeFileSync(join(repository, "AGENTS.md"), "# Existing instructions\n");
    writeFileSync(join(repository, ".gitignore"), "dist/\n");

    generate(repository, "cursor");

    const agents = readFileSync(join(repository, "AGENTS.md"), "utf8");
    expect(agents).toContain("# Existing instructions");
    expect(agents).toContain("CromeSDK GitHub project hooks");
    expect(readFileSync(join(repository, ".gitignore"), "utf8")).toContain(
      "dist/\n",
    );
  });

  it("preserves CRLF in managed guidance and ignore blocks", () => {
    const repository = createRepository();
    writeFileSync(
      join(repository, "AGENTS.md"),
      "# Existing instructions\r\n",
      "utf8",
    );
    writeFileSync(join(repository, ".gitignore"), "dist/\r\n", "utf8");

    generate(repository, "cursor");

    expect(readFileSync(join(repository, "AGENTS.md"), "utf8")).toContain("\r\n");
    expect(readFileSync(join(repository, ".gitignore"), "utf8")).toContain("\r\n");
    expect(readFileSync(join(repository, ".gitignore"), "utf8")).not.toContain(
      "# BEGIN CromeSDK generated GitHub hook state\n",
    );
  });

  it("migrates only managed legacy ignore entries and preserves user-owned entries", () => {
    const repository = createRepository();
    writeFileSync(
      join(repository, ".gitignore"),
      ".cursor/hooks/state/\n# CromeSDK generated GitHub hook state\n.cursor/hooks/state/\n.codex/hooks/state/\nuser-owned/\n",
    );

    generate(repository, "cursor");

    const gitignore = readFileSync(join(repository, ".gitignore"), "utf8");
    expect(gitignore).toContain(".cursor/hooks/state/");
    expect(gitignore).toContain("user-owned/");
    expect(gitignore).toContain(".github/github-plugin/state/");
    expect(gitignore.match(/\.cursor\/hooks\/state\//g)).toHaveLength(1);
    expect(gitignore).not.toContain(".codex/hooks/state/");
  });

  it("blocks before writing when a requested projection conflicts", () => {
    const repository = createRepository();
    mkdirSync(join(repository, ".cursor"), { recursive: true });
    writeFileSync(
      join(repository, ".cursor", "hooks.json"),
      "{}\n",
      { flag: "w" },
    );

    const result = generateExpectingFailure(repository, "cursor");

    expect(result.status).toBe("blocked");
    expect(result.blocked[0]?.path).toBe(
      join(repository, ".cursor", "hooks.json"),
    );
    expect(existsSync(join(repository, ".cursor", "hooks", "pre-commit.mjs"))).toBe(
      false,
    );
    expect(existsSync(join(repository, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(repository, ".gitignore"))).toBe(false);
  });

  it("blocks a changed manifest-owned artifact without changing the projection", () => {
    const repository = createRepository();
    generate(repository, "cursor");
    const generatedPath = join(repository, ".cursor", "hooks", "pre-commit.mjs");
    const beforeManifest = readFileSync(
      join(repository, ".github", "github-plugin", "project-hooks-manifest.json"),
    );
    writeFileSync(generatedPath, `${readFileSync(generatedPath, "utf8")}\n// local change\n`);

    const result = generateExpectingFailure(repository, "cursor");

    expect(result.status).toBe("blocked");
    expect(result.written_paths).toEqual([]);
    expect(result.removed_paths).toEqual([]);
    expect(readFileSync(generatedPath, "utf8")).toContain("// local change");
    expect(
      readFileSync(
        join(repository, ".github", "github-plugin", "project-hooks-manifest.json"),
      ),
    ).toEqual(beforeManifest);
  });

  it("blocks malformed guidance markers before creating any projection", () => {
    const repository = createRepository();
    writeFileSync(
      join(repository, "AGENTS.md"),
      "# user guidance\n<!-- BEGIN CromeSDK generated GitHub project hooks -->\n",
    );

    const result = generateExpectingFailure(repository, "cursor");

    expect(result.status).toBe("blocked");
    expect(result.written_paths).toEqual([]);
    expect(existsSync(join(repository, ".cursor", "hooks.json"))).toBe(false);
    expect(existsSync(join(repository, ".github", "github-plugin", "project-hooks-manifest.json"))).toBe(false);
  });

  it("blocks an unsupported manifest before writing or removing anything", () => {
    const repository = createRepository();
    generate(repository, "cursor");
    writeFileSync(
      join(repository, ".github", "github-plugin", "project-hooks-manifest.json"),
      JSON.stringify({ schema: "ProjectHookManifest", version: 99 }),
    );
    const generatedPath = join(repository, ".cursor", "hooks", "pre-commit.mjs");
    const before = readFileSync(generatedPath);

    const result = generateExpectingFailure(repository, "cursor");

    expect(result.status).toBe("blocked");
    expect(result.written_paths).toEqual([]);
    expect(result.removed_paths).toEqual([]);
    expect(readFileSync(generatedPath)).toEqual(before);
  });

  it("rolls back a normal injected apply failure to the complete old state", () => {
    const repository = createRepository();
    const result = generateExpectingFailure(repository, "both", {
      phase: "apply",
      occurrence: 2,
      mode: "error",
    });

    expect(result.status).toBe("partial");
    expect(result.written_paths).toEqual([]);
    expect(result.removed_paths).toEqual([]);
    expect(existsSync(join(repository, ".cursor", "hooks.json"))).toBe(false);
    expect(existsSync(join(repository, ".codex", "hooks.json"))).toBe(false);
    expect(existsSync(join(repository, ".github", "github-plugin", "project-hooks-manifest.json"))).toBe(false);
    expect(existsSync(join(repository, ".github", "github-plugin", ".project-hooks-transaction"))).toBe(false);
  });

  it("fails before target writes when staging is injected to fail", () => {
    const repository = createRepository();
    const result = generateExpectingFailure(repository, "cursor", {
      phase: "stage",
      occurrence: 1,
      mode: "error",
    });

    expect(result.status).toBe("blocked");
    expect(result.written_paths).toEqual([]);
    expect(result.removed_paths).toEqual([]);
    expect(existsSync(join(repository, ".cursor"))).toBe(false);
    expect(existsSync(join(repository, ".github", "github-plugin", ".project-hooks-transaction"))).toBe(false);
  });

  it.each(["backup", "manifest"])(
    "rolls back an injected %s failure without leaving transaction data",
    (phase) => {
      const repository = createRepository();
      const result = generateExpectingFailure(repository, "cursor", {
        phase,
        occurrence: 1,
        mode: "error",
      });

      expect(result.status).toBe("partial");
      expect(result.written_paths).toEqual([]);
      expect(result.removed_paths).toEqual([]);
      expect(existsSync(join(repository, ".cursor"))).toBe(false);
      expect(existsSync(join(repository, ".github", "github-plugin", "project-hooks-manifest.json"))).toBe(false);
      expect(existsSync(join(repository, ".github", "github-plugin", ".project-hooks-transaction"))).toBe(false);
    },
  );

  it("retains committed evidence when cleanup is injected to fail", () => {
    const repository = createRepository();
    const result = generateExpectingFailure(repository, "cursor", {
      phase: "cleanup",
      occurrence: 1,
      mode: "error",
    });

    expect(result.status).toBe("partial");
    expect(result.written_paths.length).toBeGreaterThan(0);
    expect(existsSync(join(repository, ".cursor", "hooks.json"))).toBe(true);
    expect(existsSync(join(repository, ".github", "github-plugin", "project-hooks-manifest.json"))).toBe(true);
    expect(existsSync(join(repository, ".github", "github-plugin", ".project-hooks-transaction", "journal.json"))).toBe(true);

    const recovered = generate(repository, "cursor");

    expect(recovered.status).toBe("unchanged");
    expect(recovered.recovered_paths.length).toBeGreaterThan(0);
    expect(existsSync(join(repository, ".github", "github-plugin", ".project-hooks-transaction"))).toBe(false);
  });

  it("recovers an interrupted journal on the next run", () => {
    const repository = createRepository();
    const interrupted = generateExpectingFailure(repository, "both", {
      phase: "apply",
      occurrence: 2,
      mode: "interrupt",
    });

    expect(interrupted.status).toBe("partial");
    expect(existsSync(join(repository, ".github", "github-plugin", ".project-hooks-transaction", "journal.json"))).toBe(true);

    const recovered = generate(repository, "both");

    expect(recovered.status).toBe("written");
    expect(recovered.recovered_paths.length).toBeGreaterThan(0);
    expect(existsSync(join(repository, ".cursor", "hooks.json"))).toBe(true);
    expect(existsSync(join(repository, ".codex", "hooks.json"))).toBe(true);
    expect(existsSync(join(repository, ".github", "github-plugin", ".project-hooks-transaction"))).toBe(false);
  });
});
