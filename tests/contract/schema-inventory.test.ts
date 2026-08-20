import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  FieldDefinition,
  SchemaDocument,
  listSchemaPaths,
  readAllSchemas,
  splitType,
} from "../lib/parse-schema.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(testDirectory, "..", "..", "plugin");
const schemaDirectory = join(pluginRoot, "shared", "schemas");
const expectedVersionTwo = new Set([
  "IssueDraft",
  "LinkedIssueClosure",
  "LoadedPullRequestDiscussions",
  "PrePrCreateGate",
  "PullRequestMerge",
  "ReviewThreadReply",
  "ReviewThreadResolution",
  "ValidationResult",
]);
const expectedVersionThree = new Set([
  "MergeReadiness",
  "PreCommitGate",
  "PreMergeGate",
]);
const allowedTypes = new Set([
  "string",
  "integer",
  "boolean",
  "enum",
  "object",
  "list",
  "scalar",
  "null",
]);

let schemas: SchemaDocument[] = [];

const walk = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      paths.push(...(await walk(path)));
    } else if (entry.isFile()) {
      paths.push(path);
    }
  }
  return paths.sort();
};

const markdownFiles = async (): Promise<string[]> =>
  (await walk(pluginRoot)).filter((path) => path.endsWith(".md"));

const schemaLinks = (source: string): string[] =>
  [...source.matchAll(/shared\/schemas\/([A-Za-z0-9_-]+\.yaml)/g)].map(
    (match) => match[1]!,
  );

const collectFieldProblems = (
  field: FieldDefinition,
  path: string,
): string[] => {
  const problems: string[] = [];
  const types = splitType(field.type);
  const nonNullableTypes = types.filter((type) => type !== "null");
  if (nonNullableTypes.length === 0) {
    problems.push(`${path} has no concrete type`);
  }
  for (const type of types) {
    if (!allowedTypes.has(type)) {
      problems.push(`${path} has unsupported type ${type}`);
    }
  }
  if (types.includes("enum") && (!field.values || field.values.length === 0)) {
    problems.push(`${path} enum has no values`);
  }
  if (types.includes("list") && field.items === undefined) {
    // Some contracts intentionally use an untyped list for opaque platform
    // values or map-like data. Deeply typed lists are checked recursively.
  }
  if (types.includes("object") && field.fields === undefined) {
    // Nested handoffs may intentionally expose only their required identity
    // fields and rely on the referenced contract for the complete shape.
  }
  if (field.fields !== undefined) {
    for (const requiredName of field.required ?? []) {
      if (!(requiredName in field.fields)) {
        problems.push(`${path}.required references missing field ${requiredName}`);
      }
    }
  }
  for (const [name, child] of Object.entries(field.fields ?? {})) {
    problems.push(...collectFieldProblems(child, `${path}.fields.${name}`));
  }
  if (typeof field.items === "object") {
    problems.push(...collectFieldProblems(field.items, `${path}.items`));
  }
  return problems;
};

describe("shared contract schema inventory", () => {
  beforeAll(async () => {
    schemas = await readAllSchemas(schemaDirectory);
  });

  it("parses every YAML contract and keeps the filename identity stable", async () => {
    const paths = await listSchemaPaths(schemaDirectory);

    expect(paths).toHaveLength(84);
    expect(schemas).toHaveLength(84);
    for (const schema of schemas) {
      expect(schema.schema).toBe(basename(schema.path, ".yaml"));
      expect(schema.description.trim()).not.toBe("");
      expect(Number.isInteger(schema.version)).toBe(true);
      expect(schema.version).toBeGreaterThan(0);
    }
  });

  it("keeps versioned contracts limited to the documented breaking contracts", () => {
    const versionTwo = new Set(
      schemas
        .filter((schema) => schema.version === 2)
        .map((schema) => schema.schema),
    );
    expect(versionTwo).toEqual(expectedVersionTwo);
    const versionThree = new Set(
      schemas
        .filter((schema) => schema.version === 3)
        .map((schema) => schema.schema),
    );
    expect(versionThree).toEqual(expectedVersionThree);
    expect(
      schemas.filter(
        (schema) =>
          schema.version !== 1 && schema.version !== 2 && schema.version !== 3,
      ),
    ).toHaveLength(0);
  });

  it("keeps every required field and nested field definition resolvable", () => {
    const problems: string[] = [];
    for (const schema of schemas) {
      const names = Object.keys(schema.fields);
      const duplicates = names.filter(
        (name, index) => names.indexOf(name) !== index,
      );
      if (duplicates.length > 0) {
        problems.push(`${schema.schema} has duplicate fields: ${duplicates}`);
      }
      for (const requiredName of schema.required) {
        if (!(requiredName in schema.fields)) {
          problems.push(
            `${schema.schema}.required references missing field ${requiredName}`,
          );
        }
      }
      for (const [name, field] of Object.entries(schema.fields)) {
        problems.push(...collectFieldProblems(field, `${schema.schema}.${name}`));
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps the README inventory aligned with the YAML files", async () => {
    const source = await readFile(join(schemaDirectory, "README.md"), "utf8");
    const entries = [
      ...source.matchAll(/^\| `([^`]+)` \|/gm),
    ].map((match) => match[1]!);
    const names = schemas.map((schema) => schema.schema).sort();

    expect(entries).toHaveLength(84);
    expect(new Set(entries).size).toBe(entries.length);
    expect([...entries].sort()).toEqual(names);
  });

  it("keeps all Markdown schema references local and resolvable", async () => {
    const existing = new Set(
      schemas.map((schema) => `${schema.schema}.yaml`),
    );
    const problems: string[] = [];
    for (const path of await markdownFiles()) {
      const source = await readFile(path, "utf8");
      for (const reference of schemaLinks(source)) {
        if (!existing.has(reference)) {
          problems.push(`${path} references missing ${reference}`);
        }
      }
      if (
        /(?:plugins\/|\\.\\.\/)(?:productivity|self-learning)(?:\/|\\b)/i.test(
          source,
        )
      ) {
        problems.push(`${path} references a different plugin`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("does not retain the removed screenshot-capture capability", async () => {
    const textPaths = (await walk(pluginRoot)).filter((path) =>
      /\.(json|md|mdc|mjs|mts|ts|yaml|yml)$/.test(path),
    );
    const matches: string[] = [];
    for (const path of textPaths) {
      const source = await readFile(path, "utf8");
      if (source.includes("capture-ui-screenshots")) matches.push(path);
    }
    expect(matches).toEqual([]);
  });

  it("keeps ImplementationContext outside the shared-contract inventory", async () => {
    const schemaNames = schemas.map((schema) => schema.schema);
    expect(schemaNames).not.toContain("ImplementationContext");
    expect(await listSchemaPaths(schemaDirectory)).not.toContain(
      join(schemaDirectory, "ImplementationContext.yaml"),
    );

    const source = await readFile(
      join(pluginRoot, "skills", "build-feedback-resolution-plan", "SKILL.md"),
      "utf8",
    );
    expect(source).toContain("ImplementationContext");
    expect(source).toContain("not a schema");
  });
});
