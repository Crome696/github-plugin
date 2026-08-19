import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const pluginRoot = join(repositoryRoot, "plugin");
const githubVersion = "0.3.106";

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

describe("GitHub plugin manifest synchronization", () => {
  it("keeps all plugin host manifests on the same version", async () => {
    const paths = [
      join(pluginRoot, "plugin.json"),
      join(pluginRoot, ".claude-plugin", "plugin.json"),
      join(pluginRoot, ".cursor-plugin", "plugin.json"),
      join(pluginRoot, ".codex-plugin", "plugin.json"),
    ];
    for (const path of paths) {
      const manifest = await readJson(path);
      expect(manifest.version, path).toBe(githubVersion);
    }
  });

  it("keeps marketplace GitHub entries synchronized", async () => {
    const paths = [
      join(repositoryRoot, ".agents", "plugins", "marketplace.json"),
      join(repositoryRoot, ".cursor-plugin", "marketplace.json"),
      join(repositoryRoot, ".claude-plugin", "marketplace.json"),
    ];
    for (const path of paths) {
      const marketplace = await readJson(path);
      const plugins = marketplace.plugins as Array<Record<string, unknown>>;
      const github = plugins.find((plugin) => plugin.name === "github");
      expect(github, path).toBeDefined();
      expect(github?.version, path).toBe(githubVersion);
      const source =
        typeof github?.source === "string"
          ? github.source
          : (github?.source as Record<string, unknown> | undefined)?.path;
      expect(source, path).toBe("./plugin");
    }
  });

  it("keeps declared local plugin paths available", async () => {
    const portable = await readJson(join(pluginRoot, "plugin.json"));
    const cursor = await readJson(
      join(pluginRoot, ".cursor-plugin", "plugin.json"),
    );
    const codex = await readJson(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
    );
    const claude = await readJson(
      join(pluginRoot, ".claude-plugin", "plugin.json"),
    );
    const manifests = [portable, cursor, codex, claude];
    const relativePaths = new Set<string>();
    for (const manifest of manifests) {
      for (const key of [
        "skills",
        "agents",
        "commands",
        "rules",
        "logo",
        "hooks",
      ]) {
        const value = manifest[key];
        if (typeof value === "string" && value.startsWith("./")) {
          relativePaths.add(value);
        }
      }
    }
    relativePaths.add("./assets/logo.png");
    for (const relativePath of relativePaths) {
      expect(
        await pathExists(join(pluginRoot, relativePath.slice(2))),
        relativePath,
      ).toBe(true);
    }
  });

  it("keeps the portable manifest free of host-specific hook declarations", async () => {
    const portable = await readJson(join(pluginRoot, "plugin.json"));
    expect(portable.hooks).toBeUndefined();
  });

  it("keeps tests and test tooling outside the marketplace source", async () => {
    for (const name of [
      "tests",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "vitest.config.ts",
    ]) {
      expect(await pathExists(join(pluginRoot, name)), name).toBe(false);
    }
    expect(await pathExists(join(repositoryRoot, "tests"))).toBe(true);
    expect(await pathExists(join(repositoryRoot, "package.json"))).toBe(true);
  });
});
