import type {
  AnalyzedDocument,
  BundleAnalysis,
  BundleGraphEdge,
  BundleGraphNode,
  TrustTier,
} from "okf-contracts";

/**
 * A source shown in the reader panel, carrying the credibility signals OKF records so a
 * reader can judge the concept by judging what it came from. `title` stays null when the
 * source has none, so an untitled source is distinguishable from one named after its URL.
 */
export interface VisualizationSource {
  readonly id: string | null;
  readonly resource: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly usageCount: number | null;
  readonly lastModified: string | null;
  /** Bundle path when the resource points inside the bundle, else null. */
  readonly resolvedPath: string | null;
  /** False when an in-bundle resource names a page nobody has written. */
  readonly exists: boolean | null;
}

/** One recorded act: who did it and when. Used for both `generated` and `verified`. */
export interface VisualizationActorEvent {
  readonly by: string;
  readonly at: string | null;
}

/** The period a source `usage_count` was measured over. */
export interface VisualizationUsageWindow {
  readonly from: string | null;
  readonly to: string | null;
}

/** The contract fields of an `Attested Computation` concept. */
export interface VisualizationAttestation {
  readonly runtime: string | null;
  readonly parameters: readonly { readonly name: string; readonly type: string | null; readonly required: boolean | null }[];
  readonly computation: string | null;
  readonly executorResource: string | null;
  readonly executorReceipt: readonly string[];
  readonly attesterResource: string | null;
}

/**
 * One in-bundle link, always carrying the canonical Bundle-relative target `okf-core`
 * resolved. `pending` marks a target nobody has written yet, which OKF treats as work still
 * to do rather than a broken reference.
 */
export interface VisualizationLink {
  readonly href: string;
  readonly target: string;
  readonly pending: boolean;
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
  /** Who produced the current content, from `generated`. */
  readonly generated: VisualizationActorEvent | null;
  /** Every recorded check, newest last. `trustTier` is the conclusion drawn from these. */
  readonly verified: readonly VisualizationActorEvent[];
  /** The period every source `usageCount` was measured over. */
  readonly usageWindow: VisualizationUsageWindow | null;
  /** The concept's own canonical URI, when it names one. */
  readonly resource: string | null;
  readonly attestation: VisualizationAttestation | null;
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
    // The resolved path is what identifies it, so two pages linking to the same unwritten
    // page by different relative hrefs converge on one node.
    links.push({ href: link.href, target: link.resolvedPath, pending: !link.exists });
  }
  return links;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapping(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/**
 * Read a list of recorded acts. The spec allows a single event to be written as a bare
 * mapping without the list dash and requires consumers to treat it as a one-element list.
 */
function actorEvents(value: unknown): VisualizationActorEvent[] {
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const events: VisualizationActorEvent[] = [];
  for (const entry of entries) {
    const record = mapping(entry);
    const by = record && text(record["by"]);
    if (!by) continue;
    events.push({ by, at: record ? text(record["at"]) : null });
  }
  return events;
}

function usageWindowOf(value: unknown): VisualizationUsageWindow | null {
  const record = mapping(value);
  if (!record) return null;
  const from = text(record["from"]);
  const to = text(record["to"]);
  return from === null && to === null ? null : { from, to };
}

/** Present only for a concept whose type is `Attested Computation`. */
function attestationOf(
  metadata: Readonly<Record<string, unknown>>,
): VisualizationAttestation | null {
  if (metadata["type"] !== "Attested Computation") return null;
  const executor = mapping(metadata["executor"]);
  const receipt = executor && Array.isArray(executor["receipt"]) ? executor["receipt"] : [];
  const rawParameters = Array.isArray(metadata["parameters"]) ? metadata["parameters"] : [];
  return {
    runtime: text(metadata["runtime"]),
    parameters: rawParameters.flatMap((entry) => {
      const record = mapping(entry);
      const name = record && text(record["name"]);
      if (!name) return [];
      return [{
        name,
        type: record ? text(record["type"]) : null,
        required: record && typeof record["required"] === "boolean" ? record["required"] : null,
      }];
    }),
    computation: text(metadata["computation"]),
    executorResource: executor ? text(executor["resource"]) : null,
    executorReceipt: receipt.flatMap((entry) => {
      const value = text(entry);
      return value ? [value] : [];
    }),
    attesterResource: text(mapping(metadata["attester"])?.["resource"]),
  };
}

function sourcesOf(document: AnalyzedDocument | undefined): VisualizationSource[] {
  if (!document) {
    return [];
  }
  return document.derived.sources
    .map((source) => ({
      id: source.id,
      resource: source.resource,
      title: source.title?.trim() || null,
      author: source.author,
      usageCount: source.usageCount,
      lastModified: source.lastModified,
      resolvedPath: source.resolvedPath,
      exists: source.exists,
    }))
    .sort((left, right) =>
      byCodePoint(`${left.resource}\u0000${left.title ?? ""}`, `${right.resource}\u0000${right.title ?? ""}`),
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
      generated: actorEvents(document?.metadata["generated"])[0] ?? null,
      verified: actorEvents(document?.metadata["verified"]),
      usageWindow: usageWindowOf(document?.metadata["usage_window"]),
      resource: text(document?.metadata["resource"]),
      attestation: document ? attestationOf(document.metadata) : null,
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
  const byPath = new Set(nodes.map((node) => node.path));
  const pendingPaths = new Set<string>();
  for (const node of nodes) {
    for (const link of node.links) {
      if (link.pending && !byPath.has(link.target)) {
        pendingPaths.add(link.target);
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
    generated: null,
    verified: [],
    usageWindow: null,
    resource: null,
    attestation: null,
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
      if (!link.pending) continue;
      const target = `pending:${link.target}`;
      if (!pendingPaths.has(link.target)) continue;
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
