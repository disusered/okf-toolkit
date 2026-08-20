import type {
  AnalyzedSource,
  DerivedDocumentFields,
  Diagnostic,
  TrustTier,
} from "okf-contracts";

import { diagnostic } from "./diagnostics.js";
import { markdownHeadings } from "./markdown.js";
import { resolveWithinBundle } from "./paths.js";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const ACTOR = /^(?:human:[^\s/:]+|process:[^\s/:]+|[^\s/:]+\/[^\s/:]+)$/;
const VALID_STATUSES = new Set(["draft", "stable", "deprecated"]);
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
}

export function deriveDocumentFields(
  metadata: Readonly<Record<string, unknown>>,
  body: string,
  path: string,
  knownPaths: ReadonlySet<string>,
  today: string | null,
): { readonly derived: DerivedDocumentFields; readonly guidance: readonly Diagnostic[] } {
  const guidance: Diagnostic[] = [];
  checkTrustAndLifecycle(metadata, path, guidance);

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
