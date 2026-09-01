import { createHash } from "node:crypto";
import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { analyzeBundle, byCodePoint, type AnalyzeBundleOptions } from "okf-core";
import type { BundleAnalysis, RawBundleDocument, Revision } from "okf-contracts";
import { assertExistingPathConfined, isWithinRoot, normalizeBundlePath } from "./path.js";

export function contentRevision(content: string | Uint8Array): Revision {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/**
 * What one walk of a bundle root finds: the OKF documents to parse, and the other files that
 * are simply there. A contract may name one of those other files — a query, an attester
 * script — so the analysis has to be told they exist even though nothing reads them.
 */
interface BundleEntries {
  readonly documents: string[];
  readonly files: string[];
}

async function collectEntries(
  root: string,
  directory: string,
  prefix: string,
  output: BundleEntries,
): Promise<void> {
  const entries = [];
  const handle = await opendir(directory);
  for await (const entry of handle) {
    entries.push(entry);
  }
  entries.sort((left, right) => byCodePoint(left.name, right.name));

  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`symbolic links are not allowed in a bundle: ${relative}`);
    }
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectEntries(root, candidate, relative, output);
    } else if (entry.isFile()) {
      // A non-Markdown file gets the same confinement it would as a document; not being
      // parsed must not make it a way around the escape check.
      const canonical = await realpath(candidate);
      if (!isWithinRoot(root, canonical)) {
        throw new Error(`bundle path escapes its root: ${relative}`);
      }
      (entry.name.endsWith(".md") ? output.documents : output.files).push(relative);
    }
  }
}

export class FilesystemBundle {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async open(root: string): Promise<FilesystemBundle> {
    const metadata = await lstat(root);
    if (metadata.isSymbolicLink()) {
      throw new Error("bundle root must not be a symbolic link");
    }
    if (!metadata.isDirectory()) {
      throw new Error(`bundle root is not a directory: ${root}`);
    }
    return new FilesystemBundle(await realpath(root));
  }

  private async collect(): Promise<BundleEntries> {
    const output: BundleEntries = { documents: [], files: [] };
    await collectEntries(this.root, this.root, "", output);
    output.documents.sort(byCodePoint);
    output.files.sort(byCodePoint);
    return output;
  }

  /** The OKF documents in this bundle. Markdown only, as every caller of it expects. */
  async listPaths(): Promise<string[]> {
    return (await this.collect()).documents;
  }

  /** The bundle's other files, which a contract path may name. Nothing here is parsed. */
  async listFilePaths(): Promise<string[]> {
    return (await this.collect()).files;
  }

  /** `listFilePaths` in the shape `analyzeBundle` takes it. */
  async nonDocumentPaths(): Promise<ReadonlySet<string>> {
    return new Set(await this.listFilePaths());
  }

  async readDocument(relativePath: string): Promise<RawBundleDocument> {
    const normalized = normalizeBundlePath(relativePath);
    if (!normalized.endsWith(".md")) {
      throw new Error(`OKF document path must end in .md: ${normalized}`);
    }
    const canonical = await assertExistingPathConfined(this.root, normalized);
    const bytes = await readFile(canonical);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return {
      path: normalized,
      content,
      revision: contentRevision(bytes),
    };
  }

  async readDocuments(): Promise<RawBundleDocument[]> {
    const paths = await this.listPaths();
    return Promise.all(paths.map(async (documentPath) => this.readDocument(documentPath)));
  }

  async analyze(options: AnalyzeBundleOptions = {}): Promise<BundleAnalysis> {
    const { documents, files } = await this.collect();
    const raw = await Promise.all(documents.map(async (documentPath) => this.readDocument(documentPath)));
    return analyzeBundle(raw, { ...options, nonDocumentPaths: new Set(files) });
  }
}
