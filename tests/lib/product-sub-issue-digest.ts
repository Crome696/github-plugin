import { createHash } from "node:crypto";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordAt = (value: unknown): RecordValue =>
  isRecord(value) ? value : {};

const arrayAt = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const stringAt = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const numberAt = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const canonicalize = (value: unknown): JsonValue => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    return null;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  ) as { [key: string]: JsonValue };
};

const compareUnitIds = (left: unknown, right: unknown): number => {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
};

const canonicalDraftRecord = (draftValue: unknown): RecordValue => {
  const draft = recordAt(draftValue);
  const sections = recordAt(draft.sections);
  const parentReference = recordAt(sections.parent_reference);
  const dependencies = recordAt(sections.dependencies);
  const labels = recordAt(draft.labels);
  return {
    unit_id: stringAt(draft.unit_id),
    title: stringAt(draft.title),
    body: stringAt(draft.body),
    labels: {
      add: arrayAt(labels.add),
      remove: arrayAt(labels.remove),
      preserve: arrayAt(labels.preserve),
    },
    parent_relationship: {
      repository: stringAt(parentReference.repository),
      number: numberAt(parentReference.number),
      url: stringAt(parentReference.url),
      relationship: stringAt(parentReference.relationship),
    },
    hard_dependencies: {
      predecessors: arrayAt(dependencies.hard_predecessors),
      successors: arrayAt(dependencies.hard_successors),
    },
    priority: sections.priority ?? null,
    traceability: sections.traceability ?? null,
  };
};

/**
 * Return the exact publishable ProductSubIssueDrafts v2 payload selected by
 * canonicalization version 1. Source diagnostic metadata and lifecycle or
 * approval fields are intentionally not copied here.
 */
export const canonicalProductSubIssuePayload = (
  payload: RecordValue,
): RecordValue => {
  const source = recordAt(payload.source);
  const drafts = arrayAt(payload.drafts)
    .filter(isRecord)
    .sort((left, right) => compareUnitIds(left.unit_id, right.unit_id))
    .map(canonicalDraftRecord);
  return {
    schema: "ProductSubIssueDrafts",
    version: 2,
    canonicalization_version: 1,
    repository: {
      repository: stringAt(source.repository),
      number: numberAt(source.number),
      url: stringAt(source.url),
    },
    drafts,
  };
};

export const canonicalProductSubIssueJson = (
  payload: RecordValue,
): string => JSON.stringify(canonicalize(canonicalProductSubIssuePayload(payload)));

export const productSubIssueDigest = (payload: RecordValue): string =>
  createHash("sha256")
    .update(canonicalProductSubIssueJson(payload), "utf8")
    .digest("hex");

export const canonicalUnitIds = (payload: RecordValue): string[] =>
  arrayAt(payload.drafts)
    .filter(isRecord)
    .map((draft) => String(draft.unit_id ?? ""))
    .sort(compareUnitIds);

export const canonicalPublishableFields = (
  draftValue: RecordValue,
): RecordValue => {
  const draft = canonicalDraftRecord(draftValue);
  return {
    title: draft.title,
    body: draft.body,
    labels: draft.labels,
  };
};
