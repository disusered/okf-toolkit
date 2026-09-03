import type { VisualizationGraph, VisualizationNode } from "../graph.js";
import { isLayoutName, layoutOptions, type LayoutName } from "./layout.js";
import { graphStylesheet, nodeClasses, preferredTheme, type GraphTheme } from "./theme.js";

/** The subset of Cytoscape this module uses, so a consumer's version is not constrained here. */
export interface CytoscapeLike {
  (options: Record<string, unknown>): CytoscapeCore;
}

export interface CytoscapeCore {
  on(event: string, selectorOrHandler: unknown, handler?: unknown): void;
  elements(): CytoscapeCollection;
  getElementById(id: string): CytoscapeCollection;
  layout(options: Record<string, unknown>): { run(): void };
  resize(): void;
  fit(elements: unknown, padding: number): void;
  zoom(level?: number): number;
  center(): void;
  animate(target: Record<string, unknown>, options: Record<string, unknown>): void;
  destroy(): void;
}

interface CytoscapeCollection {
  readonly length: number;
  select(): void;
  unselect(): void;
  toggleClass(name: string, apply: boolean): void;
  id(): string;
  data(key: string): unknown;
  renderedPosition(): { x: number; y: number };
  forEach(callback: (element: CytoscapeCollection) => void): void;
}

export interface MountGraphOptions {
  /** Required: this package does not bundle Cytoscape, it is a peer dependency. */
  readonly cytoscape: CytoscapeLike;
  /** Defaults to the viewer's own colour-scheme setting. */
  readonly theme?: GraphTheme;
  readonly layout?: LayoutName;
}

export interface GraphHandle {
  readonly cy: CytoscapeCore;
  /** Select and centre one node. Pass `keepCamera` to select without moving the view. */
  select(id: string, options?: { readonly keepCamera?: boolean }): void;
  clearSelection(): void;
  /**
   * Dim every node the predicate rejects, and any edge with a dimmed endpoint.
   *
   * Dimming rather than hiding: a filtered graph that removes nodes also removes the shape of
   * the corpus, and the reader loses where they were.
   */
  setDimmed(keep: (node: VisualizationNode) => boolean): void;
  runLayout(name: LayoutName): void;
  /** Resize, fit, and ease the zoom back so labels drawn below a node stay on screen. */
  fit(): void;
  onSelect(listener: (id: string) => void): void;
  onBackground(listener: () => void): void;
  onHover(listener: (node: VisualizationNode | null, at: { x: number; y: number }) => void): void;
  destroy(): void;
}

export function mountGraph(
  container: HTMLElement,
  graph: VisualizationGraph,
  options: MountGraphOptions,
): GraphHandle {
  const theme = options.theme ?? preferredTheme();
  const layout = options.layout ?? "cose";
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const elements = [
    ...graph.nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.title,
        color: node.color,
        size: node.size,
        shape: node.shape,
      },
      classes: nodeClasses(node).join(" "),
    })),
    ...graph.edges.map((edge) => ({
      data: { id: edge.id, source: edge.source, target: edge.target, relation: edge.relation },
      classes: edge.attested ? "attested" : "",
    })),
  ];

  const cy = options.cytoscape({
    container,
    elements,
    style: graphStylesheet(theme),
    // No stop hook here: it would fire during construction, before `cy` is assigned, and the
    // throw would abort everything after it. cose fits on its own.
    layout: layoutOptions(layout),
  });

  function fit(): void {
    cy.resize();
    cy.fit(undefined, 60);
    // fit measures node bounds; labels are drawn beneath and outside them, so ease off the
    // zoom a little or the outermost captions sit past the edge of the pane.
    cy.zoom(cy.zoom() * 0.82);
    cy.center();
  }

  // One frame is not reliably enough: a flex container may still measure zero, and a fit
  // against a zero viewport leaves every node off-screen. Wait until it has real dimensions.
  function fitWhenSized(): void {
    const box = container.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) {
      requestAnimationFrame(fitWhenSized);
      return;
    }
    fit();
  }
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fitWhenSized);

  const handle: GraphHandle = {
    cy,
    clearSelection() {
      cy.elements().unselect();
    },
    destroy() {
      cy.destroy();
    },
    fit,
    onBackground(listener) {
      cy.on("tap", (event: { target: unknown }) => {
        if (event.target === cy) listener();
      });
    },
    onHover(listener) {
      cy.on("mouseover", "node", (event: { target: CytoscapeCollection }) => {
        const node = nodeById.get(event.target.id());
        listener(node ?? null, event.target.renderedPosition());
      });
      cy.on("mouseout", "node", () => listener(null, { x: 0, y: 0 }));
    },
    onSelect(listener) {
      cy.on("tap", "node", (event: { target: CytoscapeCollection }) => {
        listener(event.target.id());
      });
    },
    runLayout(name) {
      if (!isLayoutName(name)) return;
      cy.layout({ ...layoutOptions(name), stop: () => fit() }).run();
    },
    select(id, selectOptions) {
      const element = cy.getElementById(id);
      if (element.length === 0) return;
      cy.elements().unselect();
      element.select();
      if (selectOptions?.keepCamera === true) return;
      cy.animate({ center: { eles: element }, zoom: Math.max(cy.zoom(), 0.9) }, { duration: 180 });
    },
    setDimmed(keep) {
      const dimmed = new Set<string>();
      cy.elements().forEach((element) => {
        const node = nodeById.get(element.id());
        if (node === undefined) return;
        const hide = !keep(node);
        element.toggleClass("dim", hide);
        if (hide) dimmed.add(node.id);
      });
      for (const edge of graph.edges) {
        const element = cy.getElementById(edge.id);
        if (element.length === 0) continue;
        element.toggleClass("dim", dimmed.has(edge.source) || dimmed.has(edge.target));
      }
    },
  };

  return handle;
}
