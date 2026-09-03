# okf-viz

`okf-viz` is the graph: the projection from a canonical `okf.inspect.v1` bundle
analysis to graph data, and the browser rendering of that data.

It is a library, not a page. If you want a finished HTML file you can open
without a network, use the CLI (`okf visualize`), which builds one around this
graph.

```ts
import { analyzeBundle } from "okf-core";
import { toVisualizationGraph } from "okf-viz";

const graph = toVisualizationGraph(analyzeBundle(source));
```

`toVisualizationGraph` is pure. No clock, environment, storage, network,
Markdown parsing, or link resolution enters it, so the same analysis always
produces the same graph.

## What the graph encodes

Four channels, each carrying one fact, so a reader can tell them apart:

- **Fill and shape** are the page's type.
- **The border** is who wrote the page — solid for a person, dashed for an
  agent, double for a process, absent when the actor grammar says nothing.
- **Opacity** is whether a person ever checked the page.
- **A dotted outline** marks a pending node: a link to a page nobody has
  written yet, which is work in progress rather than an error.

## Rendering in a browser

`okf-viz/browser` mounts the graph into an element with Cytoscape and returns a
handle for selecting, focusing, dimming and fitting it.

```ts
import { mountGraph } from "okf-viz/browser";

const handle = mountGraph(document.getElementById("graph"), graph);
handle.select("concepts/example.md");
```

Cytoscape is a **peer dependency**. This package does not bundle it, so a
consumer picks the version, dedupes it, and reaches the same `cy` instance the
graph is drawn on. A consumer that needs a self-contained file inlines it at its
own build step; the CLI does exactly that.

## License

Apache-2.0.
