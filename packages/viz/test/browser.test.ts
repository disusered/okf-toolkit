import assert from "node:assert/strict";
import test from "node:test";

import {
  DARK_THEME,
  graphStylesheet,
  isLayoutName,
  LAYOUT_NAMES,
  layoutOptions,
  LIGHT_THEME,
  nodeClasses,
} from "../src/browser/index.js";
import type { VisualizationNode } from "../src/index.js";

function styleNode(overrides: Partial<VisualizationNode> = {}): VisualizationNode {
  return {
    authorKind: "human",
    pending: false,
    stale: null,
    status: "draft",
    trustTier: "human-reviewed",
    ...overrides,
  } as VisualizationNode;
}

function selectors(theme = LIGHT_THEME): string[] {
  return graphStylesheet(theme).map((rule) => (rule as { selector: string }).selector);
}

test("stylesheet order is load-bearing and stale outranks both fades", () => {
  const order = selectors();
  const at = (selector: string) => order.indexOf(selector);

  // A page past its own date is a warning rather than a footnote, so it must win over the
  // fades. Selection must win over that, and dimming over everything.
  assert.ok(at("node.unchecked") < at("node.stale"));
  assert.ok(at("node.deprecated") < at("node.stale"));
  assert.ok(at("node.stale") < at("node:selected"));
  assert.ok(at("node:selected") < at(".dim"));
  assert.equal(order.at(-1), ".dim");

  // Leaning on a sanctioned computation outranks how the reference was written.
  assert.ok(at('edge[relation = "source"]') < at("edge.attested"));
  assert.ok(at("edge.attested") < at("edge:selected"));
});

test("the four channels stay independent of one another", () => {
  // Fill and shape are the type, the border is who wrote it, opacity is whether anyone checked.
  assert.deepEqual(nodeClasses(styleNode()), ["author-human"]);
  assert.deepEqual(nodeClasses(styleNode({ authorKind: "agent" })), ["author-agent"]);
  assert.deepEqual(
    nodeClasses(styleNode({ trustTier: "unverified" })),
    ["author-human", "unchecked"],
  );
  assert.deepEqual(
    nodeClasses(styleNode({ status: "deprecated", trustTier: "machine-confirmed" })),
    ["author-human", "unchecked", "deprecated"],
  );
  assert.deepEqual(
    nodeClasses(styleNode({ stale: true, trustTier: "unverified" })),
    ["author-human", "unchecked", "stale"],
  );
});

test("a pending node carries nothing but its pending mark", () => {
  // Nobody has written the page, so there is no trust, status or freshness to claim about it.
  assert.deepEqual(
    nodeClasses(styleNode({ pending: true, trustTier: "unverified", stale: true })),
    ["author-human", "pending"],
  );
});

test("the authorship ring is resolved at view time, never baked in", () => {
  // A near-black ring is invisible on a dark background, and the ring is a signal that must
  // always read, so it cannot be decided by the generator.
  assert.notEqual(LIGHT_THEME.ring, DARK_THEME.ring);
  assert.notEqual(LIGHT_THEME.muted, DARK_THEME.muted);
  assert.notEqual(LIGHT_THEME.stale, DARK_THEME.stale);
  assert.notEqual(LIGHT_THEME.attested, DARK_THEME.attested);

  const ring = (theme: typeof LIGHT_THEME) =>
    (graphStylesheet(theme).find(
      (rule) => (rule as { selector: string }).selector === "node.author-human",
    ) as { style: Record<string, unknown> }).style["border-color"];
  assert.equal(ring(LIGHT_THEME), LIGHT_THEME.ring);
  assert.equal(ring(DARK_THEME), DARK_THEME.ring);
});

test("a consumer may pass its own palette", () => {
  // The whole reason the theme is an input: an application with its own brand reuses the graph
  // without forking it.
  const brand = { ...DARK_THEME, ring: "#35c7d6", stale: "#d0a541" };
  const rules = graphStylesheet(brand) as { selector: string; style: Record<string, unknown> }[];
  assert.equal(
    rules.find((rule) => rule.selector === "node.author-human")?.style["border-color"],
    "#35c7d6",
  );
  assert.equal(
    rules.find((rule) => rule.selector === "node.stale")?.style["border-color"],
    "#d0a541",
  );
});

test("layout options give labels room and never animate", () => {
  const options = layoutOptions("cose");
  assert.equal(options["name"], "cose");
  // Labels sit below their node, so the default packing overlaps them.
  assert.equal(options["animate"], false);
  assert.equal(options["nodeDimensionsIncludeLabels"], true);
  assert.equal(options["nodeRepulsion"], 6000);
  assert.equal(options["idealEdgeLength"], 100);
  assert.equal(options["padding"], 36);
  // The constructor layout carries no stop hook; runLayout adds one.
  assert.equal("stop" in options, false);
});

test("layout names are the ones the page offers", () => {
  assert.deepEqual([...LAYOUT_NAMES], ["cose", "concentric", "breadthfirst", "circle", "grid"]);
  assert.equal(isLayoutName("cose"), true);
  assert.equal(isLayoutName("nonsense"), false);
});

/** A stand-in for the parts of Cytoscape mountGraph reaches, recording what it was asked. */
function fakeCytoscape(ids: readonly string[]) {
  const asked: { fitted: string[][]; padding: number[] } = { fitted: [], padding: [] };
  const collection = (members: string[]) => ({
    length: members.length,
    members,
    id: () => members[0] ?? "",
    select() {}, unselect() {}, toggleClass() {},
    data: () => undefined,
    renderedPosition: () => ({ x: 0, y: 0 }),
    forEach(run: (element: unknown) => void) {
      for (const member of members) run(collection([member]));
    },
  });
  const cy = {
    on() {},
    elements: () => collection([...ids]),
    filter: (match: (element: { id(): string }) => boolean) =>
      collection(ids.filter((id) => match({ id: () => id }))),
    getElementById: (id: string) => collection(ids.includes(id) ? [id] : []),
    layout: () => ({ run() {} }),
    resize() {},
    fit(elements: unknown, padding: number) {
      asked.fitted.push([...(elements as { members: string[] }).members]);
      asked.padding.push(padding);
    },
    zoom: () => 1,
    center() {}, animate() {}, destroy() {},
  };
  return { asked, cytoscape: () => cy };
}

const GRAPH = {
  edges: [],
  nodes: [
    { id: "a.md", authorKind: "human", pending: false, stale: null, status: "draft",
      trustTier: "unverified", title: "A", color: "#000", size: 20, shape: "ellipse" },
    { id: "b.md", authorKind: "human", pending: false, stale: null, status: "draft",
      trustTier: "unverified", title: "B", color: "#000", size: 20, shape: "ellipse" },
    { id: "c.md", authorKind: "human", pending: false, stale: null, status: "draft",
      trustTier: "unverified", title: "C", color: "#000", size: 20, shape: "ellipse" },
  ],
} as unknown as Parameters<typeof import("../src/browser/index.js").mountGraph>[1];

async function mounted(ids: readonly string[]) {
  const { mountGraph } = await import("../src/browser/index.js");
  const fake = fakeCytoscape(ids);
  const container = {
    getBoundingClientRect: () => ({ height: 600, width: 800 }),
  } as unknown as HTMLElement;
  const handle = mountGraph(container, GRAPH, { cytoscape: fake.cytoscape as never });
  return { asked: fake.asked, handle };
}

test("framing a set fits exactly those nodes", async () => {
  // A focus mode has already decided what matters; the camera should show that and no more.
  const { asked, handle } = await mounted(["a.md", "b.md", "c.md"]);
  handle.frame(["a.md", "b.md"]);
  assert.deepEqual(asked.fitted.at(-1), ["a.md", "b.md"]);
  assert.equal(asked.padding.at(-1), 90);
});

test("an id the graph does not carry is ignored rather than fitted", async () => {
  const { asked, handle } = await mounted(["a.md", "b.md"]);
  handle.frame(["a.md", "nobody-wrote-this.md"]);
  assert.deepEqual(asked.fitted.at(-1), ["a.md"]);
});

test("nothing to frame leaves the camera alone", async () => {
  // Fitting an empty collection would throw the view somewhere arbitrary.
  const { asked, handle } = await mounted(["a.md"]);
  const before = asked.fitted.length;
  handle.frame([]);
  handle.frame(["not-here.md"]);
  assert.equal(asked.fitted.length, before);
});

test("the caller may widen the padding", async () => {
  const { asked, handle } = await mounted(["a.md"]);
  handle.frame(["a.md"], 200);
  assert.equal(asked.padding.at(-1), 200);
});
