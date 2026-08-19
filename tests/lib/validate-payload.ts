import {
  FieldDefinition,
  SchemaDocument,
  Scalar,
  hasType,
  isNullable,
  splitType,
} from "./parse-schema.js";

export interface ValidationIssue {
  path: string;
  code:
    | "invalid_type"
    | "missing_required"
    | "invalid_enum"
    | "invalid_minimum"
    | "invalid_const"
    | "invalid_schema"
    | "invalid_version"
    | "invalid_shape";
  message: string;
}

export interface PayloadValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface PayloadValidationOptions {
  requireEnvelope?: boolean;
  rejectUnknownFields?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const equalScalar = (left: unknown, right: Scalar): boolean =>
  left === right;

const primitiveTypeMatches = (value: unknown, type: string): boolean => {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "scalar":
      return (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      );
    default:
      return true;
  }
};

const validateField = (
  field: FieldDefinition,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void => {
  const types = splitType(field.type);
  if (value === null) {
    if (isNullable(field) || field.values?.includes(null)) {
      return;
    }
    issues.push({
      path,
      code: "invalid_type",
      message: `Expected ${field.type ?? "a value"}, received null`,
    });
    return;
  }

  if (field.const !== undefined && !equalScalar(value, field.const)) {
    issues.push({
      path,
      code: "invalid_const",
      message: `Expected the constant value ${String(field.const)}`,
    });
  }

  if (types.includes("enum")) {
    if (!field.values?.some((candidate) => equalScalar(value, candidate))) {
      issues.push({
        path,
        code: "invalid_enum",
        message: `Value is not one of: ${(field.values ?? [])
          .map(String)
          .join(", ")}`,
      });
    }
    return;
  }

  if (types.includes("object")) {
    if (!isRecord(value)) {
      issues.push({
        path,
        code: "invalid_type",
        message: "Expected an object",
      });
      return;
    }
    for (const requiredName of field.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, requiredName)) {
        issues.push({
          path: `${path}.${requiredName}`,
          code: "missing_required",
          message: "Required nested field is missing",
        });
      }
    }
    for (const [name, definition] of Object.entries(field.fields ?? {})) {
      if (Object.prototype.hasOwnProperty.call(value, name)) {
        validateField(definition, value[name], `${path}.${name}`, issues);
      }
    }
    if (field.minimum !== undefined) {
      issues.push({
        path,
        code: "invalid_shape",
        message: "Object fields cannot declare a numeric minimum",
      });
    }
    return;
  }

  if (types.includes("list")) {
    if (!Array.isArray(value)) {
      issues.push({
        path,
        code: "invalid_type",
        message: "Expected a list",
      });
      return;
    }
    if (field.items !== undefined) {
      const itemField: FieldDefinition =
        typeof field.items === "string"
          ? { type: field.items }
          : field.items;
      value.forEach((item, index) =>
        validateField(itemField, item, `${path}[${index}]`, issues),
      );
    }
    return;
  }

  const primitiveTypes = types.filter((type) => type !== "null");
  if (
    primitiveTypes.length > 0 &&
    !primitiveTypes.some((type) => primitiveTypeMatches(value, type))
  ) {
    issues.push({
      path,
      code: "invalid_type",
      message: `Expected ${primitiveTypes.join(" or ")}`,
    });
    return;
  }
  if (
    field.minimum !== undefined &&
    typeof value === "number" &&
    value < field.minimum
  ) {
    issues.push({
      path,
      code: "invalid_minimum",
      message: `Value must be at least ${field.minimum}`,
    });
  }
};

export const validatePayload = (
  schema: SchemaDocument,
  payload: unknown,
  options: PayloadValidationOptions = {},
): PayloadValidationResult => {
  const issues: ValidationIssue[] = [];
  const requireEnvelope = options.requireEnvelope ?? true;

  if (!isRecord(payload)) {
    return {
      valid: false,
      issues: [
        {
          path: "$",
          code: "invalid_shape",
          message: "Payload must be an object",
        },
      ],
    };
  }

  if (requireEnvelope) {
    if (payload.schema !== schema.schema) {
      issues.push({
        path: "$.schema",
        code: "invalid_schema",
        message: `Expected schema ${schema.schema}`,
      });
    }
    if (payload.version !== schema.version) {
      issues.push({
        path: "$.version",
        code: "invalid_version",
        message: `Expected contract version ${schema.version}`,
      });
    }
  }

  for (const requiredName of schema.required) {
    if (!Object.prototype.hasOwnProperty.call(payload, requiredName)) {
      issues.push({
        path: `$.${requiredName}`,
        code: "missing_required",
        message: "Required field is missing",
      });
    }
  }

  if (options.rejectUnknownFields) {
    const allowed = new Set(["schema", "version", ...Object.keys(schema.fields)]);
    for (const name of Object.keys(payload)) {
      if (!allowed.has(name)) {
        issues.push({
          path: `$.${name}`,
          code: "invalid_shape",
          message: "Field is not declared by the contract",
        });
      }
    }
  }

  for (const [name, definition] of Object.entries(schema.fields)) {
    if (Object.prototype.hasOwnProperty.call(payload, name)) {
      validateField(definition, payload[name], `$.${name}`, issues);
    }
  }

  return { valid: issues.length === 0, issues };
};

export const expectValid = (
  schema: SchemaDocument,
  payload: unknown,
  options?: PayloadValidationOptions,
): void => {
  const result = validatePayload(schema, payload, options);
  if (!result.valid) {
    throw new Error(
      `${schema.schema} payload is invalid:\n${result.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }
};
