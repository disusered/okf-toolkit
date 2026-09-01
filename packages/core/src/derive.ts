import type {
  AnalyzedDocument,
  AnalyzedSource,
  DerivedDocumentFields,
  Diagnostic,
  DocumentExtensions,
  TrustTier,
  UsageWindow,
} from "okf-contracts";

import { diagnostic } from "./diagnostics.js";
import { markdownHeadings } from "./markdown.js";
import { resolveWithinBundle } from "./paths.js";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const ACTOR = /^(?:human:[^\s/:]+|process:[^\s/:]+|[^\s/:]+\/[^\s/:]+)$/;
const VALID_STATUSES = new Set(["draft", "stable", "deprecated"]);
/**
 * Tags that mark a page as perishable, so it should say when it goes stale. Edit this set to
 * match what a bundle actually tags; it only catches pages someone remembered to tag.
 */
const PERISHABLE_TAGS: ReadonlySet<string> = new Set([
  "pricing",
  "vendor-limits",
  "product-version",
  "agreement",
  "engagement-terms",
]);
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validRecordedAt(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  if (validDate(value)) {
    return true;
  }
  const match = DATETIME.exec(value);
  if (!match || !validDate(match[1]!)) {
    return false;
  }
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
  const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);
  return hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59;
}

function validActor(value: unknown): boolean {
  return typeof value === "string" && ACTOR.test(value);
}

function trustTier(metadata: Readonly<Record<string, unknown>>): TrustTier {
  const value = metadata["verified"];
  const entries = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  let machine = false;
  for (const entry of entries) {
    if (!mapping(entry)) {
      continue;
    }
    const actor = nonempty(entry["by"]);
    if (actor?.startsWith("human:")) {
      return "human-reviewed";
    }
    if (actor) {
      machine = true;
    }
  }
  return machine ? "machine-confirmed" : "unverified";
}

/** The `sources` entries `sourceFields` keeps; anything else never reaches `derived.sources`. */
function isUsableSourceEntry(entry: unknown): entry is Record<string, unknown> {
  return mapping(entry) && nonempty(entry["resource"]) !== null;
}

function sourceFields(
  value: unknown,
  path: string,
  knownPaths: ReadonlySet<string>,
  guidance: Diagnostic[],
): readonly AnalyzedSource[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    guidance.push(diagnostic("guidance", "warning", "guidance.sources.type", path, "sources should be a list"));
    return [];
  }

  const result: AnalyzedSource[] = [];
  value.forEach((entry, index) => {
    if (!mapping(entry)) {
      guidance.push(
        diagnostic("guidance", "warning", "guidance.source.mapping", path, `sources[${index}] should be a mapping`),
      );
      return;
    }
    const resource = nonempty(entry["resource"]);
    if (!resource) {
      guidance.push(
        diagnostic(
          "guidance",
          "warning",
          "guidance.source.resource",
          path,
          `sources[${index}].resource should be a non-empty string`,
        ),
      );
      return;
    }
    checkUsageWindow(
      entry["usage_window"],
      path,
      `sources[${index}].usage_window`,
      "guidance.source.usage-window",
      guidance,
    );

    let resolvedPath: string | null = null;
    let exists: boolean | null = null;
    const looksLocal =
      resource.startsWith("/") || resource.startsWith("./") || resource.startsWith("../") || resource.endsWith(".md");
    if (!SCHEME.test(resource) && looksLocal) {
      const resolution = resolveWithinBundle(path, resource);
      if (resolution.kind === "escape") {
        guidance.push(
          diagnostic(
            "guidance",
            "warning",
            "guidance.source.escape",
            path,
            `sources[${index}].resource escapes the bundle: ${resource}`,
          ),
        );
      } else if (resolution.kind === "internal") {
        resolvedPath = resolution.path;
        exists = knownPaths.has(resolution.path);
        if (!exists) {
          guidance.push(
            diagnostic(
              "guidance",
              "warning",
              "guidance.source.broken",
              path,
              `sources[${index}].resource does not resolve: ${resource}`,
            ),
          );
        }
      }
    }

    result.push({
      id: nonempty(entry["id"]),
      resource,
      title: nonempty(entry["title"]),
      author: nonempty(entry["author"]),
      usageCount: typeof entry["usage_count"] === "number" ? entry["usage_count"] : null,
      lastModified: nonempty(entry["last_modified"]),
      resolvedPath,
      exists,
    });
  });
  return result;
}

function checkTrustAndLifecycle(
  metadata: Readonly<Record<string, unknown>>,
  path: string,
  guidance: Diagnostic[],
): void {
  const generated = metadata["generated"];
  if (generated !== undefined) {
    if (!mapping(generated)) {
      guidance.push(diagnostic("guidance", "warning", "guidance.generated.type", path, "generated should be a mapping"));
    } else {
      if (!validActor(generated["by"])) {
        guidance.push(
          diagnostic(
            "guidance",
            "warning",
            "guidance.generated.by",
            path,
            "generated.by should use <producer>/<version>, human:<id>, or process:<id>",
          ),
        );
      }
      if (generated["at"] !== undefined && !validRecordedAt(generated["at"])) {
        guidance.push(
          diagnostic(
            "guidance",
            "warning",
            "guidance.generated.at",
            path,
            "generated.at should be an ISO 8601 datetime with an explicit offset; YYYY-MM-DD is accepted for compatibility",
          ),
        );
      }
    }
  }

  const verified = metadata["verified"];
  if (verified !== undefined) {
    const entries = Array.isArray(verified)
      ? verified
      : typeof verified === "object" && verified !== null
        ? [verified]
        : null;
    if (entries === null) {
      guidance.push(diagnostic("guidance", "warning", "guidance.verified.type", path, "verified should be a mapping or list"));
    } else {
      entries.forEach((entry, index) => {
        if (!mapping(entry)) {
          guidance.push(
            diagnostic("guidance", "warning", "guidance.verified.event", path, `verified[${index}] should be a mapping`),
          );
          return;
        }
        if (!validActor(entry["by"])) {
          guidance.push(
            diagnostic(
              "guidance",
              "warning",
              "guidance.verified.by",
              path,
              `verified[${index}].by should use <producer>/<version>, human:<id>, or process:<id>`,
            ),
          );
        }
        if (!validRecordedAt(entry["at"])) {
          guidance.push(
            diagnostic(
              "guidance",
              "warning",
              "guidance.verified.at",
              path,
              `verified[${index}].at should be an ISO 8601 datetime with an explicit offset; YYYY-MM-DD is accepted for compatibility`,
            ),
          );
        }
      });
    }
  }

  const status = metadata["status"];
  if (status !== undefined && (typeof status !== "string" || !VALID_STATUSES.has(status))) {
    guidance.push(
      diagnostic(
        "guidance",
        "warning",
        "guidance.status.value",
        path,
        "status should be draft, stable, or deprecated",
      ),
    );
  }
  const staleAfter = metadata["stale_after"];
  if (staleAfter !== undefined && (typeof staleAfter !== "string" || !validDate(staleAfter))) {
    guidance.push(
      diagnostic("guidance", "warning", "guidance.stale-after.date", path, "stale_after should be YYYY-MM-DD"),
    );
  }

  if (metadata["type"] === "Attested Computation" && !nonempty(metadata["runtime"])) {
    guidance.push(
      diagnostic(
        "guidance",
        "warning",
        "guidance.attested.runtime",
        path,
        "Attested Computation concepts should declare runtime",
      ),
    );
  }

  checkUsageWindow(metadata["usage_window"], path, "usage_window", "guidance.usage-window", guidance);
  checkAttestationContract(metadata, path, guidance);
}

/** `usage_window` frames every `usage_count`, so a malformed one makes those counts unreadable. */
function checkUsageWindow(
  value: unknown,
  path: string,
  label: string,
  code: string,
  guidance: Diagnostic[],
): void {
  if (value === undefined) {
    return;
  }
  if (!mapping(value)) {
    guidance.push(
      diagnostic("guidance", "warning", `${code}.type`, path, `${label} should be a mapping`),
    );
    return;
  }
  for (const key of ["from", "to"] as const) {
    const bound = value[key];
    if (bound !== undefined && (typeof bound !== "string" || !validDate(bound))) {
      guidance.push(
        diagnostic(
          "guidance",
          "warning",
          `${code}.${key}`,
          path,
          `${label}.${key} should be YYYY-MM-DD`,
        ),
      );
    }
  }
}

/**
 * The contract fields of an Attested Computation. `runtime` is checked above; these are the
 * fields that say how to run the computation and what evidence the attester inspects.
 */
function checkAttestationContract(
  metadata: Readonly<Record<string, unknown>>,
  path: string,
  guidance: Diagnostic[],
): void {
  const parameters = metadata["parameters"];
  if (parameters !== undefined) {
    if (!Array.isArray(parameters)) {
      guidance.push(
        diagnostic("guidance", "warning", "guidance.parameters.type", path, "parameters should be a list"),
      );
    } else {
      parameters.forEach((entry, index) => {
        if (!mapping(entry) || !nonempty(entry["name"])) {
          guidance.push(
            diagnostic(
              "guidance",
              "warning",
              "guidance.parameter.name",
              path,
              `parameters[${index}] should be a mapping with a non-empty name`,
            ),
          );
        }
      });
    }
  }

  const executor = metadata["executor"];
  if (executor !== undefined) {
    if (!mapping(executor)) {
      guidance.push(
        diagnostic("guidance", "warning", "guidance.executor.type", path, "executor should be a mapping"),
      );
    } else {
      if (!nonempty(executor["resource"])) {
        guidance.push(
          diagnostic(
            "guidance",
            "warning",
            "guidance.executor.resource",
            path,
            "executor.resource should be a non-empty string",
          ),
        );
      }
      const receipt = executor["receipt"];
      if (
        receipt !== undefined
        && (!Array.isArray(receipt) || receipt.some((field) => !nonempty(field)))
      ) {
        guidance.push(
          diagnostic(
            "guidance",
            "warning",
            "guidance.executor.receipt",
            path,
            "executor.receipt should be a list of non-empty strings",
          ),
        );
      }
    }
  }

  const attester = metadata["attester"];
  if (attester !== undefined) {
    if (!mapping(attester)) {
      guidance.push(
        diagnostic("guidance", "warning", "guidance.attester.type", path, "attester should be a mapping"),
      );
    } else if (!nonempty(attester["resource"])) {
      guidance.push(
        diagnostic(
          "guidance",
          "warning",
          "guidance.attester.resource",
          path,
          "attester.resource should be a non-empty string",
        ),
      );
    }
  }
}

export function deriveDocumentFields(
  metadata: Readonly<Record<string, unknown>>,
  body: string,
  path: string,
  knownPaths: ReadonlySet<string>,
  nonDocumentPaths: ReadonlySet<string>,
  today: string | null,
): { readonly derived: DerivedDocumentFields; readonly guidance: readonly Diagnostic[] } {
  const guidance: Diagnostic[] = [];
  checkTrustAndLifecycle(metadata, path, guidance);
  checkContractPaths(metadata, path, knownPaths, nonDocumentPaths, guidance);

  const tagsValue = metadata["tags"];
  let tags: readonly string[] = [];
  if (tagsValue !== undefined) {
    if (!Array.isArray(tagsValue) || tagsValue.some((tag) => typeof tag !== "string")) {
      guidance.push(diagnostic("guidance", "warning", "guidance.tags.type", path, "tags should be a list of strings"));
    } else {
      tags = tagsValue.map((tag) => tag.trim()).filter(Boolean);
    }
  }

  const staleAfter = nonempty(metadata["stale_after"]);
  if (staleAfter === null) {
    const perishable = [...new Set(tags.filter((tag) => PERISHABLE_TAGS.has(tag)))].sort();
    if (perishable.length > 0) {
      guidance.push(
        diagnostic(
          "guidance",
          "warning",
          "guidance.stale-after.perishable",
          path,
          `tags ${perishable.join(", ")} perish, so stale_after should be set`,
        ),
      );
    }
  }
  const validStaleAfter = staleAfter !== null && validDate(staleAfter) ? staleAfter : null;
  const validToday = today !== null && validDate(today) ? today : null;
  const statusValue = nonempty(metadata["status"]);
  const heading = markdownHeadings(body).find(({ depth }) => depth === 1)?.text.trim();
  const filename = path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path;

  return {
    derived: {
      title: nonempty(metadata["title"]) ?? heading ?? filename,
      type: nonempty(metadata["type"]),
      description: nonempty(metadata["description"]),
      status: statusValue ?? "stable",
      trustTier: trustTier(metadata),
      stale: validStaleAfter !== null && validToday !== null ? validToday >= validStaleAfter : null,
      staleAfter: validStaleAfter,
      tags,
      sources: sourceFields(metadata["sources"], path, knownPaths, guidance),
    },
    guidance,
  };
}


/** Like `mapping`, but yields the record so its keys can be read. */
function asMapping(value: unknown): Readonly<Record<string, unknown>> | null {
  return mapping(value) ? value : null;
}

/**
 * Resolve the path-valued fields of an Attested Computation. The spec lists `computation`,
 * `executor.resource` and `attester.resource` alongside `sources[].resource` as fields that
 * name a file, but only source resources were resolved, so a broken executor path passed
 * without comment.
 *
 * These three name a file rather than a page: a `computation` is a query, an `attester.resource`
 * is a script. So a target counts as resolved when it is either a loaded document or a bundle
 * file the loader saw without parsing. `sources[].resource` is deliberately not treated this
 * way — a source naming an unwritten `.md` page is the corpus's to-do list, and keeps reporting.
 */
function checkContractPaths(
  metadata: Readonly<Record<string, unknown>>,
  path: string,
  knownPaths: ReadonlySet<string>,
  nonDocumentPaths: ReadonlySet<string>,
  guidance: Diagnostic[],
): void {
  const executor = asMapping(metadata["executor"]);
  const attester = asMapping(metadata["attester"]);
  const candidates: readonly (readonly [string, unknown])[] = [
    ["computation", metadata["computation"]],
    ["executor.resource", executor?.["resource"]],
    ["attester.resource", attester?.["resource"]],
  ];

  for (const [label, value] of candidates) {
    const target = nonempty(value);
    if (target === null || SCHEME.test(target)) {
      continue;
    }
    const resolution = resolveWithinBundle(path, target);
    if (resolution.kind === "escape") {
      guidance.push(
        diagnostic(
          "guidance",
          "warning",
          "guidance.contract.escape",
          path,
          `${label} escapes the bundle: ${target}`,
        ),
      );
    } else if (
      resolution.kind === "internal"
      && !knownPaths.has(resolution.path)
      && !nonDocumentPaths.has(resolution.path)
    ) {
      guidance.push(
        diagnostic(
          "guidance",
          "warning",
          "guidance.contract.broken",
          path,
          `${label} does not resolve: ${target}`,
        ),
      );
    }
  }
}


function usageWindowOf(value: unknown): UsageWindow | null {
  const record = asMapping(value);
  if (record === null) {
    return null;
  }
  const from = nonempty(record["from"]);
  const to = nonempty(record["to"]);
  return from === null && to === null ? null : { from, to };
}

/**
 * Project the derived fields `okf.inspect.v1` cannot carry. `okf_type` is the document's OKF
 * type under the name a catalog predicate matches on, and the usage windows frame every
 * `usage_count` the analysis already reports. Both are derived from the same frontmatter the
 * analysis read, so a consumer reads them here instead of re-deriving them itself.
 */
export function documentExtensions(document: AnalyzedDocument): DocumentExtensions {
  const metadata = document.metadata;
  const sourceUsageWindows: (UsageWindow | null)[] = [];
  const sources = metadata["sources"];
  if (Array.isArray(sources)) {
    for (const entry of sources) {
      if (isUsableSourceEntry(entry)) {
        sourceUsageWindows.push(usageWindowOf(entry["usage_window"]));
      }
    }
  }
  return {
    path: document.path,
    okf_type: nonempty(metadata["type"]),
    usageWindow: usageWindowOf(metadata["usage_window"]),
    sourceUsageWindows,
  };
}
