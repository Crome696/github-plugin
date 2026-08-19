import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  SchemaDocument,
  readAllSchemas,
} from "../lib/parse-schema.js";
import { loadFixture } from "../lib/load-fixtures.js";
import { validatePayload } from "../lib/validate-payload.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(testDirectory, "..", "..", "plugin");
const schemaDirectory = join(pluginRoot, "shared", "schemas");

let schemas: SchemaDocument[] = [];
let fixtures = new Map<string, unknown>();

const clone = <T>(value: T): T => structuredClone(value);

describe("shared contract payload validation", () => {
  beforeAll(async () => {
    schemas = await readAllSchemas(schemaDirectory);
    fixtures = new Map(
      await Promise.all(
        schemas.map(
          async (schema) =>
            [schema.schema, await loadFixture(schema)] as [string, unknown],
        ),
      ),
    );
  });

  it("accepts the complete minimal fixture for every contract", () => {
    for (const schema of schemas) {
      const result = validatePayload(schema, fixtures.get(schema.schema));
      expect(result.issues, schema.schema).toEqual([]);
      expect(result.valid, schema.schema).toBe(true);
    }
  });

  it("rejects every contract when each required field is omitted", () => {
    for (const schema of schemas) {
      for (const requiredName of schema.required) {
        const payload = clone(fixtures.get(schema.schema));
        delete (payload as Record<string, unknown>)[requiredName];

        const result = validatePayload(schema, payload);
        expect(result.valid, `${schema.schema}.${requiredName}`).toBe(false);
        expect(
          result.issues.some(
            (issue) =>
              issue.code === "missing_required" &&
              issue.path === `$.${requiredName}`,
          ),
          `${schema.schema}.${requiredName}`,
        ).toBe(true);
      }
    }
  });

  it("rejects every contract with an incompatible version", () => {
    for (const schema of schemas) {
      const payload = clone(fixtures.get(schema.schema)) as Record<string, unknown>;
      payload.version = schema.version + 1;

      const result = validatePayload(schema, payload);
      expect(result.valid, schema.schema).toBe(false);
      expect(result.issues, schema.schema).toContainEqual(
        expect.objectContaining({
          path: "$.version",
          code: "invalid_version",
        }),
      );
    }
  });

  it("rejects every contract with an incompatible schema envelope", () => {
    for (const schema of schemas) {
      const payload = clone(fixtures.get(schema.schema)) as Record<string, unknown>;
      payload.schema = `${schema.schema}Changed`;

      const result = validatePayload(schema, payload);
      expect(result.valid, schema.schema).toBe(false);
      expect(result.issues, schema.schema).toContainEqual(
        expect.objectContaining({
          path: "$.schema",
          code: "invalid_schema",
        }),
      );
    }
  });

  it("rejects every contract with an unknown status value", () => {
    for (const schema of schemas) {
      if (!schema.fields.status) continue;
      const payload = clone(fixtures.get(schema.schema)) as Record<string, unknown>;
      payload.status = "__unknown_status__";

      const result = validatePayload(schema, payload);
      expect(result.valid, schema.schema).toBe(false);
      expect(result.issues, schema.schema).toContainEqual(
        expect.objectContaining({
          path: "$.status",
          code: "invalid_enum",
        }),
      );
    }
  });

  it("keeps ReviewFinding.status optional while validating it when present", () => {
    const schema = schemas.find(
      (candidate) => candidate.schema === "ReviewFinding",
    )!;
    const payload = clone(fixtures.get("ReviewFinding")) as Record<string, unknown>;
    delete payload.status;
    expect(validatePayload(schema, payload).valid).toBe(true);

    payload.status = "__invalid_finding_status__";
    const result = validatePayload(schema, payload);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        path: "$.status",
        code: "invalid_enum",
      }),
    );
  });

  it("requires the schema/version envelope for every contract", () => {
    for (const schema of schemas) {
      const payload = clone(fixtures.get(schema.schema)) as Record<string, unknown>;
      delete payload.schema;
      delete payload.version;

      const result = validatePayload(schema, payload);
      expect(result.valid, schema.schema).toBe(false);
      expect(result.issues.map((issue) => issue.code), schema.schema).toEqual(
        expect.arrayContaining(["invalid_schema", "invalid_version"]),
      );
    }
  });
});
