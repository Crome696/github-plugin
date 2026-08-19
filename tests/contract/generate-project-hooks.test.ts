import { execFileSync } from "node:child_process";
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
  written_paths: string[];
  unchanged_paths: string[];
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

const generate = (repository: string, hosts: string): GeneratorResult => {
  const output = execFileSync(
    process.execPath,
    [generator, "--target", repository, "--hosts", hosts],
    {
      cwd: pluginRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output) as GeneratorResult;
};

const generateExpectingFailure = (
  repository: string,
  hosts: string,
): GeneratorResult => {
  try {
    generate(repository, hosts);
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
    expect(existsSync(join(repository, ".cursor", "hooks", "lib", "read-hook-input.mjs"))).toBe(
      true,
    );
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
      ".cursor/hooks/state/",
    );
    expect(readFileSync(join(repository, ".gitignore"), "utf8")).not.toContain(
      ".codex/hooks/state/",
    );

    const config = readJson(join(repository, ".cursor", "hooks.json"));
    const hookGroups = Object.values(config.hooks as Record<string, unknown[]>);
    for (const group of hookGroups) {
      for (const definition of group as Array<Record<string, unknown>>) {
        expect(definition.command).toEqual(
          expect.stringContaining("node .cursor/hooks/"),
        );
      }
    }
    expect(readFileSync(join(repository, "AGENTS.md"), "utf8")).toContain(
      "`.cursor/hooks/state/`",
    );
    expect(
      existsSync(join(repository, ".cursor", "hooks", "state", "pre-commit.json")),
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
    expect(existsSync(join(repository, ".cursor", "hooks.json"))).toBe(false);

    const gitignore = readFileSync(join(repository, ".gitignore"), "utf8");
    expect(gitignore).toContain(".cursor/hooks/state/");
    expect(gitignore).toContain(".codex/hooks/state/");

    const config = readJson(join(repository, ".codex", "hooks.json"));
    const groups = Object.values(config.hooks as Record<string, unknown[]>);
    for (const group of groups) {
      for (const matcher of group as Array<Record<string, unknown>>) {
        for (const hook of matcher.hooks as Array<Record<string, unknown>>) {
          expect(hook.command).not.toContain("PLUGIN_ROOT");
          expect(hook.command).toEqual(
            expect.stringContaining(".codex/hooks/"),
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
    expect(agents).toContain("`.cursor/hooks/state/` and `.codex/hooks/state/`");
    expect(existsSync(join(repository, ".codex", "hooks", "state"))).toBe(false);
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
      existsSync(join(repository, ".cursor", "hooks", "state", "pre-commit.json")),
    ).toBe(false);
    expect(
      existsSync(join(repository, ".codex", "hooks", "state", "pre-commit.json")),
    ).toBe(false);
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
});
