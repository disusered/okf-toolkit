import assert from "node:assert/strict";
import test from "node:test";

import type {
  AnalyzedDocument,
  AnalyzedLink,
  BundleAnalysis,
  BundleGraphEdge,
  BundleGraphNode,
} from "okf-contracts";

import { toVisualizationGraph } from "../src/index.js";

const POSITION = { line: 1, column: 1, offset: 0 } as const;
const RANGE = { start: POSITION, end: POSITION } as const;

function link(href: string, resolvedPath: string): AnalyzedLink {
  return {
    href,
    text: resolvedPath,
    kind: "internal",
    resolvedPath,
    fragment: null,
    exists: true,
    range: RANGE,
  };
}

function document(
  path: string,
  title: string,
  type: string,
  body: string,
  links: readonly AnalyzedLink[] = [],
): AnalyzedDocument {
  return {
    path,
    id: path === "index.md" ? null : path.slice(0, -3),
    kind: path === "index.md" ? "index" : "concept",
    revision: null,
    content: body,
    body,
    bodyStartLine: 1,
    frontmatter: null,
    metadata: {},
    links,
    derived: {
      title,
      type,
      description: `${title} description`,
      status: "stable",
      trustTier: "unverified",
      stale: false,
      staleAfter: null,
      tags: [],
      sources:
        path === "concepts/one.md"
          ? [
              {
                id: null,
                resource: "https://example.com/one",
                title: "Example",
                author: null,
                usageCount: null,
                lastModified: null,
                resolvedPath: null,
                exists: null,
              },
            ]
          : [],
    },
  };
}

function node(path: string, title: string, type: string): BundleGraphNode {
  return {
    id: path,
    path,
    title,
    type,
    description: `${title} description`,
    status: "stable",
    trustTier: "unverified",
    stale: false,
    tags: [],
  };
}

function edge(source: string, target: string, id = "edge"): BundleGraphEdge {
  return { id, source, target, relation: "link" };
}

function analysis(
  documents: readonly AnalyzedDocument[],
  nodes: readonly BundleGraphNode[],
  edges: readonly BundleGraphEdge[],
): BundleAnalysis {
  return {
    schema: "okf.inspect.v1",
    okfVersion: "0.2",
    documents,
    graph: { nodes, edges },
    diagnostics: { core: [], guidance: [], profile: [] },
    summary: {
      documents: documents.length,
      concepts: documents.filter((entry) => entry.kind === "concept").length,
      indexes: documents.filter((entry) => entry.kind === "index").length,
      logs: 0,
      errors: 0,
      warnings: 0,
    },
  };
}

const INDEX = document(
  "index.md",
  "Bundle index",
  "Index",
  "# Bundle index\n\nRead [one](concepts/one.md).\n",
  [link("concepts/one.md", "concepts/one.md")],
);
const ONE = document(
  "concepts/one.md",
  "One",
  "Concept",
  "# One\n\nBack to [index](../index.md).\n",
  [link("../index.md", "index.md")],
);
const BUNDLE = analysis(
  [INDEX, ONE],
  [node("index.md", "Bundle index", "Index"), node("concepts/one.md", "One", "Concept")],
  [edge("index.md", "concepts/one.md", "a"), edge("concepts/one.md", "index.md", "b")],
);
function signalNode(
  path: string,
  overrides: Partial<BundleGraphNode>,
): BundleGraphNode {
  return { ...node(path, path, "Concept"), ...overrides };
}

function signalDocument(path: string, staleAfter: string | null): AnalyzedDocument {
  const base = document(path, path, "Concept", `# ${path}\n`);
  return { ...base, derived: { ...base.derived, staleAfter } };
}

function provenanceDocument(
  path: string,
  metadata: Record<string, unknown>,
  sources: AnalyzedDocument["derived"]["sources"] = [],
): AnalyzedDocument {
  const base = document(path, path, String(metadata["type"] ?? "Concept"), `# ${path}\n`);
  return {
    ...base,
    metadata: metadata as AnalyzedDocument["metadata"],
    derived: { ...base.derived, staleAfter: null, sources },
  };
}

test("projects canonical analysis without parsing OKF again", () => {
  const graph = toVisualizationGraph(BUNDLE);
  assert.deepEqual(
    graph.nodes.map((entry) => entry.path),
    ["concepts/one.md", "index.md"],
  );
  assert.deepEqual(graph.types, ["Concept", "Index"]);
  assert.deepEqual(graph.nodes[0]?.sources, [
    {
      id: null,
      resource: "https://example.com/one",
      title: "Example",
      author: null,
      usageCount: null,
      lastModified: null,
      resolvedPath: null,
      exists: null,
    },
  ]);
  assert.deepEqual(graph.nodes[1]?.links, [
    { href: "concepts/one.md", target: "concepts/one.md", pending: false },
  ]);

  const proseOnly = analysis(
    [document("index.md", "Index", "Index", "[not analyzed](concepts/one.md)")],
    [node("index.md", "Index", "Index")],
    [],
  );
  assert.deepEqual(toVisualizationGraph(proseOnly).edges, []);
  assert.deepEqual(toVisualizationGraph(proseOnly).nodes[0]?.links, []);
});

test("trust signals reach the projection instead of being discarded", () => {
  const documents = [signalDocument("concepts/a.md", "2026-01-01")];
  const nodes = [signalNode("concepts/a.md", {
    trustTier: "human-reviewed",
    stale: true,
    tags: ["vendor-limits", "pricing"],
    status: "stable",
  })];
  const graph = toVisualizationGraph(analysis(documents, nodes, []));
  const projected = graph.nodes.find((entry) => entry.path === "concepts/a.md");

  assert.equal(projected?.trustTier, "human-reviewed");
  assert.equal(projected?.stale, true);
  assert.equal(projected?.staleAfter, "2026-01-01");
  assert.deepEqual(projected?.tags, ["vendor-limits", "pricing"]);
  assert.equal(projected?.pending, false);
});

test("trust facets are ranked, and other facets sorted, over authored pages only", () => {
  const documents = [
    signalDocument("concepts/a.md", null),
    signalDocument("concepts/b.md", null),
  ];
  const nodes = [
    signalNode("concepts/a.md", { trustTier: "unverified", status: "draft", tags: ["z", "a"] }),
    signalNode("concepts/b.md", { trustTier: "human-reviewed", status: "stable", tags: ["a"] }),
  ];
  const graph = toVisualizationGraph(analysis(documents, nodes, []));

  // Trust is ordinal, so it is ranked rather than alphabetised.
  assert.deepEqual(graph.trustTiers, ["human-reviewed", "unverified"]);
  assert.deepEqual(graph.statuses, ["draft", "stable"]);
  assert.deepEqual(graph.tags, ["a", "z"]);
});

test("a link to an unwritten page becomes a pending node rather than vanishing", () => {
  // href and resolvedPath deliberately differ. An earlier version keyed the pending node on
  // href, which this fixture catches and an href === resolvedPath fixture cannot.
  const unwritten: AnalyzedLink = {
    href: "../concepts/later.md",
    text: "later",
    kind: "internal",
    resolvedPath: "concepts/later.md",
    fragment: null,
    exists: false,
    range: RANGE,
  };
  const base = document("concepts/a.md", "A", "Concept", "# A\n", [unwritten]);
  const graph = toVisualizationGraph(
    analysis([{ ...base, derived: { ...base.derived, staleAfter: null } }],
      [signalNode("concepts/a.md", {})], []),
  );

  const pending = graph.nodes.find((entry) => entry.pending);
  assert.equal(pending?.path, "concepts/later.md", "pending node keys on the resolved path");
  assert.equal(pending?.id, "pending:concepts/later.md");
  assert.equal(pending?.type, "Pending");
  // Nobody wrote it, so it claims neither a type shape nor an author.
  assert.equal(pending?.shape, "ellipse");
  assert.equal(pending?.authorKind, "unknown");
  assert.ok(graph.edges.some((entry) => entry.relation === "pending"));
  // The pending placeholder must not pollute the authored facets.
  assert.ok(!graph.types.includes("Pending"));
});

test("who wrote a page and who checked it survive into the projection", () => {
  const documents = [provenanceDocument("concepts/a.md", {
    type: "Concept",
    generated: { by: "reference_agent/gemini-2.5-pro", at: "2026-06-30T14:00:00Z" },
    verified: [
      { by: "human:carlos", at: "2026-07-01T09:00:00Z" },
      { by: "process:finance-nightly", at: "2026-08-15T02:00:00Z" },
    ],
    usage_window: { from: "2026-06-01", to: "2026-06-30" },
    resource: "https://example.com/canonical",
  })];
  const graph = toVisualizationGraph(analysis(documents, [signalNode("concepts/a.md", {})], []));
  const projected = graph.nodes[0];

  assert.deepEqual(projected?.generated, {
    by: "reference_agent/gemini-2.5-pro",
    at: "2026-06-30T14:00:00Z",
  });
  assert.equal(projected?.verified.length, 2);
  assert.deepEqual(projected?.verified.map((entry) => entry.by), [
    "human:carlos",
    "process:finance-nightly",
  ]);
  // The timestamps are what answer "how recently", and were previously never read at all.
  assert.equal(projected?.verified[1]?.at, "2026-08-15T02:00:00Z");
  assert.deepEqual(projected?.usageWindow, { from: "2026-06-01", to: "2026-06-30" });
  assert.equal(projected?.resource, "https://example.com/canonical");
});

test("a single check written without the list syntax becomes a one-element list", () => {
  // The spec: consumers MUST treat a bare mapping as a one-element list.
  const documents = [provenanceDocument("concepts/a.md", {
    type: "Concept",
    verified: { by: "human:carlos", at: "2026-08-31T12:00:00Z" },
  })];
  const graph = toVisualizationGraph(analysis(documents, [signalNode("concepts/a.md", {})], []));
  assert.deepEqual(graph.nodes[0]?.verified, [
    { by: "human:carlos", at: "2026-08-31T12:00:00Z" },
  ]);
});

test("a page nobody checked reports no events rather than an absent field", () => {
  const documents = [provenanceDocument("concepts/a.md", { type: "Concept" })];
  const graph = toVisualizationGraph(analysis(documents, [signalNode("concepts/a.md", {})], []));
  assert.deepEqual(graph.nodes[0]?.verified, []);
  assert.equal(graph.nodes[0]?.generated, null);
});

test("every credibility signal on a source survives, and an untitled source stays untitled", () => {
  const documents = [provenanceDocument("concepts/a.md", { type: "Concept" }, [
    {
      id: "policy",
      resource: "https://example.com/policy",
      title: "Revenue policy",
      author: "human:jordi",
      usageCount: 5000,
      lastModified: "2026-06-15",
      resolvedPath: null,
      exists: null,
    },
    {
      id: null,
      resource: "https://example.com/plain",
      title: null,
      author: null,
      usageCount: null,
      lastModified: null,
      resolvedPath: null,
      exists: null,
    },
  ])];
  const graph = toVisualizationGraph(analysis(documents, [signalNode("concepts/a.md", {})], []));
  const [plain, policy] = graph.nodes[0]!.sources;

  assert.equal(policy?.id, "policy");
  assert.equal(policy?.author, "human:jordi");
  assert.equal(policy?.usageCount, 5000);
  assert.equal(policy?.lastModified, "2026-06-15");
  // Previously the title defaulted to the resource, so "no title" was unrecoverable.
  assert.equal(plain?.title, null);
});

test("the sanctioned computation is projected only for that page type", () => {
  const contract = {
    runtime: "bigquery",
    parameters: [{ name: "year", type: "integer", required: true }],
    computation: "references/revenue.sql",
    executor: { resource: "references/run-on-bq.md", receipt: ["job_id", "executed_sql"] },
    attester: { resource: "references/attest.py" },
  };

  const attested = toVisualizationGraph(analysis(
    [provenanceDocument("concepts/c.md", { type: "Attested Computation", ...contract })],
    [signalNode("concepts/c.md", { type: "Attested Computation" })], [],
  )).nodes[0]?.attestation;

  assert.equal(attested?.runtime, "bigquery");
  assert.deepEqual(attested?.parameters, [{ name: "year", type: "integer", required: true }]);
  assert.equal(attested?.computation, "references/revenue.sql");
  assert.equal(attested?.executorResource, "references/run-on-bq.md");
  assert.deepEqual(attested?.executorReceipt, ["job_id", "executed_sql"]);
  assert.equal(attested?.attesterResource, "references/attest.py");

  // The same frontmatter on an ordinary concept carries no computation contract.
  const ordinary = toVisualizationGraph(analysis(
    [provenanceDocument("concepts/d.md", { type: "Concept", ...contract })],
    [signalNode("concepts/d.md", {})], [],
  )).nodes[0]?.attestation;
  assert.equal(ordinary, null);
});

test("who wrote a page is classified from the actor grammar, never guessed", () => {
  const expected: readonly (readonly [Record<string, unknown> | null, string])[] = [
    [{ by: "human:carlos", at: "2026-08-01T10:00:00Z" }, "human"],
    [{ by: "process:nightly", at: "2026-08-01T10:00:00Z" }, "process"],
    [{ by: "agent/1.0", at: "2026-08-01T10:00:00Z" }, "agent"],
    [null, "unknown"],
    // A bare name fits none of the three shapes, so it stays unknown rather than reading
    // as a person. Claiming a human wrote something is the one error worth refusing to make.
    [{ by: "carlos" }, "unknown"],
  ];

  for (const [generated, authorKind] of expected) {
    const metadata: Record<string, unknown> = { type: "Concept" };
    if (generated) metadata["generated"] = generated;
    const graph = toVisualizationGraph(analysis(
      [provenanceDocument("concepts/a.md", metadata)],
      [signalNode("concepts/a.md", {})],
      [],
    ));
    assert.equal(graph.nodes[0]?.authorKind, authorKind, JSON.stringify(generated));
  }
});
