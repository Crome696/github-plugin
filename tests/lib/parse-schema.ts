import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { load } from "js-yaml";

export type Scalar = string | number | boolean | null;
export type TypeName =
  | "string"
  | "integer"
  | "boolean"
  | "enum"
  | "object"
  | "list";

export interface FieldDefinition {
  type?: string;
  required?: string[];
  fields?: Record<string, FieldDefinition>;
  values?: Scalar[];
  items?: string | FieldDefinition;
  format?: string;
  constraints?: string[];
  minimum?: number;
  const?: Scalar;
  value?: Scalar;
  description?: string;
}

export interface SchemaDocument {
  schema: string;
  version: number;
  description: string;
  required: string[];
  fields: Record<string, FieldDefinition>;
  invariants: string[];
  path: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
};

const asStringList = (value: unknown, path: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must be a list of strings`);
  }
  return value as string[];
};

const asScalarList = (value: unknown, path: string): Scalar[] => {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        item !== null &&
        typeof item !== "string" &&
        typeof item !== "number" &&
        typeof item !== "boolean",
    )
  ) {
    throw new Error(`${path} must be a list of scalar values`);
  }
  return value as Scalar[];
};

const parseField = (value: unknown, path: string): FieldDefinition => {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const field: FieldDefinition = {};
  if (value.type !== undefined) {
    field.type = asString(value.type, `${path}.type`);
  }
  if (value.required !== undefined) {
    field.required = asStringList(value.required, `${path}.required`);
  }
  if (value.fields !== undefined) {
    if (!isRecord(value.fields)) {
      throw new Error(`${path}.fields must be an object`);
    }
    field.fields = Object.fromEntries(
      Object.entries(value.fields).map(([name, definition]) => [
        name,
        parseField(definition, `${path}.fields.${name}`),
      ]),
    );
  }
  if (value.values !== undefined) {
    field.values = asScalarList(value.values, `${path}.values`);
  }
  if (value.items !== undefined) {
    field.items =
      typeof value.items === "string"
        ? value.items
        : parseField(value.items, `${path}.items`);
  }
  if (value.format !== undefined) {
    field.format = asString(value.format, `${path}.format`);
  }
  if (value.constraints !== undefined) {
    field.constraints = asStringList(value.constraints, `${path}.constraints`);
  }
  if (value.minimum !== undefined) {
    if (typeof value.minimum !== "number") {
      throw new Error(`${path}.minimum must be a number`);
    }
    field.minimum = value.minimum;
  }
  if (value.const !== undefined) {
    field.const = value.const as Scalar;
  }
  if (value.value !== undefined) {
    field.value = value.value as Scalar;
  }
  if (value.description !== undefined && typeof value.description === "string") {
    field.description = value.description;
  }
  return field;
};

export const parseSchema = (raw: unknown, path: string): SchemaDocument => {
  if (!isRecord(raw)) {
    throw new Error(`${path} must contain a YAML object`);
  }
  const schema = asString(raw.schema, `${path}.schema`);
  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error(`${path}.version must be a positive integer`);
  }
  const description = asString(raw.description, `${path}.description`);
  const required = asStringList(raw.required ?? [], `${path}.required`);
  if (!isRecord(raw.fields)) {
    throw new Error(`${path}.fields must be an object`);
  }
  const fields = Object.fromEntries(
    Object.entries(raw.fields).map(([name, definition]) => [
      name,
      parseField(definition, `${path}.fields.${name}`),
    ]),
  );
  const invariants =
    raw.invariants === undefined
      ? []
      : asStringList(raw.invariants, `${path}.invariants`);

  return {
    schema,
    version,
    description,
    required,
    fields,
    invariants,
    path,
  };
};

export const readSchema = async (path: string): Promise<SchemaDocument> => {
  const source = await readFile(path, "utf8");
  return parseSchema(load(source), path);
};

export const listSchemaPaths = async (schemaDirectory: string): Promise<string[]> =>
  (
    await readdir(schemaDirectory, { withFileTypes: true })
  )
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => join(schemaDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));

export const readAllSchemas = async (
  schemaDirectory: string,
): Promise<SchemaDocument[]> =>
  Promise.all((await listSchemaPaths(schemaDirectory)).map(readSchema));

export const schemaNameFromPath = (path: string): string =>
  basename(path, ".yaml");

export const repositoryRootFrom = (path: string): string =>
  resolve(path, "..", "..", "..", "..");

export const splitType = (type: string | undefined): string[] =>
  (type ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

export const hasType = (field: FieldDefinition, type: TypeName): boolean =>
  splitType(field.type).includes(type);

export const isNullable = (field: FieldDefinition): boolean =>
  splitType(field.type).includes("null");
