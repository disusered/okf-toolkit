import assert from "node:assert/strict";
import test from "node:test";

import type {
  AnalyzedDocument,
  AnalyzedLink,
  BundleAnalysis,
  BundleGraphEdge,
  BundleGraphNode,
} from "okf-contracts";

import { generateVisualization, GeneratorError, toVisualizationGraph } from "../src/index.js";
import { PAGE_SCRIPT } from "../src/page/script.js";
import { PAGE_STYLE } from "../src/page/style.js";

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

test("preserves canonical graph relations and distinguishes source edges", () => {
  const sourceEdge: BundleGraphEdge = {
    id: "source",
    source: "index.md",
    target: "concepts/one.md",
    relation: "source",
  };
  const graph = toVisualizationGraph({
    ...BUNDLE,
    graph: { ...BUNDLE.graph, edges: [sourceEdge] },
  });
  assert.deepEqual(graph.edges, [
    {
      id: "e0",
      source: "index.md",
      target: "concepts/one.md",
      relation: "source",
      attested: false,
    },
  ]);
  assert.match(
    generateVisualization({
      bundle: "handbook",
      analysis: { ...BUNDLE, graph: { ...BUNDLE.graph, edges: [sourceEdge] } },
    }),
    /edge\[relation = "source"\]/,
  );
});

test("same analysis generates byte-identical output", () => {
  const first = generateVisualization({ bundle: "handbook", analysis: BUNDLE });
  const second = generateVisualization({ bundle: "handbook", analysis: BUNDLE });
  assert.equal(first, second);
  assert.equal(/\b20\d\d-\d\d-\d\dT\d\d:/.test(first), false);
});

test("input collection order does not affect generated bytes", () => {
  const shuffled = analysis(
    [ONE, INDEX],
    [...BUNDLE.graph.nodes].reverse(),
    [...BUNDLE.graph.edges].reverse(),
  );
  assert.equal(
    generateVisualization({ bundle: "handbook", analysis: BUNDLE }),
    generateVisualization({ bundle: "handbook", analysis: shuffled }),
  );
});

test("page is self-contained and its CSP names no origin", () => {
  const html = generateVisualization({ bundle: "handbook", analysis: BUNDLE });
  assert.equal(/<script[^>]+\bsrc=/i.test(html), false);
  assert.equal(/<link[^>]+\bhref=/i.test(html), false);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /cytoscape 3\./i);
  assert.match(html, /marked 18\./i);
  assert.match(html, /DOMPurify 3\./i);
});

test("stored content cannot end the JSON script element", () => {
  const hostileDocument = document(
    "index.md",
    "</script><script>alert(1)</script>",
    "Index",
    "<img src=x onerror=alert(2)>\n</script><script>alert(3)</script>",
  );
  const hostile = analysis(
    [hostileDocument],
    [node("index.md", hostileDocument.derived.title, "Index")],
    [],
  );
  const html = generateVisualization({ bundle: "hostile", analysis: hostile });

  assert.equal(html.match(/<\/script>/g)?.length, 5);
  const match = /<script id="okf-graph" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match);
  const payload = match[1] ?? "";
  assert.equal(payload.includes("<"), false);
  assert.match(payload, /\\u003c\/script\\u003e\\u003cscript\\u003ealert\(1\)/);
  assert.equal(JSON.parse(payload).graph.nodes[0].title, hostileDocument.derived.title);
});

test("browser behavior renders with Marked then sanitizes with DOMPurify", () => {
  const marked = PAGE_SCRIPT.indexOf("marked.parse");
  const sanitized = PAGE_SCRIPT.indexOf("DOMPurify.sanitize");
  const assignment = PAGE_SCRIPT.indexOf("container.innerHTML = DOMPurify.sanitize");
  assert.ok(marked >= 0);
  assert.ok(sanitized > marked);
  assert.equal(assignment, sanitized - "container.innerHTML = ".length);
  assert.match(PAGE_SCRIPT, /FORBID_TAGS: \["img", "form", "input", "textarea", "select", "style"\]/);
  assert.match(PAGE_SCRIPT, /FORBID_ATTR: \["style"\]/);
  assert.equal((PAGE_SCRIPT.match(/\.innerHTML\s*=/g) ?? []).length, 1);
});

test("unknown analysis schema is rejected", () => {
  const unsupported = { ...BUNDLE, schema: "okf.inspect.v2" } as unknown as BundleAnalysis;
  assert.throws(
    () => generateVisualization({ bundle: "handbook", analysis: unsupported }),
    (error: unknown) => error instanceof GeneratorError && /unsupported analysis schema/.test(error.message),
  );
});

/** A node with explicit trust signals, for the projection tests below. */
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

test("omitting evaluatedAt leaves the page reproducible from the bundle alone", () => {
  const documents = [signalDocument("concepts/a.md", null)];
  const html = generateVisualization({
    bundle: "b",
    analysis: analysis(documents, [signalNode("concepts/a.md", {})], []),
  });
  // The page script always contains the label literal; what matters is the payload it reads.
  assert.match(html, /"evaluatedAt":null/);
  assert.match(html, /<span class="muted" id="evaluated"><\/span>/);
});

test("evaluatedAt must be a real calendar date", () => {
  const documents = [signalDocument("concepts/a.md", null)];
  const input = analysis(documents, [signalNode("concepts/a.md", {})], []);
  for (const bad of ["2026-8-31", "2026-02-30", "2026-08-31T00:00:00Z", "nonsense"]) {
    assert.throws(
      () => generateVisualization({ bundle: "b", analysis: input, evaluatedAt: bad }),
      GeneratorError,
      bad,
    );
  }
});

test("dating the page without dating the analysis is refused", () => {
  // stale_after present but every verdict null means the caller forgot analyzeBundle({today}).
  const documents = [signalDocument("concepts/a.md", "2026-01-01")];
  const nodes = [signalNode("concepts/a.md", { stale: null })];
  assert.throws(
    () => generateVisualization({
      bundle: "b",
      analysis: analysis(documents, nodes, []),
      evaluatedAt: "2026-08-31",
    }),
    /not evaluated against a date/,
  );
});

test("the same triple always produces the same bytes", () => {
  const documents = [signalDocument("concepts/a.md", "2026-01-01")];
  const nodes = [signalNode("concepts/a.md", { stale: true })];
  const input = { bundle: "b", analysis: analysis(documents, nodes, []), evaluatedAt: "2026-08-31" };
  assert.equal(generateVisualization(input), generateVisualization(input));
  // The date is an input, so changing it is expected to change the bytes.
  assert.notEqual(
    generateVisualization(input),
    generateVisualization({ ...input, evaluatedAt: "2026-09-01" }),
  );
});

test("the reader is laid out beside the graph and can still scroll", () => {
  const documents = [signalDocument("concepts/a.md", null)];
  const html = generateVisualization({
    bundle: "b",
    analysis: analysis(documents, [signalNode("concepts/a.md", {})], []),
  });
  assert.ok(html.indexOf('id="graph"') < html.indexOf('id="split"'));
  assert.ok(html.indexOf('id="split"') < html.indexOf('id="detail"'));
  assert.match(html, /main \{ display: flex; flex-direction: row;/);
  // The graph draws type, authorship and trust; it still carries no legend row, because the
  // reader's metadata table is where a signal gets named in words rather than in a key.
  assert.ok(!html.includes('id="legend"'), "no legend row");
  assert.match(html, /selector: "node\.author-human"/);
  assert.match(html, /selector: "node\.unchecked"/);
  // Cytoscape resolves conflicts by array order and the last rule wins. Stale must therefore
  // follow both fading rules, and every new rule must precede selection and filtering.
  assert.ok(html.indexOf('"node.unchecked"') < html.indexOf('"node.stale"'), "stale beats dimming");
  assert.ok(html.indexOf('"node.deprecated"') < html.indexOf('"node.stale"'), "stale beats dimming");
  assert.ok(html.indexOf('"node.stale"') < html.indexOf('"node:selected"'), "selection still draws");
  assert.ok(html.indexOf('"node:selected"') < html.indexOf('".dim"'), "filtering still draws");
  assert.match(html, /main\[data-orientation="rows"\] \{ flex-direction: column; \}/);
  assert.match(html, /#detail \{[^}]*min-height: 0;[^}]*overflow-y: auto;/s);
});

test("browser storage is guarded and names no origin", () => {
  assert.match(PAGE_SCRIPT, /okf\.viz\.prefs\.v1/);
  assert.match(PAGE_SCRIPT, /try \{[\s\S]*localStorage[\s\S]*catch/);
  assert.ok(!/iteramind|https?:\/\//i.test(PAGE_SCRIPT));
});

test("embedded page sources carry no backtick, which would end their template literal", () => {
  // PAGE_SCRIPT and PAGE_STYLE are String.raw template literals. A backtick anywhere inside
  // them - including in a comment - terminates the literal and produces a syntax error in the
  // built module. That failure surfaces only when the package is imported, so pin it here.
  assert.ok(!PAGE_SCRIPT.includes("`"), "PAGE_SCRIPT must contain no backtick");
  assert.ok(!PAGE_STYLE.includes("`"), "PAGE_STYLE must contain no backtick");
});

test("the built page module imports cleanly", async () => {
  // A regression that only appears on import would otherwise pass every other assertion here.
  const module = await import("../src/page/script.js");
  assert.equal(typeof module.PAGE_SCRIPT, "string");
});

/** A document whose raw frontmatter carries the provenance families. */
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

test("the panel offers a verification row and a computation section", () => {
  const documents = [provenanceDocument("concepts/a.md", { type: "Concept" })];
  const html = generateVisualization({
    bundle: "b",
    analysis: analysis(documents, [signalNode("concepts/a.md", {})], []),
  });
  assert.match(html, /id="detail-verified"/);
  assert.match(html, /id="detail-generated"/);
  assert.match(html, /id="detail-computation"/);
  // The collapsed one-word row it replaced is gone.
  assert.ok(!html.includes('id="detail-trust"'));
});

test("each type gets its own shape, and an unmapped type falls back to an ellipse", () => {
  const expected: readonly (readonly [string, string])[] = [
    ["Attested Computation", "star"],
    ["Decision", "diamond"],
    ["Policy", "hexagon"],
    ["Runbook", "round-rectangle"],
    ["Guide", "rhomboid"],
    ["Project", "tag"],
    // The one-word spelling folds onto the same key, rather than drifting to a second shape.
    ["ProjectBrief", "tag"],
    ["Concept", "ellipse"],
    ["Organization", "pentagon"],
    ["Service", "barrel"],
    ["Metric", "triangle"],
    ["Index", "octagon"],
    // Nothing in the map: the neutral ellipse, never another type's shape.
    ["Ephemeris", "ellipse"],
  ];

  for (const [type, shape] of expected) {
    const graph = toVisualizationGraph(analysis(
      [provenanceDocument("concepts/a.md", { type })],
      [signalNode("concepts/a.md", { type })],
      [],
    ));
    assert.equal(graph.nodes[0]?.shape, shape, type);
  }

  // The shape is decided in the projection, so the browser reads it rather than deciding it.
  const html = generateVisualization({
    bundle: "b",
    analysis: analysis(
      [provenanceDocument("concepts/c.md", { type: "Attested Computation" })],
      [signalNode("concepts/c.md", { type: "Attested Computation" })],
      [],
    ),
  });
  assert.match(html, /"shape":"star"/);
  assert.match(html, /"shape": "data\(shape\)"/);
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

test("a link to an Attested Computation is drawn as its own kind of edge", () => {
  const documents = [
    provenanceDocument("concepts/a.md", { type: "Concept" }),
    provenanceDocument("concepts/c.md", { type: "Attested Computation" }),
  ];
  const nodes = [
    signalNode("concepts/a.md", {}),
    signalNode("concepts/c.md", { type: "Attested Computation" }),
  ];
  const edges = [
    edge("concepts/a.md", "concepts/c.md", "leans-on"),
    edge("concepts/c.md", "concepts/a.md", "cites-back"),
  ];
  const graph = toVisualizationGraph(analysis(documents, nodes, edges));
  const intoComputation = graph.edges.find((entry) => entry.target === "concepts/c.md");
  const outOfComputation = graph.edges.find((entry) => entry.target === "concepts/a.md");

  assert.equal(intoComputation?.attested, true);
  // Direction is the whole point: leaving the computation is an ordinary link.
  assert.equal(outOfComputation?.attested, false);
  // The flag sits beside the relation rather than replacing it, so a cited computation is
  // still recognisable as a citation.
  assert.equal(intoComputation?.relation, "link");

  const html = generateVisualization({ bundle: "b", analysis: analysis(documents, nodes, edges) });
  assert.match(html, /selector: "edge\.attested"/);
  assert.ok(html.indexOf('"edge.attested"') < html.indexOf('"edge:selected"'));
});

test("hovering a node describes it without taking over the selection", () => {
  assert.match(PAGE_SCRIPT, /cy\.on\("mouseover", "node"/);
  assert.match(PAGE_SCRIPT, /function showHover\(node, rendered\)/);
  // The card is assembled, never parsed: a title that looks like markup stays text.
  assert.match(PAGE_SCRIPT, /hoverCard\.replaceChildren\(\)/);
  assert.ok(!PAGE_SCRIPT.includes("hoverCard.innerHTML"));
  assert.equal((PAGE_SCRIPT.match(/\.innerHTML\s*=/g) ?? []).length, 1);
  // showHover must not select: hovering answers a question, it does not replace the answer
  // the reader is already looking at.
  const hover = PAGE_SCRIPT.slice(PAGE_SCRIPT.indexOf("function showHover"));
  assert.ok(!hover.slice(0, hover.indexOf("cy.on(\"mouseout\"")).includes(".select()"));
});

test("the dated strip ships hidden, above the table it summarises", () => {
  const documents = [provenanceDocument("concepts/a.md", { type: "Concept" })];
  const html = generateVisualization({
    bundle: "b",
    analysis: analysis(documents, [signalNode("concepts/a.md", {})], []),
  });
  assert.match(html, /<section id="detail-timeline"[^>]*\bhidden>/);
  assert.match(html, /id="timeline-marks"/);
  assert.match(html, /id="timeline-overrun"/);
  // The strip belongs with the page identity, above the metadata it condenses.
  assert.ok(html.indexOf('id="detail-path"') < html.indexOf('id="detail-timeline"'));
  assert.ok(html.indexOf('id="detail-timeline"') < html.indexOf("<dl>"));
});

test("a page with no dates leaves the strip with nothing to draw", () => {
  const documents = [provenanceDocument("concepts/a.md", { type: "Concept" })];
  const html = generateVisualization({
    bundle: "b",
    analysis: analysis(documents, [signalNode("concepts/a.md", {})], []),
  });
  // Nothing is dated, so the script finds no event and the markup's hidden attribute stands.
  assert.match(html, /"generated":null/);
  assert.match(html, /"verified":\[\]/);
  assert.match(html, /"staleAfter":null/);
  assert.match(PAGE_SCRIPT, /timelineSection\.hidden = !events\.length;/);
  // An explicit display rule on the section would silently defeat that attribute.
  assert.match(PAGE_STYLE, /#detail-timeline \{ margin: 0 0 18px; \}/);
  assert.match(PAGE_STYLE, /\[hidden\] \{ display: none !important; \}/);
});

test("an expired page draws the overrun between its expiry and the evaluation date", () => {
  const documents = [signalDocument("concepts/a.md", "2026-01-01")];
  const nodes = [signalNode("concepts/a.md", { stale: true })];
  const html = generateVisualization({
    bundle: "b",
    analysis: analysis(documents, nodes, []),
    evaluatedAt: "2026-08-31",
  });
  assert.match(html, /"staleAfter":"2026-01-01"/);
  assert.match(html, /"evaluatedAt":"2026-08-31"/);
  // Geometry: the overrun spans expiry to today, and says how far past in words.
  assert.match(PAGE_SCRIPT, /timelineOverrun\.style\.left = left \+ "%";/);
  assert.match(PAGE_SCRIPT, /timelineOverrun\.hidden = false;/);
  assert.match(PAGE_SCRIPT, /past its stale-after date/);
  // Hatched, so the overrun still reads where the accent colour does not.
  assert.match(PAGE_STYLE, /\.timeline-overrun \{/);
  assert.match(PAGE_STYLE, /repeating-linear-gradient/);
});

test("source usage is drawn as a bar scaled to the busiest source on the page", () => {
  const documents = [provenanceDocument("concepts/a.md", { type: "Concept", usage_window: { from: "2026-06-01", to: "2026-06-30" } }, [
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
      id: "warehouse",
      resource: "https://example.com/warehouse",
      title: "Warehouse schema",
      author: null,
      usageCount: 1240,
      lastModified: null,
      resolvedPath: null,
      exists: null,
    },
  ])];
  const html = generateVisualization({
    bundle: "b",
    analysis: analysis(documents, [signalNode("concepts/a.md", {})], []),
  });
  assert.match(html, /"usageCount":5000/);
  assert.match(html, /"usageWindow":\{"from":"2026-06-01","to":"2026-06-30"\}/);
  // Proportional to the largest count on the page, never to a bundle-wide maximum.
  assert.match(PAGE_SCRIPT, /fill\.style\.width = \(\(source\.usageCount \/ largest\) \* 100\) \+ "%";/);
  assert.match(PAGE_SCRIPT, /source\.usageCount !== null && source\.usageCount > largest/);
  // The window is a property of the measurement, so it is stated once for the whole list.
  assert.match(PAGE_SCRIPT, /sourcesEl\.appendChild\(caption\);/);
  assert.match(PAGE_STYLE, /\.usage-bar \{/);
  assert.match(PAGE_STYLE, /\.usage-fill \{/);
});
