import type { VisualizationIndex, VisualizationIndexNode } from "../graph.js";
import {
  isLayoutName,
  layoutOptions,
  type GraphSpacing,
  type LayoutName,
} from "./layout.js";
import { graphStylesheet, nodeClasses, preferredTheme, type GraphTheme } from "./theme.js";

/** The subset of Cytoscape this module uses, so a consumer's version is not constrained here. */
export interface CytoscapeLike {
  (options: Record<string, unknown>): CytoscapeCore;
}

export interface CytoscapeCore {
  on(event: string, selectorOrHandler: unknown, handler?: unknown): void;
  elements(): CytoscapeCollection;
  /** Cytoscape's own predicate filter, which is how a subset becomes a collection to fit. */
  filter(match: (element: CytoscapeCollection) => boolean): CytoscapeCollection;
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
  readonly spacing?: GraphSpacing;
  readonly initialViewport?: "fit" | "natural";
  readonly overviewZoom?: number | null;
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
  setDimmed(keep: (node: VisualizationIndexNode) => boolean): void;
  runLayout(name: LayoutName): void;
  /** Resize, fit, and ease the zoom back so labels drawn below a node stay on screen. */
  fit(): void;
  /**
   * Frame a set of nodes, so the view shows exactly them.
   *
   * What a focus mode needs: having decided which pages matter, the camera should show those
   * and no more. Ids the graph does not carry are ignored, and an empty or wholly unknown set
   * leaves the camera alone rather than fitting nothing.
   */
  frame(ids: Iterable<string>, padding?: number): void;
  onSelect(listener: (id: string) => void): void;
  onBackground(listener: () => void): void;
  onHover(listener: (node: VisualizationIndexNode | null, at: { x: number; y: number }) => void): void;
  destroy(): void;
}

export function mountGraph(
  container: HTMLElement,
  graph: VisualizationIndex,
  options: MountGraphOptions,
): GraphHandle {
  const theme = options.theme ?? preferredTheme();
  const layout = options.layout ?? "cose";
  const initialViewport = options.initialViewport ?? "fit";
  const overviewZoom = options.overviewZoom === undefined ? 0.55 : options.overviewZoom;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  let destroyed = false;
  let sizingFrame: number | null = null;

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
    // Run the real layout after Cytoscape has returned its core. A constructor-time stop hook
    // can fire before `cy` is assigned, while a constructor-time fit can measure the pre-layout
    // positions and leave the settled graph clipped into one corner.
    layout: { name: "preset", fit: false },
  });

  function updateOverview(): void {
    if (overviewZoom === null) return;
    const overview = cy.zoom() < overviewZoom;
    cy.elements().forEach((element) => element.toggleClass("overview", overview));
  }
  cy.on("zoom", updateOverview);
  updateOverview();

  function fit(): void {
    cy.resize();
    cy.fit(undefined, 60);
    // fit measures node bounds; labels are drawn beneath and outside them, so ease off the
    // zoom a little or the outermost captions sit past the edge of the pane.
    cy.zoom(cy.zoom() * 0.82);
    cy.center();
  }

  function natural(): void {
    fit();
    // A whole-corpus fit is useful as a reference, but makes large bundles unreadably tiny.
    // Open one level closer while retaining the settled graph's center; the rest remains
    // available by panning instead of being compressed into the viewport.
    cy.zoom(Math.min(cy.zoom() * 2, 0.8));
    cy.center();
    updateOverview();
  }

  // A flex container may initially measure zero. Wait until it has real dimensions, then run
  // the layout and apply the camera from its stop hook so the final positions are what we frame.
  function runInitialLayoutWhenSized(): void {
    if (destroyed) return;
    const box = container.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) {
      sizingFrame = requestAnimationFrame(runInitialLayoutWhenSized);
      return;
    }
    cy.resize();
    cy.layout({
      ...layoutOptions(layout, { fit: false, spacing: options.spacing }),
      stop: () => {
        if (destroyed) return;
        if (initialViewport === "fit") fit();
        else natural();
      },
    }).run();
  }
  if (typeof requestAnimationFrame === "function") {
    sizingFrame = requestAnimationFrame(runInitialLayoutWhenSized);
  } else {
    runInitialLayoutWhenSized();
  }

  const handle: GraphHandle = {
    cy,
    clearSelection() {
      cy.elements().unselect();
    },
    destroy() {
      destroyed = true;
      if (sizingFrame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(sizingFrame);
      }
      cy.destroy();
    },
    fit,
    frame(ids, padding = 90) {
      const wanted = new Set(ids);
      if (wanted.size === 0) return;
      const elements = cy.filter((element) => wanted.has(element.id()));
      if (elements.length === 0) return;
      cy.resize();
      cy.fit(elements, padding);
    },
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
      cy.layout({
        ...layoutOptions(name, { fit: false, spacing: options.spacing }),
        stop: () => initialViewport === "fit" ? fit() : natural(),
      }).run();
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
