import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dump, load } from "js-yaml";

const root = resolve(import.meta.dirname, "..", "..");
const schemaDirectory = join(root, "plugin", "shared", "schemas");
const fixtureDirectory = join(root, "tests", "fixtures", "valid");

const splitType = (type) =>
  (type ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

const isNullable = (field) => splitType(field.type).includes("null");

const stringForFormat = (format, fieldName) => {
  const normalized = format?.toLowerCase();
  if (normalized?.includes("owner/repository")) return "octo-org/widgets";
  if (normalized === "uri") return "https://github.com/octo-org/widgets";
  if (normalized?.includes("commit sha"))
    return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  if (normalized?.includes("absolute-path")) return "C:/workspace/github";
  if (normalized?.includes("iso 8601") || normalized?.includes("iso-8601"))
    return "2026-01-01T00:00:00.000Z";
  if (/^[A-Z]-\d{3}/.test(format ?? "")) return format;
  if (normalized?.includes("ref")) return "refs/heads/feature";
  return `${fieldName || "value"}-value`;
};

const minimalValue = (field, fieldName, forceObject = false) => {
  if (field.const !== undefined) return field.const;
  const types = splitType(field.type);
  if (types.includes("enum")) {
    return field.values?.find((value) => value !== null) ?? null;
  }
  if (types.includes("object")) {
    if (!forceObject && isNullable(field) && !(field.required?.length ?? 0))
      return null;
    const object = {};
    for (const requiredName of field.required ?? []) {
      const child = field.fields?.[requiredName];
      object[requiredName] = child
        ? minimalValue(child, requiredName, true)
        : null;
    }
    return object;
  }
  if (types.includes("list")) return [];
  if (types.includes("boolean")) return false;
  if (types.includes("integer")) return Math.max(field.minimum ?? 0, 1);
  if (types.includes("string"))
    return stringForFormat(field.format, fieldName);
  if (types.includes("scalar")) return "value";
  return null;
};

const lifecycleOperationFor = (schemaName) => {
  switch (schemaName) {
    case "PreCommitGate": return "pre-commit";
    case "PrePrCreateGate": return "pre-pr-create";
    case "PreReviewSubmitGate": return "pre-review-submit";
    case "PreRebaseGate": return "pre-rebase-start";
    case "PrePrReadyGate": return "pre-pr-ready";
    case "PreMergeGate": return "pre-merge";
    default: return "pre-commit";
  }
};

const lifecycleFixture = (operation) => ({
  schema: "GateLifecycle",
  version: 1,
  operation,
  nonce: "0123456789abcdef0123456789abcdef",
  state: "authority",
  authorizes: true,
  issued_at: "2026-01-01T00:00:00.000Z",
  expires_at: "2026-01-01T00:05:00.000Z",
  consumed_at: null,
  receipt_expires_at: null,
});

const buildPayload = (schema) => {
  if (schema.schema === "GateLifecycle") return lifecycleFixture("pre-commit");
  const payload = { schema: schema.schema, version: schema.version };
  for (const requiredName of schema.required ?? []) {
    const field = schema.fields?.[requiredName];
    if (requiredName === "lifecycle" && field?.fields?.run_id) {
      payload[requiredName] = minimalValue(field, requiredName, true);
    } else if (requiredName === "lifecycle") {
      payload[requiredName] = lifecycleFixture(lifecycleOperationFor(schema.schema));
    } else if (field) {
      payload[requiredName] = minimalValue(field, requiredName, true);
    }
  }
  if (schema.fields?.status && !Object.hasOwn(payload, "status")) {
    payload.status = minimalValue(schema.fields.status, "status", true);
  }
  if (
    schema.schema === "ReviewThreadResolution" &&
    payload.feedback_authorization &&
    typeof payload.feedback_authorization === "object"
  ) {
    payload.feedback_authorization.effect = "resolve";
  }
  return payload;
};

await mkdir(fixtureDirectory, { recursive: true });
const names = (await readdir(schemaDirectory))
  .filter((name) => name.endsWith(".yaml"))
  .sort((left, right) => left.localeCompare(right));

for (const name of names) {
  const schema = load(await readFile(join(schemaDirectory, name), "utf8"));
  const output = `${dump(buildPayload(schema), {
    lineWidth: 120,
    noCompatMode: true,
  })}`;
  await writeFile(join(fixtureDirectory, name), output, "utf8");
}
