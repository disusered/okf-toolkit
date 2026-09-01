import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
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
  parseChange as parseCoreChange,
  unifiedDiff,
  type AnalyzeBundleOptions,
} from "okf-core";
import { errorCode } from "./errors.js";
import { contentRevision, FilesystemBundle } from "./filesystem.js";
import { assertWritablePathConfined, isWithinRoot, nativePath } from "./path.js";

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function operationDiagnostic(code: string, documentPath: string, message: string): Diagnostic {
  return {
    code,
    family: "profile",
    severity: "error",
    path: documentPath,
    message,
    profile: "filesystem",
  };
}

function isNotFound(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

async function currentDocument(bundle: FilesystemBundle, documentPath: string) {
  try {
    return await bundle.readDocument(documentPath);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/** Node compatibility export backed by the shared core wire parser. */
export function parseChange(value: unknown): Change {
  return parseCoreChange(value);
}

export function changePreviewId(unparsedChange: Change | unknown): string {
  return `sha256:${createHash("sha256").update(canonicalChangeJson(unparsedChange), "utf8").digest("hex")}`;
}

export function parseApplyChangeRequest(value: unknown): ApplyChangeRequest {
  if (!mapping(value)) {
    throw new Error("apply request must be a JSON object");
  }
  if (typeof value.preview_id !== "string") {
    throw new Error("apply request requires a string preview_id");
  }
  return { change: parseChange(value.change), preview_id: value.preview_id };
}

interface FilesystemChangeHooks {
  /** Dependency injection for deterministic adapter tests; production uses node:fs link. */
  readonly link?: typeof link;
}

/**
 * A change only ever rewrites documents, so the bundle's other files are read from disk as
 * they are. Without them a contract path that names a query or a script would report broken
 * on every preview and every post-write validation.
 */
async function groupedDiagnostics(
  bundle: FilesystemBundle,
  documents: readonly RawBundleDocument[],
  options: AnalyzeBundleOptions,
): Promise<Diagnostic[]> {
  const analysis = analyzeBundle(documents, {
    ...options,
    nonDocumentPaths: await bundle.nonDocumentPaths(),
  });
  return [
    ...analysis.diagnostics.core,
    ...analysis.diagnostics.guidance,
    ...analysis.diagnostics.profile,
  ];
}

function passed(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.every((diagnostic) => diagnostic.severity !== "error");
}

function replaceDocument(
  documents: RawBundleDocument[],
  documentPath: string,
  replacement: RawBundleDocument | null,
): void {
  const index = documents.findIndex((document) => document.path === documentPath);
  if (index >= 0) {
    if (replacement === null) documents.splice(index, 1);
    else documents[index] = replacement;
  } else if (replacement !== null) {
    documents.push(replacement);
  }
}

export async function previewChange(
  bundle: FilesystemBundle,
  unparsedChange: Change | unknown,
  options: AnalyzeBundleOptions = {},
): Promise<ChangePreview> {
  const change = parseChange(unparsedChange);
  const diagnostics: Diagnostic[] = [];
  let affectedPaths: string[];
  let diff = "";

  if (change.operation === "create") {
    affectedPaths = [change.path];
    const existing = await currentDocument(bundle, change.path);
    if (existing !== null) {
      diagnostics.push(operationDiagnostic("change.create.conflict", change.path, "create target already exists"));
    } else {
      diff = unifiedDiff("", change.content, change.path);
    }
  } else if (change.operation === "update") {
    affectedPaths = [change.path];
    const existing = await currentDocument(bundle, change.path);
    if (existing === null) {
      diagnostics.push(operationDiagnostic("change.update.conflict", change.path, "update target does not exist"));
    } else if (existing.revision !== change.expected_revision) {
      diagnostics.push(operationDiagnostic("change.revision.conflict", change.path, "expected_revision does not match current content"));
    } else {
      diff = unifiedDiff(existing.content, change.content, change.path);
    }
  } else if (change.operation === "delete") {
    affectedPaths = [change.path];
    const existing = await currentDocument(bundle, change.path);
    if (existing === null) {
      diagnostics.push(operationDiagnostic("change.delete.conflict", change.path, "delete target does not exist"));
    } else if (existing.revision !== change.expected_revision) {
      diagnostics.push(operationDiagnostic("change.revision.conflict", change.path, "expected_revision does not match current content"));
    } else {
      diff = unifiedDiff(existing.content, "", change.path);
    }
  } else {
    affectedPaths = [change.from_path, change.to_path];
    const [source, target] = await Promise.all([
      currentDocument(bundle, change.from_path),
      currentDocument(bundle, change.to_path),
    ]);
    if (change.from_path === change.to_path) {
      diagnostics.push(operationDiagnostic("change.move.conflict", change.from_path, "move source and target must differ"));
    } else if (source === null) {
      diagnostics.push(operationDiagnostic("change.move.conflict", change.from_path, "move source does not exist"));
    } else if (source.revision !== change.expected_revision) {
      diagnostics.push(operationDiagnostic("change.revision.conflict", change.from_path, "expected_revision does not match current content"));
    } else if (target !== null) {
      diagnostics.push(operationDiagnostic("change.move.conflict", change.to_path, "move target already exists"));
    } else {
      diff = `--- a/${change.from_path}\n+++ b/${change.to_path}\n`;
    }
  }

  if (diagnostics.length === 0) {
    const proposed = await bundle.readDocuments();
    if (change.operation === "create" || change.operation === "update") {
      replaceDocument(proposed, change.path, {
        path: change.path,
        content: change.content,
        revision: contentRevision(change.content),
      });
    } else if (change.operation === "delete") {
      replaceDocument(proposed, change.path, null);
    } else {
      const source = proposed.find((document) => document.path === change.from_path)!;
      replaceDocument(proposed, change.from_path, null);
      replaceDocument(proposed, change.to_path, { ...source, path: change.to_path });
    }
    diagnostics.push(...await groupedDiagnostics(bundle, proposed, options));
  }

  return {
    schema: OPERATIONS_SCHEMA,
    passed: passed(diagnostics),
    preview_id: changePreviewId(change),
    operation: change.operation,
    affected_paths: affectedPaths,
    diff,
    diagnostics,
  };
}

async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = errorCode(error);
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EISDIR" && code !== "EPERM") {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

interface WritableTarget {
  readonly target: string;
  readonly createdDirectories: readonly string[];
}

async function ensureSafeParent(bundle: FilesystemBundle, relativePath: string): Promise<WritableTarget> {
  const target = await assertWritablePathConfined(bundle.root, relativePath);
  const parentRelative = path.posix.dirname(relativePath);
  const createdDirectories: string[] = [];
  if (parentRelative === ".") {
    return { target, createdDirectories };
  }
  let cursor = bundle.root;
  for (const part of parentRelative.split("/")) {
    cursor = path.join(cursor, part);
    try {
      await mkdir(cursor);
      createdDirectories.push(cursor);
      await syncDirectory(path.dirname(cursor));
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw error;
      }
    }
    const metadata = await lstat(cursor);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`bundle parent must be a real directory: ${parentRelative}`);
    }
    if (!isWithinRoot(bundle.root, cursor)) {
      throw new Error(`bundle path escapes its root: ${relativePath}`);
    }
  }
  return { target, createdDirectories };
}

async function cleanupCreatedDirectories(directories: readonly string[]): Promise<void> {
  for (const directory of [...directories].reverse()) {
    try {
      await rmdir(directory);
      await syncDirectory(path.dirname(directory));
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
    }
  }
}

async function writeExclusive(target: string, content: string | Uint8Array, mode: number): Promise<void> {
  const handle = await open(target, "wx", mode);
  try {
    await handle.chmod(mode & 0o7777);
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    const failures: unknown[] = [error];
    try {
      await handle.close();
    } catch (closeError) {
      failures.push(closeError);
    }
    try {
      await unlink(target);
      await syncDirectory(path.dirname(target));
    } catch (cleanupError) {
      if (!isNotFound(cleanupError)) {
        failures.push(cleanupError);
      }
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, "failed to write and remove an incomplete document");
    }
    throw error;
  }
  await handle.close();
  await syncDirectory(path.dirname(target));
}

async function replaceIfRevision(
  bundle: FilesystemBundle,
  documentPath: string,
  target: string,
  content: string,
  mode: number,
  expectedRevision: Revision,
): Promise<boolean> {
  const temporary = `${target}.okf-${randomUUID()}.tmp`;
  await writeExclusive(temporary, content, mode);
  const stillCurrent = (await currentDocument(bundle, documentPath))?.revision === expectedRevision;
  if (!stillCurrent) {
    await unlinkDurable(temporary);
    return false;
  }
  await rename(temporary, target);
  await syncDirectory(path.dirname(target));
  return true;
}

async function writeAtomic(target: string, content: string | Uint8Array, mode: number): Promise<void> {
  const temporary = `${target}.okf-${randomUUID()}.tmp`;
  try {
    await writeExclusive(temporary, content, mode);
    await rename(temporary, target);
    await syncDirectory(path.dirname(target));
  } catch (error) {
    try {
      await unlink(temporary);
      await syncDirectory(path.dirname(temporary));
    } catch (cleanupError) {
      if (!isNotFound(cleanupError)) {
        throw new AggregateError([error, cleanupError], "failed to write document and remove temporary file");
      }
    }
    throw error;
  }
}

async function unlinkDurable(target: string): Promise<void> {
  await unlink(target);
  await syncDirectory(path.dirname(target));
}

function rejectedResult(change: Change, diagnostics: readonly Diagnostic[]): ChangeResult {
  return {
    schema: OPERATIONS_SCHEMA,
    outcome: "rejected",
    operation: change.operation,
    revisions: {},
    diagnostics,
  };
}

function completedResult(
  change: Change,
  outcome: "applied" | "unchanged",
  revisions: Readonly<Record<string, Revision | null>>,
  diagnostics: readonly Diagnostic[],
): ChangeResult {
  return { schema: OPERATIONS_SCHEMA, outcome, operation: change.operation, revisions, diagnostics };
}

async function validateCurrent(bundle: FilesystemBundle, options: AnalyzeBundleOptions): Promise<Diagnostic[]> {
  return groupedDiagnostics(bundle, await bundle.readDocuments(), options);
}

function postWriteDiagnostic(change: Change): Diagnostic {
  const documentPath = change.operation === "move" ? change.to_path : change.path;
  return operationDiagnostic(
    "change.post_write.validation_failed",
    documentPath,
    "post-write validation failed; the original filesystem state was restored",
  );
}

async function validationForApply(
  bundle: FilesystemBundle,
  change: Change,
  mode: "unchanged" | "create" | "update" | "delete" | "move" | "finish-move",
  options: AnalyzeBundleOptions,
): Promise<Diagnostic[]> {
  const documents = await bundle.readDocuments();
  if (mode === "create" || mode === "update") {
    if (change.operation !== "create" && change.operation !== "update") {
      throw new Error(`change ${change.operation} does not support ${mode} validation`);
    }
    const documentPath = change.path;
    const content = change.content;
    replaceDocument(documents, documentPath, { path: documentPath, content, revision: contentRevision(content) });
  } else if (mode === "delete") {
    if (change.operation !== "delete") throw new Error(`change ${change.operation} does not support delete validation`);
    replaceDocument(documents, change.path, null);
  } else if (mode === "move") {
    if (change.operation !== "move") throw new Error(`change ${change.operation} does not support move validation`);
    const source = documents.find((document) => document.path === change.from_path)!;
    replaceDocument(documents, change.from_path, null);
    replaceDocument(documents, change.to_path, { ...source, path: change.to_path });
  } else if (mode === "finish-move") {
    if (change.operation !== "move") throw new Error(`change ${change.operation} does not support move validation`);
    replaceDocument(documents, change.from_path, null);
  }
  return groupedDiagnostics(bundle, documents, options);
}

export function applyChange(
  bundle: FilesystemBundle,
  unparsedRequest: ApplyChangeRequest | unknown,
  options: AnalyzeBundleOptions = {},
): Promise<ChangeResult> {
  return applyChangeWithHooks(bundle, unparsedRequest, options);
}

/** @internal Test seam for deterministic filesystem error injection. */
export async function applyChangeWithHooks(
  bundle: FilesystemBundle,
  unparsedRequest: ApplyChangeRequest | unknown,
  options: AnalyzeBundleOptions = {},
  hooks: FilesystemChangeHooks = {},
): Promise<ChangeResult> {
  const request = parseApplyChangeRequest(unparsedRequest);
  const change = request.change;
  if (request.preview_id !== changePreviewId(change)) {
    return rejectedResult(change, [
      operationDiagnostic("change.preview_id.conflict", ".", "preview_id does not match the canonical change request"),
    ]);
  }

  if (change.operation === "create") {
    const existing = await currentDocument(bundle, change.path);
    const desiredRevision = contentRevision(change.content);
    const mode = existing?.revision === desiredRevision ? "unchanged" : "create";
    if (existing !== null && mode !== "unchanged") {
      return rejectedResult(change, [operationDiagnostic("change.create.conflict", change.path, "create target contains different content")]);
    }
    const diagnostics = await validationForApply(bundle, change, mode, options);
    if (!passed(diagnostics)) return rejectedResult(change, diagnostics);
    if (mode === "unchanged") {
      return completedResult(change, "unchanged", { [change.path]: desiredRevision }, diagnostics);
    }
    const writable = await ensureSafeParent(bundle, change.path);
    try {
      await writeExclusive(writable.target, change.content, 0o600);
    } catch (error) {
      await cleanupCreatedDirectories(writable.createdDirectories);
      if (errorCode(error) === "EEXIST") {
        return rejectedResult(change, [operationDiagnostic("change.create.conflict", change.path, "create target appeared during apply")]);
      }
      throw error;
    }
    const post = await validateCurrent(bundle, options);
    if (!passed(post)) {
      await unlinkDurable(writable.target);
      await cleanupCreatedDirectories(writable.createdDirectories);
      return rejectedResult(change, [postWriteDiagnostic(change), ...post]);
    }
    return completedResult(change, "applied", { [change.path]: desiredRevision }, post);
  }

  if (change.operation === "update") {
    const current = await currentDocument(bundle, change.path);
    const desiredRevision = contentRevision(change.content);
    if (current?.revision === desiredRevision) {
      const diagnostics = await validationForApply(bundle, change, "unchanged", options);
      return passed(diagnostics)
        ? completedResult(change, "unchanged", { [change.path]: desiredRevision }, diagnostics)
        : rejectedResult(change, diagnostics);
    }
    if (current === null || current.revision !== change.expected_revision) {
      return rejectedResult(change, [operationDiagnostic("change.revision.conflict", change.path, "expected_revision does not match current content")]);
    }
    const diagnostics = await validationForApply(bundle, change, "update", options);
    if (!passed(diagnostics)) return rejectedResult(change, diagnostics);
    const target = nativePath(bundle.root, change.path);
    const metadata = await lstat(target);
    const original = await readFile(target);
    if ((await bundle.readDocument(change.path)).revision !== change.expected_revision) {
      return rejectedResult(change, [operationDiagnostic("change.revision.conflict", change.path, "content changed during apply")]);
    }
    const replaced = await replaceIfRevision(
      bundle,
      change.path,
      target,
      change.content,
      metadata.mode,
      change.expected_revision,
    );
    if (!replaced) {
      return rejectedResult(change, [operationDiagnostic("change.revision.conflict", change.path, "content changed while applying update")]);
    }
    const post = await validateCurrent(bundle, options);
    if (!passed(post)) {
      await writeAtomic(target, original, metadata.mode);
      return rejectedResult(change, [postWriteDiagnostic(change), ...post]);
    }
    return completedResult(change, "applied", { [change.path]: desiredRevision }, post);
  }

  if (change.operation === "delete") {
    const current = await currentDocument(bundle, change.path);
    if (current === null) {
      const diagnostics = await validationForApply(bundle, change, "unchanged", options);
      return passed(diagnostics)
        ? completedResult(change, "unchanged", { [change.path]: null }, diagnostics)
        : rejectedResult(change, diagnostics);
    }
    if (current.revision !== change.expected_revision) {
      return rejectedResult(change, [operationDiagnostic("change.revision.conflict", change.path, "expected_revision does not match current content")]);
    }
    const diagnostics = await validationForApply(bundle, change, "delete", options);
    if (!passed(diagnostics)) return rejectedResult(change, diagnostics);
    const target = nativePath(bundle.root, change.path);
    const metadata = await lstat(target);
    const original = await readFile(target);
    if ((await bundle.readDocument(change.path)).revision !== change.expected_revision) {
      return rejectedResult(change, [operationDiagnostic("change.revision.conflict", change.path, "content changed during apply")]);
    }
    await unlinkDurable(target);
    const post = await validateCurrent(bundle, options);
    if (!passed(post)) {
      await writeExclusive(target, original, metadata.mode);
      return rejectedResult(change, [postWriteDiagnostic(change), ...post]);
    }
    return completedResult(change, "applied", { [change.path]: null }, post);
  }

  if (change.from_path === change.to_path) {
    return rejectedResult(change, [operationDiagnostic("change.move.conflict", change.from_path, "move source and target must differ")]);
  }
  const [source, destination] = await Promise.all([
    currentDocument(bundle, change.from_path),
    currentDocument(bundle, change.to_path),
  ]);
  if (source === null) {
    if (destination?.revision !== change.expected_revision) {
      return rejectedResult(change, [operationDiagnostic("change.move.conflict", change.to_path, "move destination does not match the expected source")]);
    }
    const diagnostics = await validationForApply(bundle, change, "unchanged", options);
    return passed(diagnostics)
      ? completedResult(change, "unchanged", { [change.from_path]: null, [change.to_path]: destination.revision }, diagnostics)
      : rejectedResult(change, diagnostics);
  }
  if (source.revision !== change.expected_revision) {
    return rejectedResult(change, [operationDiagnostic("change.revision.conflict", change.from_path, "expected_revision does not match current source")]);
  }
  const finishMove = destination?.revision === change.expected_revision;
  if (destination !== null && !finishMove) {
    return rejectedResult(change, [operationDiagnostic("change.move.conflict", change.to_path, "move destination contains different content")]);
  }
  const mode = finishMove ? "finish-move" : "move";
  const diagnostics = await validationForApply(bundle, change, mode, options);
  if (!passed(diagnostics)) return rejectedResult(change, diagnostics);

  const sourcePath = nativePath(bundle.root, change.from_path);
  const sourceMetadata = await lstat(sourcePath);
  if ((await bundle.readDocument(change.from_path)).revision !== change.expected_revision) {
    return rejectedResult(change, [operationDiagnostic("change.revision.conflict", change.from_path, "source changed during apply")]);
  }
  if (finishMove && (await currentDocument(bundle, change.to_path))?.revision !== change.expected_revision) {
    return rejectedResult(change, [operationDiagnostic("change.move.conflict", change.to_path, "move destination changed during apply")]);
  }
  if (finishMove && (await lstat(nativePath(bundle.root, change.to_path))).dev !== sourceMetadata.dev) {
    return rejectedResult(change, [operationDiagnostic(
      "change.move.cross_device_conflict",
      change.to_path,
      "move source and destination are on different filesystems",
    )]);
  }
  let writable: WritableTarget | null = null;
  if (!finishMove) {
    writable = await ensureSafeParent(bundle, change.to_path);
    try {
      await (hooks.link ?? link)(sourcePath, writable.target);
      await syncDirectory(path.dirname(writable.target));
    } catch (error) {
      if (errorCode(error) === "EXDEV") {
        await cleanupCreatedDirectories(writable.createdDirectories);
        return rejectedResult(change, [operationDiagnostic(
          "change.move.cross_device_conflict",
          change.to_path,
          "move source and destination are on different filesystems",
        )]);
      } else if (errorCode(error) === "EEXIST") {
        await cleanupCreatedDirectories(writable.createdDirectories);
        return rejectedResult(change, [operationDiagnostic("change.move.conflict", change.to_path, "move destination appeared during apply")]);
      } else {
        await cleanupCreatedDirectories(writable.createdDirectories);
        throw error;
      }
    }
    if ((await currentDocument(bundle, change.to_path))?.revision !== change.expected_revision) {
      await unlinkDurable(writable.target);
      await cleanupCreatedDirectories(writable.createdDirectories);
      return rejectedResult(change, [operationDiagnostic("change.revision.conflict", change.to_path, "linked destination does not match expected source")]);
    }
  }
  if ((await currentDocument(bundle, change.from_path))?.revision !== change.expected_revision) {
    if (!finishMove && writable !== null) {
      await unlinkDurable(writable.target);
      await cleanupCreatedDirectories(writable.createdDirectories);
    }
    return rejectedResult(change, [operationDiagnostic("change.revision.conflict", change.from_path, "source changed before deletion")]);
  }
  await unlinkDurable(sourcePath);
  const post = await validateCurrent(bundle, options);
  if (!passed(post)) {
    const destinationPath = nativePath(bundle.root, change.to_path);
    await link(destinationPath, sourcePath);
    await syncDirectory(path.dirname(sourcePath));
    if (!finishMove) {
      await unlinkDurable(destinationPath);
      await cleanupCreatedDirectories(writable?.createdDirectories ?? []);
    }
    return rejectedResult(change, [postWriteDiagnostic(change), ...post]);
  }
  return completedResult(
    change,
    "applied",
    { [change.from_path]: null, [change.to_path]: change.expected_revision },
    post,
  );
}
