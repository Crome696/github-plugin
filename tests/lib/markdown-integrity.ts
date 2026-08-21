import { readdir, readFile, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { load } from "js-yaml";

export type ComponentKind = "agent" | "command";

export type LocalLinkResolution = {
  path: string;
  fragment: string | null;
};

type MarkdownLink = {
  target: string;
  line: number;
};

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const inlineLinkPattern =
  /\[[^\]]+\]\(\s*(?:<([^>\r\n]*)>|([^\s)\r\n]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseFrontmatter = (
  source: string,
): Record<string, unknown> => {
  const match = source.match(frontmatterPattern);
  if (!match) {
    throw new Error("missing YAML frontmatter at byte 0");
  }

  let parsed: unknown;
  try {
    parsed = load(match[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid YAML frontmatter: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("YAML frontmatter must contain an object");
  }
  return parsed;
};

export const validateComponentMetadata = (
  expectedName: string,
  kind: ComponentKind,
  source: string,
): string[] => {
  let metadata: Record<string, unknown>;
  try {
    metadata = parseFrontmatter(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`${expectedName}: ${message}`];
  }

  const problems: string[] = [];
  if (metadata.name !== expectedName) {
    problems.push(
      `${expectedName}: frontmatter name must equal ${expectedName}`,
    );
  }
  if (
    typeof metadata.description !== "string" ||
    metadata.description.trim().length === 0
  ) {
    problems.push(`${expectedName}: description must be a non-empty string`);
  }

  if (kind === "agent" && metadata.model !== "inherit") {
    problems.push(`${expectedName}: Agent model must be exactly inherit`);
  }
  if (kind === "command" && Object.hasOwn(metadata, "model")) {
    problems.push(`${expectedName}: Commands must not declare model metadata`);
  }
  return problems;
};

const isExternalLink = (target: string): boolean =>
  target.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target);

const extractMarkdownLinks = (source: string): MarkdownLink[] => {
  const links: MarkdownLink[] = [];
  for (const match of source.matchAll(inlineLinkPattern)) {
    const target = match[1] ?? match[2] ?? "";
    const index = match.index ?? 0;
    links.push({
      target,
      line: source.slice(0, index).split(/\r?\n/).length,
    });
  }
  return links;
};

const assertInsideRepository = (
  repositoryRoot: string,
  candidate: string,
): void => {
  const root = resolve(repositoryRoot);
  const relativePath = relative(root, candidate);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("target resolves outside the repository root");
  }
};

export const resolveLocalLink = (
  repositoryRoot: string,
  sourcePath: string,
  target: string,
): LocalLinkResolution => {
  const trimmed = target.trim();
  if (trimmed.length === 0) {
    throw new Error("local link target is empty");
  }

  const hashIndex = trimmed.indexOf("#");
  const pathAndQuery = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? null : trimmed.slice(hashIndex + 1);
  const queryIndex = pathAndQuery.indexOf("?");
  const pathPart = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch {
    throw new Error("local link target is not valid URI encoding");
  }

  const sourceAbsolute = resolve(sourcePath);
  const candidate = decodedPath.length === 0
    ? sourceAbsolute
    : resolve(dirname(sourceAbsolute), decodedPath);
  assertInsideRepository(repositoryRoot, candidate);
  return { path: candidate, fragment };
};

export const checkMarkdownSourceLinks = async (
  repositoryRoot: string,
  sourcePath: string,
  source: string,
): Promise<string[]> => {
  const problems: string[] = [];
  for (const link of extractMarkdownLinks(source)) {
    if (isExternalLink(link.target)) continue;

    try {
      const resolution = resolveLocalLink(repositoryRoot, sourcePath, link.target);
      await stat(resolution.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`${sourcePath}:${link.line}: ${link.target} (${message})`);
    }
  }
  return problems;
};

const walk = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await walk(path)));
    } else if (entry.isFile() && /\.(?:md|mdc)$/i.test(entry.name)) {
      paths.push(path);
    }
  }
  return paths;
};

export const walkMarkdownFiles = async (
  repositoryRoot: string,
): Promise<string[]> => walk(resolve(repositoryRoot));

export const checkRepositoryMarkdownLinks = async (
  repositoryRoot: string,
): Promise<string[]> => {
  const problems: string[] = [];
  for (const sourcePath of await walkMarkdownFiles(repositoryRoot)) {
    problems.push(
      ...(await checkMarkdownSourceLinks(
        repositoryRoot,
        sourcePath,
        await readFile(sourcePath, "utf8"),
      )),
    );
  }
  return problems;
};

export const componentNameFromPath = (path: string): string =>
  basename(path, ".md");
