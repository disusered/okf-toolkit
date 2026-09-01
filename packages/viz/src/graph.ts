import type {
  AnalyzedDocument,
  BundleAnalysis,
  BundleGraphEdge,
  BundleGraphNode,
  TrustTier,
} from "okf-contracts";

/** A source shown in the reader panel. */
export interface VisualizationSource {
  readonly title: string;
  readonly resource: string;
}

/**
 * One in-bundle link. `target` is null when the page it points at is not written yet, which
 * OKF treats as pending work rather than a broken reference.
 */
export interface VisualizationLink {
  readonly href: string;
  readonly target: string | null;
}

export interface VisualizationNode {
  /** Canonical graph identity from `okf.inspect.v1`. */
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly type: string;
  readonly description: string;
  readonly status: string;
  /** Derived from `verified` by okf-core; the viz never re-derives it. */
  readonly trustTier: TrustTier;
  /** Null when the caller supplied no evaluation date, or the page declares no `stale_after`. */
  readonly stale: boolean | null;
  readonly staleAfter: string | null;
  readonly tags: readonly string[];
  readonly sources: readonly VisualizationSource[];
  readonly links: readonly VisualizationLink[];
  readonly body: string;
  readonly color: string;
  readonly size: number;
  /** True for a placeholder standing in for a page a link points at but nobody has written. */
  readonly pending: boolean;
}

export interface VisualizationEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: "link" | "source" | "pending";
}

export interface VisualizationGraph {
  readonly nodes: readonly VisualizationNode[];
  readonly edges: readonly VisualizationEdge[];
  readonly types: readonly string[];
  /** Facets present in this bundle, so the page can hide a filter that would have one option. */
  readonly trustTiers: readonly TrustTier[];
  readonly statuses: readonly string[];
  readonly tags: readonly string[];
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
const PENDING_COLOR = "#94a3b8";

/** Trust is ordinal, so its filter is ranked rather than sorted by code point. */
const TRUST_RANK: readonly TrustTier[] = ["human-reviewed", "machine-confirmed", "unverified"];

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
    if (link.kind !== "internal" || link.resolvedPath === null || seen.has(link.href)) {
      continue;
    }
    seen.add(link.href);
    // A target that does not exist yet is kept, not dropped. OKF treats it as knowledge
    // pending to be written, and the page renders it as the bundle's own to-do list.
    links.push({ href: link.href, target: link.exists ? link.resolvedPath : null });
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
      trustTier: node.trustTier,
      stale: node.stale,
      // `staleAfter` is on the document's derived fields rather than the graph node.
      staleAfter: document?.derived.staleAfter ?? null,
      tags: node.tags,
      sources: sourcesOf(document),
      links: linksOf(document),
      body,
      color: colors.get(node.type) ?? FALLBACK_COLOR,
      size: 26 + Math.min(40, Math.floor(body.length / 300)),
      pending: false,
    };
  });

  // A link whose target nobody has written yet becomes a placeholder node, so the graph shows
  // the work the bundle has given itself instead of silently dropping the edge.
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const pendingPaths = new Set<string>();
  for (const node of nodes) {
    for (const link of node.links) {
      if (link.target === null && !byPath.has(link.href)) {
        pendingPaths.add(link.href);
      }
    }
  }
  const pendingNodes = [...pendingPaths].sort(byCodePoint).map((path): VisualizationNode => ({
    id: `pending:${path}`,
    path,
    title: path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path,
    type: "Pending",
    description: "This page is linked to but has not been written yet.",
    status: "",
    trustTier: "unverified",
    stale: null,
    staleAfter: null,
    tags: [],
    sources: [],
    links: [],
    body: "",
    color: PENDING_COLOR,
    size: 20,
    pending: true,
  }));

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

  for (const node of nodes) {
    for (const link of node.links) {
      if (link.target !== null) continue;
      const target = `pending:${link.href}`;
      if (!pendingPaths.has(link.href)) continue;
      const key = `${node.id}\u0000${target}\u0000pending`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: `e${edges.length}`, source: node.id, target, relation: "pending" });
    }
  }

  const allNodes = [...nodes, ...pendingNodes];
  const trustTiers = TRUST_RANK.filter((tier) =>
    nodes.some((node) => node.trustTier === tier));
  const statuses = [...new Set(nodes.map((node) => node.status).filter(Boolean))].sort(byCodePoint);
  const tags = [...new Set(nodes.flatMap((node) => node.tags))].sort(byCodePoint);

  return { nodes: allNodes, edges, types, trustTiers, statuses, tags };
}
