import type { BundleAnalysis, BundleDirectoryIndex, BundleIndexEntry } from "okf-contracts";
import { byCodePoint, validateBundlePath } from "./paths.js";

function label(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[\\`*_[\]<>]/g, "\\$&");
}

function href(value: string): string {
  return value.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

/** Derive directory navigation without changing authored documents or semantic edges. */
export function generateBundleIndexes(analysis: BundleAnalysis): BundleDirectoryIndex[] {
  const directories = new Set<string>(["."]);
  for (const document of analysis.documents) {
    const parts = document.path.split("/");
    for (let count = 1; count < parts.length; count += 1) {
      directories.add(parts.slice(0, count).join("/"));
    }
  }
  const titles = new Map(analysis.documents.filter((document) => document.kind === "index")
    .map((document) => [document.path, document.derived.title]));
  return [...directories].sort(byCodePoint).map((directory) => {
    const prefix = directory === "." ? "" : `${directory}/`;
    const indexPath = `${prefix}index.md`;
    const title = titles.get(indexPath) ?? (directory === "." ? "Bundle" : directory.split("/").at(-1)!);
    const entries: BundleIndexEntry[] = [];
    for (const child of directories) {
      if (child === "." || !child.startsWith(prefix)) continue;
      const relative = child.slice(prefix.length);
      if (relative.includes("/") || relative === "") continue;
      entries.push({ kind: "directory", path: child, title: titles.get(`${child}/index.md`) ?? relative,
        description: null, href: `${href(relative)}/index.md` });
    }
    for (const document of analysis.documents) {
      if (document.kind === "index" || !document.path.startsWith(prefix)) continue;
      const relative = document.path.slice(prefix.length);
      if (relative.includes("/")) continue;
      entries.push({ kind: "document", path: document.path, title: document.derived.title,
        description: document.derived.description, href: href(relative) });
    }
    entries.sort((left, right) => byCodePoint(left.path, right.path));
    const version = directory === "." && analysis.okfVersion !== null
      ? `---\nokf_version: ${JSON.stringify(analysis.okfVersion)}\n---\n\n` : "";
    const lines = entries.map((entry) => `- [${label(entry.title)}](${entry.href})${entry.description
      ? ` — ${label(entry.description)}` : ""}`);
    return { schema: "okf.index.v1", generated: true, directory, path: indexPath, title, entries,
      content: `${version}# ${label(title)}\n\n${lines.length ? `${lines.join("\n")}\n` : ""}` };
  });
}

export function selectBundleIndex(indexes: readonly BundleDirectoryIndex[], requested = "."): BundleDirectoryIndex {
  const directory = requested === "." ? "." : validateBundlePath(requested);
  const index = indexes.find((candidate) => candidate.directory === directory);
  if (!index) throw new Error(`directory does not exist in bundle: ${requested}`);
  return index;
}
