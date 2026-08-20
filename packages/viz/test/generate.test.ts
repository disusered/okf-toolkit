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
    { resource: "https://example.com/one", title: "Example" },
  ]);
  assert.deepEqual(graph.nodes[1]?.links, [
    { href: "concepts/one.md", target: "concepts/one.md" },
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
