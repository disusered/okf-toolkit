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
 * Reserved indexes provide navigation and logs record history. Neither declares semantic
 * relationships between concepts; those relationships come from the concept documents.
 */
export function buildGraph(documents: readonly AnalyzedDocument[]): BundleGraph {
  const linked = documents
    .filter((document) => document.kind === "concept")
    .sort((left, right) => byCodePoint(left.path, right.path));
  const known = new Set(linked.map((document) => document.path));
  const nodes: BundleGraphNode[] = linked.map((document) => ({
    id: document.path,
    path: document.path,
    title: document.derived.title,
    type: document.derived.type ?? "Concept",
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
