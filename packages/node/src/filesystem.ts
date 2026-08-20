import { createHash } from "node:crypto";
import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { analyzeBundle, byCodePoint, type AnalyzeBundleOptions } from "okf-core";
import type { BundleAnalysis, RawBundleDocument, Revision } from "okf-contracts";
import { assertExistingPathConfined, isWithinRoot, normalizeBundlePath } from "./path.js";

export function contentRevision(content: string | Uint8Array): Revision {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function collectMarkdown(root: string, directory: string, prefix: string, output: string[]): Promise<void> {
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
      await collectMarkdown(root, candidate, relative, output);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const canonical = await realpath(candidate);
      if (!isWithinRoot(root, canonical)) {
        throw new Error(`bundle path escapes its root: ${relative}`);
      }
      output.push(relative);
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

  async listPaths(): Promise<string[]> {
    const paths: string[] = [];
    await collectMarkdown(this.root, this.root, "", paths);
    return paths.sort(byCodePoint);
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
    return analyzeBundle(await this.readDocuments(), options);
  }
}
