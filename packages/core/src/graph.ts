import type {
  AnalyzedDocument,
  BundleGraph,
  BundleGraphEdge,
  BundleGraphNode,
} from "okf-contracts";

import { byCodePoint } from "./paths.js";

/**
 * Project a bundle onto its graph.
 *
 * Indexes are included. They carry no frontmatter, so they have nothing to say about their own
 * type or trust, but their links are authored: somebody wrote each entry, grouped it under a
 * heading, and described it. Dropping them dropped the spine of a bundle and drew the rest as
 * unrelated islands — a picture that asserts the opposite of what the bundle says.
 *
 * Logs stay out. A log is a dated history of changes to a scope, so its links point at what
 * happened rather than at what relates to what.
 */
export function buildGraph(documents: readonly AnalyzedDocument[]): BundleGraph {
  const linked = documents
    .filter((document) => document.kind === "concept" || document.kind === "index")
    .sort((left, right) => byCodePoint(left.path, right.path));
  const known = new Set(linked.map((document) => document.path));
  const nodes: BundleGraphNode[] = linked.map((document) => ({
    id: document.path,
    path: document.path,
    title: document.derived.title,
    // An index declares no type. Naming it one keeps the vocabulary honest and lets a reader
    // tell a table of contents from a claim.
    type: document.derived.type ?? (document.kind === "index" ? "Index" : "Concept"),
    description: document.derived.description,
    status: document.derived.status,
    trustTier: document.derived.trustTier,
    stale: document.derived.stale,
    tags: document.derived.tags,
  }));

  const relations = new Map<string, Omit<BundleGraphEdge, "id">>();
  for (const document of linked) {
    for (const link of document.links) {
      if (link.kind !== "internal" || link.resolvedPath === null || !known.has(link.resolvedPath)) {
        continue;
      }
      const key = `${document.path}\u0000${link.resolvedPath}\u0000link`;
      relations.set(key, { source: document.path, target: link.resolvedPath, relation: "link" });
    }
    for (const source of document.derived.sources) {
      if (source.resolvedPath === null || !known.has(source.resolvedPath)) {
        continue;
      }
      const key = `${document.path}\u0000${source.resolvedPath}\u0000source`;
      relations.set(key, { source: document.path, target: source.resolvedPath, relation: "source" });
    }
  }

  const edges = [...relations.values()]
    .sort(
      (left, right) =>
        byCodePoint(left.source, right.source) ||
        byCodePoint(left.target, right.target) ||
        byCodePoint(left.relation, right.relation),
    )
    .map((edge, index): BundleGraphEdge => ({ id: `e${index}`, ...edge }));
  return { nodes, edges };
}
