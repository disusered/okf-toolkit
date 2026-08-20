import type {
  AnalyzedDocument,
  BundleAnalysis,
  BundleGraphEdge,
  BundleGraphNode,
} from "okf-contracts";

/** A source shown in the reader panel. */
export interface VisualizationSource {
  readonly title: string;
  readonly resource: string;
}

/** One already-resolved in-bundle link. */
export interface VisualizationLink {
  readonly href: string;
  readonly target: string;
}

export interface VisualizationNode {
  /** Canonical graph identity from `okf.inspect.v1`. */
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly type: string;
  readonly description: string;
  readonly status: string;
  readonly sources: readonly VisualizationSource[];
  readonly links: readonly VisualizationLink[];
  readonly body: string;
  readonly color: string;
  readonly size: number;
}

export interface VisualizationEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: "link" | "source";
}

export interface VisualizationGraph {
  readonly nodes: readonly VisualizationNode[];
  readonly edges: readonly VisualizationEdge[];
  readonly types: readonly string[];
}

const PALETTE = [
  "#2563eb",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#db2777",
  "#0891b2",
  "#65a30d",
  "#e11d48",
  "#4f46e5",
  "#0f766e",
] as const;
const FALLBACK_COLOR = "#64748b";

/** Code-point ordering is deterministic across hosts; locale ordering is not. */
function byCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function documentsByPath(
  documents: readonly AnalyzedDocument[],
): ReadonlyMap<string, AnalyzedDocument> {
  return new Map(documents.map((document) => [document.path, document]));
}

function linksOf(document: AnalyzedDocument | undefined): VisualizationLink[] {
  if (!document) {
    return [];
  }

  const links: VisualizationLink[] = [];
  const seen = new Set<string>();
  for (const link of document.links) {
    if (
      link.kind !== "internal" ||
      !link.exists ||
      link.resolvedPath === null ||
      seen.has(link.href)
    ) {
      continue;
    }
    seen.add(link.href);
    links.push({ href: link.href, target: link.resolvedPath });
  }
  return links;
}

function sourcesOf(document: AnalyzedDocument | undefined): VisualizationSource[] {
  if (!document) {
    return [];
  }
  return document.derived.sources
    .map((source) => ({
      title: source.title?.trim() || source.resource,
      resource: source.resource,
    }))
    .sort((left, right) =>
      byCodePoint(`${left.resource}\u0000${left.title}`, `${right.resource}\u0000${right.title}`),
    );
}

function compareNodes(left: BundleGraphNode, right: BundleGraphNode): number {
  return byCodePoint(left.path, right.path) || byCodePoint(left.id, right.id);
}

function compareEdges(left: BundleGraphEdge, right: BundleGraphEdge): number {
  return (
    byCodePoint(left.source, right.source) ||
    byCodePoint(left.target, right.target) ||
    byCodePoint(left.relation, right.relation) ||
    byCodePoint(left.id, right.id)
  );
}

/**
 * Prepare browser display data from a canonical full-bundle analysis.
 *
 * Parsing and path resolution belong to `okf-core`; the visualizer only projects its result.
 */
export function toVisualizationGraph(analysis: BundleAnalysis): VisualizationGraph {
  const documentByPath = documentsByPath(analysis.documents);
  const orderedNodes = [...analysis.graph.nodes].sort(compareNodes);
  const knownIds = new Set(orderedNodes.map((node) => node.id));
  const types = [...new Set(orderedNodes.map((node) => node.type))].sort(byCodePoint);
  const colors = new Map(
    types.map((type, index) => [type, PALETTE[index % PALETTE.length] ?? FALLBACK_COLOR]),
  );

  const nodes = orderedNodes.map((node): VisualizationNode => {
    const document = documentByPath.get(node.path);
    const body = document?.body ?? "";
    return {
      id: node.id,
      path: node.path,
      title: node.title,
      type: node.type,
      description: node.description ?? "",
      status: node.status,
      sources: sourcesOf(document),
      links: linksOf(document),
      body,
      color: colors.get(node.type) ?? FALLBACK_COLOR,
      size: 26 + Math.min(40, Math.floor(body.length / 300)),
    };
  });

  const seen = new Set<string>();
  const edges: VisualizationEdge[] = [];
  for (const edge of [...analysis.graph.edges].sort(compareEdges)) {
    if (
      edge.source === edge.target ||
      !knownIds.has(edge.source) ||
      !knownIds.has(edge.target)
    ) {
      continue;
    }
    const key = `${edge.source}\u0000${edge.target}\u0000${edge.relation}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    edges.push({
      id: `e${edges.length}`,
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
    });
  }

  return { nodes, edges, types };
}
