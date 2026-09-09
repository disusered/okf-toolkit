/** The layouts the graph offers. `cose` is the force layout and the default. */
export const LAYOUT_NAMES = ["cose", "concentric", "breadthfirst", "circle", "grid"] as const;

export type LayoutName = (typeof LAYOUT_NAMES)[number];
export type GraphSpacing = "normal" | "roomy";

export interface GraphLayoutOptions {
  readonly spacing?: GraphSpacing;
  readonly fit?: boolean;
}

export function isLayoutName(value: string): value is LayoutName {
  return (LAYOUT_NAMES as readonly string[]).includes(value);
}

/**
 * Layout options.
 *
 * Labels sit below their node, so the default packing overlaps them; these numbers give the
 * layout room. `animate` is off because a settling graph is not something to watch.
 */
export function layoutOptions(
  name: LayoutName,
  options: GraphLayoutOptions = {},
): Record<string, unknown> {
  const roomy = options.spacing === "roomy";
  return {
    name,
    animate: false,
    fit: options.fit ?? true,
    nodeDimensionsIncludeLabels: true,
    padding: roomy ? 80 : 36,
    nodeRepulsion: roomy ? 14000 : 6000,
    idealEdgeLength: roomy ? 180 : 100,
    componentSpacing: roomy ? 150 : 80,
    nodeOverlap: roomy ? 40 : 20,
  };
}
