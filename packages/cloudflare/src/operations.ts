import type {
  ApplyChangeRequest,
  Change,
  ChangePreview,
  ChangeResult,
  Diagnostic,
  RawBundleDocument,
  Revision,
} from "okf-contracts";
import { OPERATIONS_SCHEMA } from "okf-contracts";
import {
  analyzeBundle,
  canonicalChangeJson,
  listBundleEntries,
  parseChange,
  searchBundle,
  unifiedDiff,
  type AnalyzeBundleOptions,
} from "okf-core";
import type { OkfV1Operations } from "okf-contracts";

import {
  confinedBundlePath,
  R2BundleAdapter,
  R2BundleError,
  type R2BucketLike,
  type R2BundleListing,
} from "./r2.js";

export interface OkfContextDocument {
  readonly path: string;
  readonly content: string;
}

export interface R2OkfV1OperationsOptions {
  readonly adapter: R2BundleAdapter;
  readonly analysis?: AnalyzeBundleOptions;
  readonly audience?: string;
  readonly instructions?:
    | readonly OkfContextDocument[]
    | (() => Promise<readonly OkfContextDocument[]>);
  readonly visualizationUrl?: string | null;
}

/** Read explicitly configured instruction objects without widening the authored bundle adapter. */
export async function readR2ContextDocuments(
  bucket: R2BucketLike,
  keys: readonly string[],
): Promise<readonly OkfContextDocument[]> {
  const documents: OkfContextDocument[] = [];
  for (const key of keys) {
    const confined = confinedBundlePath(key);
    const object = await bucket.get(confined);
    if (!object) throw new R2BundleError(`context document does not exist in R2: ${confined}`);
    documents.push({ path: confined, content: await object.text() });
  }
  return documents;
}

function allDiagnostics(analysis: ReturnType<typeof analyzeBundle>): readonly Diagnostic[] {
  return [
    ...analysis.diagnostics.core,
    ...analysis.diagnostics.guidance,
    ...analysis.diagnostics.profile,
  ];
}

function changeDiagnostic(path: string, code: string, message: string): Diagnostic {
  return { code, family: "core", severity: "error", path, message };
}

function affectedPaths(change: Change): readonly string[] {
  return change.operation === "move" ? [change.from_path, change.to_path] : [change.path];
}

function revisionOf(document: RawBundleDocument): Revision | null {
  return document.revision ?? null;
}

function documentAt(
  documents: readonly RawBundleDocument[],
  path: string,
): RawBundleDocument | undefined {
  return documents.find((document) => document.path === path);
}

function proposedDocuments(
  current: readonly RawBundleDocument[],
  change: Change,
): { readonly documents: readonly RawBundleDocument[]; readonly diff: string; readonly diagnostics: readonly Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  if (change.operation === "create") {
    if (documentAt(current, change.path)) {
      diagnostics.push(changeDiagnostic(change.path, "change.create.exists", "create destination already exists"));
    }
    return {
      documents: diagnostics.length > 0 ? current : [...current, { path: change.path, content: change.content }],
      diff: unifiedDiff("", change.content, change.path),
      diagnostics,
    };
  }

  if (change.operation === "update") {
    const previous = documentAt(current, change.path);
    if (!previous) {
      diagnostics.push(changeDiagnostic(change.path, "change.update.missing", "update path does not exist"));
    } else if (revisionOf(previous) !== change.expected_revision) {
      diagnostics.push(changeDiagnostic(change.path, "change.revision.stale", "expected revision does not match"));
    }
    return {
      documents: diagnostics.length > 0
        ? current
        : current.map((document) => document.path === change.path
          ? { path: change.path, content: change.content, revision: document.revision }
          : document),
      diff: unifiedDiff(previous?.content ?? "", change.content, change.path),
      diagnostics,
    };
  }

  if (change.operation === "delete") {
    const previous = documentAt(current, change.path);
    if (!previous) {
      diagnostics.push(changeDiagnostic(change.path, "change.delete.missing", "delete path does not exist"));
    } else if (revisionOf(previous) !== change.expected_revision) {
      diagnostics.push(changeDiagnostic(change.path, "change.revision.stale", "expected revision does not match"));
    }
    return {
      documents: diagnostics.length > 0
        ? current
        : current.filter((document) => document.path !== change.path),
      diff: unifiedDiff(previous?.content ?? "", "", change.path),
      diagnostics,
    };
  }

  const source = documentAt(current, change.from_path);
  if (!source) {
    diagnostics.push(changeDiagnostic(change.from_path, "change.move.missing", "move source does not exist"));
  } else if (revisionOf(source) !== change.expected_revision) {
    diagnostics.push(changeDiagnostic(change.from_path, "change.revision.stale", "expected revision does not match"));
  }
  if (documentAt(current, change.to_path)) {
    diagnostics.push(changeDiagnostic(change.to_path, "change.move.exists", "move destination already exists"));
  }
  return {
    documents: diagnostics.length > 0 || !source
      ? current
      : [
          ...current.filter((document) => document.path !== change.from_path),
          { path: change.to_path, content: source.content, revision: source.revision },
        ],
    diff: source
      ? `${unifiedDiff(source.content, "", change.from_path)}${unifiedDiff("", source.content, change.to_path)}`
      : "",
    diagnostics,
  };
}

function hexadecimal(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of recursively key-sorted JSON for the confined, parsed Change. */
async function canonicalDigest(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(canonicalChangeJson(value));
  return `sha256:${hexadecimal(await crypto.subtle.digest("SHA-256", encoded))}`;
}

export async function changePreviewId(input: Change): Promise<string> {
  return canonicalDigest(input);
}

/** The shared listing policy, reported as an R2 failure so callers keep one error type. */
function listedPaths(documents: readonly RawBundleDocument[], requested: string, depth: number) {
  try {
    return listBundleEntries(documents.map((document) => document.path), requested, depth);
  } catch (error) {
    throw new R2BundleError(error instanceof Error ? error.message : `list path is not confined: ${requested}`);
  }
}

/** Create all versioned MCP operations for one R2 bundle. */
export function createR2OkfV1Operations(options: R2OkfV1OperationsOptions): OkfV1Operations {
  /** The analysis options plus what this listing saw that is not a document. */
  const withFiles = (listing: R2BundleListing): AnalyzeBundleOptions => ({
    ...options.analysis,
    nonDocumentPaths: listing.nonDocumentPaths,
  });

  const analyze = async () => {
    const listing = await options.adapter.listing();
    return analyzeBundle(listing.documents, withFiles(listing));
  };

  const previewFromDocuments = async (
    change: Change,
    listing: R2BundleListing,
  ): Promise<ChangePreview> => {
    const proposed = proposedDocuments(listing.documents, change);
    const analysis = analyzeBundle(proposed.documents, withFiles(listing));
    const diagnostics = [...proposed.diagnostics, ...allDiagnostics(analysis)];
    return {
      schema: OPERATIONS_SCHEMA,
      passed: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      preview_id: await changePreviewId(change),
      operation: change.operation,
      affected_paths: affectedPaths(change),
      diff: proposed.diff,
      diagnostics,
    };
  };

  const preview = async (input: Change): Promise<ChangePreview> => {
    const change = parseChange(input);
    return previewFromDocuments(change, await options.adapter.listing());
  };

  const rejected = (
    change: Change,
    diagnostics: readonly Diagnostic[],
  ): ChangeResult => ({
    schema: OPERATIONS_SCHEMA,
    outcome: "rejected",
    operation: change.operation,
    revisions: {},
    diagnostics,
  });

  const unchanged = (
    change: Change,
    revisions: Readonly<Record<string, Revision | null>>,
    listing: R2BundleListing,
  ): ChangeResult => ({
    schema: OPERATIONS_SCHEMA,
    outcome: "unchanged",
    operation: change.operation,
    revisions,
    diagnostics: allDiagnostics(analyzeBundle(listing.documents, withFiles(listing))),
  });

  return {
    async context() {
      const storedIndex = await options.adapter.readStoredIfPresent("index.md");
      const index = storedIndex === null
        ? null
        : {
            path: storedIndex.path,
            content: storedIndex.content,
            revision: storedIndex.revision,
          };
      const instructions = typeof options.instructions === "function"
        ? await options.instructions()
        : options.instructions ?? [];
      return {
        adapter: "r2",
        bundle: options.adapter.bundle,
        audience: options.audience ?? "unspecified",
        instructions,
        index,
      };
    },
    async list({ path, depth }) {
      const documents = await options.adapter.documents();
      return { bundle: options.adapter.bundle, path, entries: listedPaths(documents, path, depth) };
    },
    async search({ query, limit }) {
      return { bundle: options.adapter.bundle, query, ...searchBundle(await analyze(), query, limit) };
    },
    async read({ path }) {
      return { bundle: options.adapter.bundle, ...await options.adapter.read(path) };
    },
    async links({ path }) {
      const analysis = await analyze();
      const document = analysis.documents.find((entry) => entry.path === path);
      if (!document) throw new R2BundleError(`path does not exist in bundle ${options.adapter.bundle}: ${path}`);
      const backlinks = analysis.documents.flatMap((entry) => entry.links
        .filter((link) => link.resolvedPath === path && entry.path !== path)
        .map((link) => ({ path: entry.path, href: link.href })));
      return { bundle: options.adapter.bundle, path, outgoing: document.links, backlinks };
    },
    async validate() {
      const analysis = await analyze();
      const diagnostics = allDiagnostics(analysis);
      return {
        bundle: options.adapter.bundle,
        passed: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
        diagnostics: analysis.diagnostics,
        summary: analysis.summary,
      };
    },
    async inspect() {
      return { ...await analyze() };
    },
    async visualize() {
      return { bundle: options.adapter.bundle, url: options.visualizationUrl ?? null };
    },
    previewChange: preview,
    async applyChange(request: ApplyChangeRequest) {
      let change: Change;
      try {
        change = parseChange(request.change);
      } catch (error) {
        return rejected(request.change, [changeDiagnostic(
          request.change.operation === "move" ? request.change.from_path : request.change.path,
          "change.path.invalid",
          error instanceof Error ? error.message : "invalid change path",
        )]);
      }

      const expectedPreviewId = await changePreviewId(change);
      if (request.preview_id !== expectedPreviewId) {
        return rejected(change, [changeDiagnostic(
          change.operation === "move" ? change.from_path : change.path,
          "change.preview.mismatch",
          "preview_id does not match the canonical change",
        )]);
      }

      const listing = await options.adapter.listing();
      const current = listing.documents;
      if (change.operation === "create") {
        const existing = documentAt(current, change.path);
        if (existing?.content === change.content) {
          return unchanged(change, { [change.path]: existing.revision ?? null }, listing);
        }
      } else if (change.operation === "update") {
        const existing = documentAt(current, change.path);
        if (existing?.content === change.content) {
          return unchanged(change, { [change.path]: existing.revision ?? null }, listing);
        }
      } else if (change.operation === "delete") {
        if (!documentAt(current, change.path)) {
          return unchanged(change, { [change.path]: null }, listing);
        }
      } else {
        const state = await options.adapter.moveState(change, expectedPreviewId);
        if (!state.source && state.destinationOwned && state.destination) {
          return unchanged(
            change,
            { [change.from_path]: null, [change.to_path]: state.destination.revision },
            listing,
          );
        }
        if (state.destinationOwned && state.destination) {
          if (!state.source || state.source.revision !== change.expected_revision) {
            try {
              await options.adapter.applyStorageChange(change, expectedPreviewId);
            } catch {
              // The adapter compensates its marked destination when it can do so safely.
            }
            return rejected(change, [changeDiagnostic(
              change.from_path,
              "change.revision.stale",
              "expected revision does not match",
            )]);
          }
          if (state.destination.content !== state.source.content) {
            return rejected(change, [changeDiagnostic(
              change.to_path,
              "change.move.destination-conflict",
              "interrupted move destination content changed",
            )]);
          }
          const desired = current.filter((document) => document.path !== change.from_path);
          const diagnostics = allDiagnostics(analyzeBundle(desired, withFiles(listing)));
          if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
            return rejected(change, diagnostics);
          }
          try {
            return {
              schema: OPERATIONS_SCHEMA,
              outcome: "applied",
              operation: change.operation,
              revisions: await options.adapter.applyStorageChange(change, expectedPreviewId),
              diagnostics,
            };
          } catch (error) {
            return rejected(change, [changeDiagnostic(
              change.from_path,
              "change.storage.rejected",
              error instanceof Error ? error.message : "storage rejected the change",
            )]);
          }
        }
      }

      const checked = await previewFromDocuments(change, listing);
      if (!checked.passed) {
        return rejected(change, checked.diagnostics);
      }
      try {
        return {
          schema: OPERATIONS_SCHEMA,
          outcome: "applied",
          operation: change.operation,
          revisions: await options.adapter.applyStorageChange(change, expectedPreviewId),
          diagnostics: checked.diagnostics,
        };
      } catch (error) {
        const path = change.operation === "move" ? change.from_path : change.path;
        return rejected(change, [changeDiagnostic(
          path,
          "change.storage.rejected",
          error instanceof Error ? error.message : "storage rejected the change",
        )]);
      }
    },
  };
}
