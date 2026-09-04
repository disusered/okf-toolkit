/** The layouts the graph offers. `cose` is the force layout and the default. */
export const LAYOUT_NAMES = ["cose", "concentric", "breadthfirst", "circle", "grid"] as const;

export type LayoutName = (typeof LAYOUT_NAMES)[number];

export function isLayoutName(value: string): value is LayoutName {
  return (LAYOUT_NAMES as readonly string[]).includes(value);
}

/**
 * Layout options.
 *
 * Labels sit below their node, so the default packing overlaps them; these numbers give the
 * layout room. `animate` is off because a settling graph is not something to watch.
 */
export function layoutOptions(name: LayoutName): Record<string, unknown> {
  return {
    name,
    animate: false,
    nodeDimensionsIncludeLabels: true,
    padding: 36,
    nodeRepulsion: 6000,
    idealEdgeLength: 100,
    componentSpacing: 80,
    nodeOverlap: 20,
  };
}
