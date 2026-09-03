import type { VisualizationGraph } from "../graph.js";

/**
 * Colours the graph resolves when it is drawn rather than when it is generated.
 *
 * A near-black authorship ring is invisible on a dark background, and the ring is a signal that
 * must always read, so these cannot be baked into the projection. A consumer with its own
 * palette passes one instead of taking the light or dark default.
 */
export interface GraphTheme {
  /** Node label colour. */
  readonly muted: string;
  /** Authorship ring. Drawn on every page whose actor grammar named someone. */
  readonly ring: string;
  /** A page that has passed its own stale-after date. */
  readonly stale: string;
  /** An edge into an Attested Computation. */
  readonly attested: string;
  /** Selection ring and selected edge. */
  readonly selected: string;
  /** Pending node outline: a link to a page nobody has written yet. */
  readonly pending: string;
  /** Ordinary edge and its arrowhead. */
  readonly edge: string;
  /** Behind a node label, so a label crossing an edge stays readable. */
  readonly labelBackground: string;
}

export const LIGHT_THEME: GraphTheme = {
  attested: "#6d28d9",
  edge: "#cbd5e1",
  labelBackground: "#f8fafc",
  muted: "#64748b",
  pending: "#94a3b8",
  ring: "#0f172a",
  selected: "#b45309",
  stale: "#b91c1c",
};

export const DARK_THEME: GraphTheme = {
  attested: "#c4b5fd",
  edge: "#cbd5e1",
  labelBackground: "#0b1120",
  muted: "#94a3b8",
  pending: "#94a3b8",
  ring: "#e2e8f0",
  selected: "#b45309",
  stale: "#f87171",
};

/** The theme the viewer's own setting asks for. Falls back to light where nothing answers. */
export function preferredTheme(): GraphTheme {
  const dark =
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return dark ? DARK_THEME : LIGHT_THEME;
}

/**
 * The Cytoscape stylesheet.
 *
 * Rule order is load-bearing and is asserted by the tests. `unchecked` and `deprecated` fade a
 * node; `stale` comes after both because a page past its own date is a warning rather than a
 * footnote, and it must win. `:selected` comes after those, and `.dim` last of all, so that
 * dimming survives every other rule.
 */
export function graphStylesheet(theme: GraphTheme): unknown[] {
  return [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        "label": "data(label)",
        "color": theme.muted,
        "font-size": 10,
        "text-valign": "bottom",
        "text-margin-y": 5,
        "text-wrap": "wrap",
        "text-max-width": 110,
        "text-overflow-wrap": "anywhere",
        "text-background-color": theme.labelBackground,
        "text-background-opacity": 0.85,
        "text-background-padding": 2,
        "shape": "data(shape)",
        "width": "data(size)",
        "height": "data(size)",
      },
    },
    // Border style is the authorship channel, so it stays independent of fill and shape: a
    // solid ring for a person, dashes for an agent, a doubled ring for an automated process,
    // and no ring at all when nothing was recorded. Absence must look like absence.
    { selector: "node.author-human", style: { "border-width": 3, "border-style": "solid", "border-color": theme.ring } },
    { selector: "node.author-agent", style: { "border-width": 3, "border-style": "dashed", "border-color": theme.ring } },
    { selector: "node.author-process", style: { "border-width": 4, "border-style": "double", "border-color": theme.ring } },
    { selector: "node.author-unknown", style: { "border-width": 0 } },
    // No person has checked it, or it has been retired: draw it as the weaker claim it is.
    { selector: "node.unchecked", style: { "opacity": 0.55 } },
    { selector: "node.deprecated", style: { "opacity": 0.45 } },
    // Stale is louder than either fade, on purpose, and so it must sit after both. Only the
    // colour changes, so the border still says who wrote it.
    { selector: "node.stale", style: { "opacity": 1, "border-width": 5, "border-color": theme.stale } },
    { selector: "node.pending", style: { "opacity": 0.5, "border-width": 1, "border-style": "dotted", "border-color": theme.pending } },
    { selector: "node:selected", style: { "border-width": 4, "border-color": theme.selected } },
    {
      selector: "edge",
      style: {
        "width": 1.4,
        "line-color": theme.edge,
        "target-arrow-color": theme.edge,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        "arrow-scale": 0.8,
      },
    },
    { selector: 'edge[relation = "source"]', style: { "line-style": "dashed" } },
    { selector: 'edge[relation = "pending"]', style: { "line-style": "dotted", "opacity": 0.6 } },
    // An edge into an Attested Computation is drawn as its own thing, so a reader can trace
    // which pages rest on a sanctioned run rather than on prose. It comes after the relation
    // rules because leaning on a computation outranks how the reference was written.
    {
      selector: "edge.attested",
      style: {
        "width": 2.6,
        "line-style": "solid",
        "line-color": theme.attested,
        "target-arrow-color": theme.attested,
        "target-arrow-shape": "triangle-backcurve",
        "arrow-scale": 1.1,
        "opacity": 1,
      },
    },
    { selector: "edge:selected", style: { "line-color": theme.selected, "target-arrow-color": theme.selected, "width": 2.4 } },
    { selector: ".dim", style: { "opacity": 0.12 } },
  ];
}

/**
 * The classes one node carries.
 *
 * Four channels, each carrying one thing: fill and shape are the type, the border is who wrote
 * the page, and opacity is whether a person ever checked it. A reader's metadata table still
 * spells all of it out, because a graph cannot carry a key.
 */
export function nodeClasses(node: VisualizationGraph["nodes"][number]): string[] {
  const classes = [`author-${node.authorKind}`];
  if (node.pending) {
    classes.push("pending");
  } else {
    // The tier is derived by okf-core; anything short of human-reviewed is a weaker claim.
    if (node.trustTier !== "human-reviewed") classes.push("unchecked");
    if (node.status === "deprecated") classes.push("deprecated");
    if (node.stale === true) classes.push("stale");
  }
  return classes;
}
