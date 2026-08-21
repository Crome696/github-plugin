import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkMarkdownSourceLinks,
  checkRepositoryMarkdownLinks,
  componentNameFromPath,
  resolveLocalLink,
  validateComponentMetadata,
} from "../lib/markdown-integrity.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..", "..");
const pluginRoot = join(repositoryRoot, "plugin");
const agentsDirectory = join(pluginRoot, "agents");
const commandsDirectory = join(pluginRoot, "commands");

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const markdownFiles = async (directory: string): Promise<string[]> =>
  (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(directory, entry.name))
    .sort();

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

describe("host component and repository link integrity", () => {
  it("requires type-specific metadata for all Agents and Commands", async () => {
    const agents = await markdownFiles(agentsDirectory);
    const commands = await markdownFiles(commandsDirectory);

    expect(agents).toHaveLength(14);
    expect(commands).toHaveLength(16);

    for (const path of agents) {
      const problems = validateComponentMetadata(
        componentNameFromPath(path),
        "agent",
        await readFile(path, "utf8"),
      );
      expect(problems, path).toEqual([]);
    }
    for (const path of commands) {
      const problems = validateComponentMetadata(
        componentNameFromPath(path),
        "command",
        await readFile(path, "utf8"),
      );
      expect(problems, path).toEqual([]);
    }
  });

  it("reports focused errors for missing and type-invalid metadata", () => {
    expect(
      validateComponentMetadata("missing-agent", "agent", "# Agent"),
    ).toEqual([
      "missing-agent: missing YAML frontmatter at byte 0",
    ]);

    expect(
      validateComponentMetadata(
        "invalid-command",
        "command",
        "---\nname: invalid-agent\ndescription: test\nmodel: inherit\n---\n",
      ),
    ).toEqual([
      "invalid-command: frontmatter name must equal invalid-command",
      "invalid-command: Commands must not declare model metadata",
    ]);
  });

  it("resolves all repository-local Markdown and MDC links", async () => {
    expect(await checkRepositoryMarkdownLinks(repositoryRoot)).toEqual([]);
  });

  it("handles anchors and directories and rejects broken or escaping links", async () => {
    const readme = join(repositoryRoot, "README.md");
    expect(resolveLocalLink(repositoryRoot, readme, "#snapshot").path).toBe(
      readme,
    );
    expect(resolveLocalLink(repositoryRoot, readme, "plugin/").path).toBe(
      pluginRoot,
    );
    expect(() =>
      resolveLocalLink(repositoryRoot, readme, "../outside.md"),
    ).toThrow("outside the repository root");

    expect(
      await checkMarkdownSourceLinks(
        repositoryRoot,
        readme,
        "[broken](missing-file.md)",
      ),
    ).toHaveLength(1);
  });

  it("keeps Cursor, Claude, and Codex host discovery paths available", async () => {
    const affectedAgents = ["ci-fix-agent.md", "review-fix-agent.md"];
    const affectedCommands = [
      "auto-ci-fix-pr.md",
      "auto-review-fix-pr.md",
    ];

    for (const host of [".cursor-plugin", ".claude-plugin"]) {
      const manifest = await readJson(join(pluginRoot, host, "plugin.json"));
      expect(manifest.agents, host).toBe("./agents/");
      expect(manifest.commands, host).toBe("./commands/");
      for (const file of affectedAgents) {
        expect(await pathExists(join(pluginRoot, "agents", file)), file).toBe(
          true,
        );
      }
      for (const file of affectedCommands) {
        expect(await pathExists(join(pluginRoot, "commands", file)), file).toBe(
          true,
        );
      }
    }

    const codex = await readJson(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
    );
    expect(codex.skills).toBe("./skills/");
    expect(codex.hooks).toBe("./hooks/codex-hooks.json");
    expect(await pathExists(join(pluginRoot, "skills"))).toBe(true);
    expect(await pathExists(join(pluginRoot, "docs", "README.md"))).toBe(true);
  });
});
