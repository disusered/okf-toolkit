import type { Change } from "okf-contracts";

import { byCodePoint, canonicalizeOperationPath } from "./paths.js";

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(input: Readonly<Record<string, unknown>>, expected: readonly string[]): void {
  const actual = Object.keys(input).sort(byCodePoint);
  const wanted = [...expected].sort(byCodePoint);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`change must contain exactly: ${wanted.join(", ")}`);
  }
}

function stringField(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new Error(`change.${key} must be a string`);
  }
  return value;
}

function revisionField(input: Readonly<Record<string, unknown>>): string {
  const revision = stringField(input, "expected_revision");
  if (revision.length === 0) {
    throw new Error("change.expected_revision must be non-empty");
  }
  return revision;
}

/** Strictly parse and path-confine one versioned change without rewriting its storage keys. */
export function parseChange(value: unknown): Change {
  if (!mapping(value)) {
    throw new Error("change must be an object");
  }
  switch (value["operation"]) {
    case "create":
      exactKeys(value, ["operation", "path", "content"]);
      return {
        operation: "create",
        path: canonicalizeOperationPath(stringField(value, "path")),
        content: stringField(value, "content"),
      };
    case "update":
      exactKeys(value, ["operation", "path", "content", "expected_revision"]);
      return {
        operation: "update",
        path: canonicalizeOperationPath(stringField(value, "path")),
        content: stringField(value, "content"),
        expected_revision: revisionField(value),
      };
    case "delete":
      exactKeys(value, ["operation", "path", "expected_revision"]);
      return {
        operation: "delete",
        path: canonicalizeOperationPath(stringField(value, "path")),
        expected_revision: revisionField(value),
      };
    case "move":
      exactKeys(value, ["operation", "from_path", "to_path", "expected_revision"]);
      return {
        operation: "move",
        from_path: canonicalizeOperationPath(stringField(value, "from_path")),
        to_path: canonicalizeOperationPath(stringField(value, "to_path")),
        expected_revision: revisionField(value),
      };
    default:
      throw new Error("change.operation must be create, update, delete, or move");
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (mapping(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(byCodePoint)
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

/** Recursively key-sorted JSON used as the shared preview-digest input. */
export function canonicalChangeJson(value: unknown): string {
  return JSON.stringify(sortJson(parseChange(value)));
}
