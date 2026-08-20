# okf-viz

`okf-viz` turns one canonical `okf.inspect.v1` bundle analysis into a
deterministic, self-contained HTML reader and graph.

The generated page embeds pinned Cytoscape.js, Marked, and DOMPurify builds, so
it makes no runtime network requests. [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
records their licenses.

The package does not read files, parse Markdown frontmatter, resolve links, or
combine bundles. Call `okf-core` first, then pass its analysis to
`generateVisualization`:

```ts
import { analyzeBundle } from "okf-core";
import { generateVisualization } from "okf-viz";

const analysis = analyzeBundle(source);
const html = generateVisualization({ bundle: "handbook", analysis });
```

The result contains Cytoscape, Marked, DOMPurify, styles, data, and behavior in
one file. Its Content Security Policy allows no external origins and blocks
network connections. Marked renders Markdown, and DOMPurify sanitizes the
result before it reaches the document.

The same bundle name and analysis produce the same bytes. No timestamp,
hostname, storage location, or runtime configuration enters the generator.
