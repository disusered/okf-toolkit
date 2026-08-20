import { parseDocument } from "yaml";

import type { FrontmatterSnapshot, JsonObject, JsonValue } from "okf-contracts";

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export interface FrontmatterParseResult {
  readonly snapshot: FrontmatterSnapshot | null;
  readonly body: string;
  readonly bodyStartLine: number;
  readonly error: string | null;
  readonly errorKind: "yaml" | "json" | null;
  readonly hadFrontmatter: boolean;
}

function plainMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonSafe(value: Record<string, unknown>, ancestors?: Set<object>): JsonObject;
function jsonSafe(value: unknown, ancestors?: Set<object>): JsonValue;
function jsonSafe(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("frontmatter numbers must be finite");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`frontmatter value is not JSON-safe: ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new Error("frontmatter contains a cyclic YAML alias");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => jsonSafe(entry, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("frontmatter contains a non-JSON YAML value");
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

/** Parse YAML 1.2 while retaining exact source bytes for lossless round-tripping. */
export function parseFrontmatter(content: string): FrontmatterParseResult {
  const match = FRONTMATTER.exec(content);
  if (!match) {
    return {
      snapshot: null,
      body: content,
      bodyStartLine: 1,
      error: null,
      errorKind: null,
      hadFrontmatter: false,
    };
  }

  const raw = match[0];
  const yaml = match[1] ?? "";
  const parsed = parseDocument(yaml, { keepSourceTokens: true, prettyErrors: false });
  if (parsed.errors.length > 0) {
    return {
      snapshot: null,
      body: content.slice(raw.length),
      bodyStartLine: 1 + (raw.match(/\n/g)?.length ?? 0),
      error: parsed.errors.map((error) => error.message).join("; "),
      errorKind: "yaml",
      hadFrontmatter: true,
    };
  }

  let value: unknown;
  try {
    value = parsed.toJS({ maxAliasCount: 100 });
  } catch (error) {
    return {
      snapshot: null,
      body: content.slice(raw.length),
      bodyStartLine: 1 + (raw.match(/\n/g)?.length ?? 0),
      error: error instanceof Error ? error.message : "YAML conversion failed",
      errorKind: "yaml",
      hadFrontmatter: true,
    };
  }
  if (!plainMapping(value)) {
    return {
      snapshot: null,
      body: content.slice(raw.length),
      bodyStartLine: 1 + (raw.match(/\n/g)?.length ?? 0),
      error: "frontmatter must be a YAML mapping",
      errorKind: "yaml",
      hadFrontmatter: true,
    };
  }

  let metadata: JsonObject;
  try {
    metadata = jsonSafe(value);
  } catch (error) {
    return {
      snapshot: null,
      body: content.slice(raw.length),
      bodyStartLine: 1 + (raw.match(/\n/g)?.length ?? 0),
      error: error instanceof Error ? error.message : "frontmatter is not JSON-safe",
      errorKind: "json",
      hadFrontmatter: true,
    };
  }

  return {
    snapshot: { raw, yaml, metadata },
    body: content.slice(raw.length),
    bodyStartLine: 1 + (raw.match(/\n/g)?.length ?? 0),
    error: null,
    errorKind: null,
    hadFrontmatter: true,
  };
}
