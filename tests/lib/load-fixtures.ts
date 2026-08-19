import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { load } from "js-yaml";
import {
  FieldDefinition,
  Scalar,
  SchemaDocument,
  hasType,
  isNullable,
  splitType,
} from "./parse-schema.js";

export const fixtureDirectory = join(
  process.cwd(),
  "tests",
  "fixtures",
  "valid",
);

const firstNonNull = (values: Scalar[] | undefined): Scalar => {
  const value = values?.find((candidate) => candidate !== null);
  return value === undefined ? null : value;
};

const stringForFormat = (format: string | undefined, fieldName: string): string => {
  const normalized = format?.toLowerCase();
  if (normalized?.includes("owner/repository")) {
    return "octo-org/widgets";
  }
  if (normalized === "uri") {
    return "https://github.com/octo-org/widgets";
  }
  if (normalized?.includes("commit sha")) {
    return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  }
  if (normalized?.includes("absolute-path")) {
    return "C:/workspace/github";
  }
  if (normalized?.includes("iso 8601") || normalized?.includes("iso-8601")) {
    return "2026-01-01T00:00:00.000Z";
  }
  if (/^[A-Z]-\d{3}/.test(format ?? "")) {
    return format ?? "F-001";
  }
  if (normalized?.includes("ref")) {
    return "refs/heads/feature";
  }
  return `${fieldName || "value"}-value`;
};

const minimalValue = (
  field: FieldDefinition,
  fieldName: string,
  forceObject = false,
): unknown => {
  if (field.const !== undefined) {
    return field.const;
  }
  const types = splitType(field.type);
  if (types.includes("enum")) {
    return firstNonNull(field.values);
  }
  if (types.includes("object")) {
    if (!forceObject && isNullable(field) && (field.required?.length ?? 0) === 0) {
      return null;
    }
    const object: Record<string, unknown> = {};
    for (const requiredName of field.required ?? []) {
      const child = field.fields?.[requiredName];
      object[requiredName] = child
        ? minimalValue(child, requiredName, true)
        : null;
    }
    return object;
  }
  if (types.includes("list")) {
    return [];
  }
  if (types.includes("boolean")) {
    return false;
  }
  if (types.includes("integer")) {
    return Math.max(field.minimum ?? 0, 1);
  }
  if (types.includes("string")) {
    return stringForFormat(field.format, fieldName);
  }
  if (types.includes("scalar")) {
    return "value";
  }
  return null;
};

export const buildMinimalPayload = (
  schema: SchemaDocument,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    schema: schema.schema,
    version: schema.version,
  };

  for (const requiredName of schema.required) {
    const field = schema.fields[requiredName];
    if (field) {
      payload[requiredName] = minimalValue(field, requiredName, true);
    }
  }

  const optionalStatus = schema.fields.status;
  if (
    optionalStatus &&
    !Object.prototype.hasOwnProperty.call(payload, "status")
  ) {
    payload.status = minimalValue(optionalStatus, "status", true);
  }

  return payload;
};

export const fixturePath = (schema: SchemaDocument): string =>
  join(fixtureDirectory, `${schema.schema}.yaml`);

export const loadFixture = async (
  schema: SchemaDocument,
): Promise<unknown> => {
  const source = await readFile(fixturePath(schema), "utf8");
  return load(source);
};
