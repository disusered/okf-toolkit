import type {
  AnalyzedDocument,
  BundleAnalysis,
  Diagnostic,
  DiagnosticGroups,
  RawBundleDocument,
} from "okf-contracts";
import { INSPECT_SCHEMA } from "okf-contracts";

import { coreDiagnostics, documentKind } from "./conformance.js";
import { compareDiagnostics, diagnostic } from "./diagnostics.js";
import { deriveDocumentFields, validDate } from "./derive.js";
import { parseFrontmatter } from "./frontmatter.js";
import { buildGraph } from "./graph.js";
import { extractMarkdownLinks } from "./links.js";
import { byCodePoint } from "./paths.js";
import type {
  AnalyzeBundleOptions,
  ParsedDocumentResult,
  ParseDocumentOptions,
  ValidationProfile,
  ValidationProfileContext,
} from "./types.js";

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnosticSeverity(value: unknown): value is Diagnostic["severity"] {
  return value === "error" || value === "warning" || value === "info";
}

function profileBoundaryError(profileId: string, detail: string): TypeError {
  return new TypeError(`profile ${JSON.stringify(profileId)} returned an invalid diagnostic: ${detail}`);
}

function sanitizePosition(value: unknown): NonNullable<Diagnostic["range"]>["start"] | null {
  if (!mapping(value)) {
    return null;
  }
  const line = value["line"];
  const column = value["column"];
  const offset = value["offset"];
  if (
    typeof line !== "number"
    || !Number.isInteger(line)
    || line < 1
    || typeof column !== "number"
    || !Number.isInteger(column)
    || column < 1
    || typeof offset !== "number"
    || !Number.isInteger(offset)
    || offset < 0
  ) {
    return null;
  }
  return { line, column, offset };
}

function sanitizeRange(value: unknown): NonNullable<Diagnostic["range"]> | null {
  if (!mapping(value)) {
    return null;
  }
  const start = sanitizePosition(value["start"]);
  const end = sanitizePosition(value["end"]);
  return start === null || end === null ? null : { start, end };
}

function runProfile(
  profile: ValidationProfile | undefined,
  context: ValidationProfileContext,
): readonly Diagnostic[] {
  if (profile === undefined) {
    return [];
  }
  if (typeof profile.id !== "string") {
    throw new TypeError("validation profile id must be a string");
  }
  if (typeof profile.validate !== "function") {
    throw new TypeError(`profile ${JSON.stringify(profile.id)} validate must be a function`);
  }
  const emitted: unknown = profile.validate(context);
  if (!Array.isArray(emitted)) {
    throw profileBoundaryError(profile.id, "validate(context) must return an array");
  }

  return emitted.map((value, index): Diagnostic => {
    if (!mapping(value)) {
      throw profileBoundaryError(profile.id, `entry ${index} must be a mapping`);
    }
    const code = value["code"];
    const path = value["path"];
    const message = value["message"];
    if (typeof code !== "string") {
      throw profileBoundaryError(profile.id, `entry ${index}.code must be a string`);
    }
    if (typeof path !== "string") {
      throw profileBoundaryError(profile.id, `entry ${index}.path must be a string`);
    }
    if (typeof message !== "string") {
      throw profileBoundaryError(profile.id, `entry ${index}.message must be a string`);
    }
    const severity = value["severity"] ?? "error";
    if (!diagnosticSeverity(severity)) {
      throw profileBoundaryError(profile.id, `entry ${index}.severity must be error, warning, or info`);
    }
    const range = value["range"];
    const sanitizedRange = range === undefined ? undefined : sanitizeRange(range);
    if (sanitizedRange === null) {
      throw profileBoundaryError(profile.id, `entry ${index}.range must be an okf.inspect.v1 source range`);
    }
    return {
      code,
      family: "profile",
      severity,
      path,
      message,
      ...(sanitizedRange === undefined ? {} : { range: sanitizedRange }),
      profile: profile.id,
    };
  }).sort(compareDiagnostics);
}

function linkGuidance(document: AnalyzedDocument): readonly Diagnostic[] {
  const result: Diagnostic[] = [];
  for (const link of document.links) {
    if (link.kind === "escape") {
      result.push(
        diagnostic(
          "guidance",
          "warning",
          "guidance.link.escape",
          document.path,
          `Markdown link escapes the bundle: ${link.href}`,
          link.range ?? undefined,
        ),
      );
    } else if (link.kind === "invalid") {
      result.push(
        diagnostic(
          "guidance",
          "warning",
          "guidance.link.invalid",
          document.path,
          `Markdown link has an invalid destination: ${link.href}`,
          link.range ?? undefined,
        ),
      );
    } else if (
      link.kind === "internal" &&
      link.exists === false &&
      link.resolvedPath?.toLowerCase().endsWith(".md")
    ) {
      result.push(
        diagnostic(
          "guidance",
          "warning",
          "guidance.link.broken",
          document.path,
          `Markdown link does not resolve: ${link.href}`,
          link.range ?? undefined,
        ),
      );
    }
  }
  return result;
}

export function parseBundleDocument(
  raw: RawBundleDocument,
  options: ParseDocumentOptions = {},
): ParsedDocumentResult {
  const parsed = parseFrontmatter(raw.content);
  const kind = documentKind(raw.path);
  const metadata = parsed.snapshot?.metadata ?? {};
  const knownPaths = options.knownPaths ?? new Set([raw.path]);
  const today = options.today ?? null;
  const links = extractMarkdownLinks(parsed.body, {
    sourcePath: raw.path,
    knownPaths,
    lineOffset: parsed.bodyStartLine - 1,
    offsetOffset: raw.content.length - parsed.body.length,
  });
  const { derived, guidance } = deriveDocumentFields(
    metadata,
    parsed.body,
    raw.path,
    knownPaths,
    today,
  );
  const document: AnalyzedDocument = {
    path: raw.path,
    id: kind === "concept" ? raw.path.replace(/\.md$/i, "") : null,
    kind,
    revision: raw.revision ?? null,
    content: raw.content,
    body: parsed.body,
    bodyStartLine: parsed.bodyStartLine,
    frontmatter: parsed.snapshot,
    metadata,
    links,
    derived,
  };
  return {
    document,
    diagnostics: {
      core: [...coreDiagnostics(raw.path, kind, parsed)].sort(compareDiagnostics),
      guidance: [...guidance, ...linkGuidance(document)].sort(compareDiagnostics),
    },
  };
}

function declaredVersion(documents: readonly AnalyzedDocument[]): string | null {
  const root = documents.find((document) => document.path === "index.md");
  const value = root?.metadata["okf_version"];
  return typeof value === "string" ? value : null;
}

function counts(documents: readonly AnalyzedDocument[], diagnostics: readonly Diagnostic[]) {
  return {
    documents: documents.length,
    concepts: documents.filter((document) => document.kind === "concept").length,
    indexes: documents.filter((document) => document.kind === "index").length,
    logs: documents.filter((document) => document.kind === "log").length,
    errors: diagnostics.filter((entry) => entry.severity === "error").length,
    warnings: diagnostics.filter((entry) => entry.severity === "warning").length,
  };
}

/** Analyze one isolated bundle from the supplied documents and options only. */
export function analyzeBundle(
  rawDocuments: readonly RawBundleDocument[],
  options: AnalyzeBundleOptions = {},
): BundleAnalysis {
  const ordered = [...rawDocuments].sort(
    (left, right) =>
      byCodePoint(left.path, right.path) ||
      byCodePoint(left.content, right.content) ||
      byCodePoint(left.revision ?? "", right.revision ?? ""),
  );
  const knownPaths = new Set(ordered.map((document) => document.path));
  const core: Diagnostic[] = [];
  const guidance: Diagnostic[] = [];
  const documents = ordered.map((raw) => {
    const parsed = parseBundleDocument(raw, { knownPaths, ...(options.today ? { today: options.today } : {}) });
    core.push(...parsed.diagnostics.core);
    guidance.push(...parsed.diagnostics.guidance);
    return parsed.document;
  });

  const occurrences = new Map<string, number>();
  for (const raw of ordered) occurrences.set(raw.path, (occurrences.get(raw.path) ?? 0) + 1);
  for (const [path, amount] of occurrences) {
    if (amount > 1) {
      core.push(
        diagnostic(
          "core",
          "error",
          "core.bundle.path.duplicate",
          path,
          `bundle contains ${amount} documents at the same path`,
        ),
      );
    }
  }
  if (options.today !== undefined && !validDate(options.today)) {
    guidance.push(
      diagnostic(
        "guidance",
        "warning",
        "guidance.analysis.today",
        ".",
        "today should be a deterministic YYYY-MM-DD date",
      ),
    );
  }

  const okfVersion = declaredVersion(documents);
  const rootVersion = documents.find((document) => document.path === "index.md")?.metadata["okf_version"];
  if (rootVersion !== undefined && typeof rootVersion !== "string") {
    guidance.push(
      diagnostic(
        "guidance",
        "warning",
        "guidance.okf-version.type",
        "index.md",
        "okf_version should be a string",
      ),
    );
  } else if (okfVersion !== null && okfVersion !== "0.2") {
    guidance.push(
      diagnostic(
        "guidance",
        "warning",
        "guidance.okf-version.unknown",
        "index.md",
        `consumer targets OKF 0.2; attempting best-effort consumption of ${okfVersion}`,
      ),
    );
  }

  const graph = buildGraph(documents);
  const baseGroups: Pick<DiagnosticGroups, "core" | "guidance"> = {
    core: core.sort(compareDiagnostics),
    guidance: guidance.sort(compareDiagnostics),
  };
  const profileContext: ValidationProfileContext = {
    okfVersion,
    documents,
    graph,
    diagnostics: baseGroups,
    today: options.today ?? null,
  };
  const profile = runProfile(options.profile, profileContext);
  const all = [...baseGroups.core, ...baseGroups.guidance, ...profile];

  return {
    schema: INSPECT_SCHEMA,
    okfVersion,
    documents,
    graph,
    diagnostics: { ...baseGroups, profile },
    summary: counts(documents, all),
  };
}
