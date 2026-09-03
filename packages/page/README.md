# okf-page

`okf-page` turns one canonical `okf.inspect.v1` bundle analysis into a
deterministic, self-contained HTML reader and graph: a single file that opens
without a network.

The graph itself belongs to [`okf-viz`](../viz), which owns the projection from
bundle analysis to graph data and the browser rendering of nodes and edges.
`okf-page` owns everything around it — the document shell, the search box and
filters, the split pane, the reader panel, and the Markdown rendering.

The generated page embeds pinned Cytoscape.js, Marked, and DOMPurify builds, so
it makes no runtime network requests. [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
records their licenses.

The package does not read files, parse Markdown frontmatter, resolve links, or
combine bundles. Call `okf-core` first, then pass its analysis to
`generateVisualization`:

```ts
import { analyzeBundle } from "okf-core";
import { generateVisualization } from "okf-page";

const analysis = analyzeBundle(source);
const html = generateVisualization({ bundle: "handbook", analysis });
```

The result contains Cytoscape, Marked, DOMPurify, styles, data, and behavior in
one file. Its Content Security Policy allows no external origins and blocks
network connections. Marked renders Markdown, and DOMPurify sanitizes the
result before it reaches the document.

The same bundle name and analysis produce the same bytes. No timestamp,
hostname, storage location, or runtime configuration enters the generator.

## Trust and freshness

The visualizer projects the trust signals `okf-core` derives and never re-derives them. Each
node carries `trustTier`, `stale`, `staleAfter`, `tags`, and `status`.

Those are read in the reader's metadata table, not from the graph. Encoding three trust tiers
as border styles was tried and removed: distinguishing dotted from dashed on a small circle is
not something a reader can do at a glance, so it needed a permanent key, and a key is a poor
trade for a signal the table already states in words. The graph carries structure and type.

The reader always shows a Trust row, so an absent signal can never be read as verification.
Filtering by trust, status or staleness is still available; a filter appears only when the
bundle actually varies on that facet, and when it does not the header says so outright —
`21 pages, 34 relationships, all unverified` — because a hidden filter must not let a reader
infer a review nobody performed.

A link whose target nobody has written becomes a pending placeholder node rather than being
dropped, so the graph shows the work the bundle has given itself.

## Determinism and `evaluatedAt`

`generateVisualization` is a pure function of `(bundle, analysis, evaluatedAt)`. The same
triple always produces the same bytes, and the generator never reads a clock.

`evaluatedAt` is optional. Omit it and the page is reproducible from the bundle alone, which
is what `okf visualize` does unless `--today` is passed. Supply it — the same date passed to
`analyzeBundle` as `today` — and the page can show staleness and prints the date it was judged
against. It is an input rather than a field on the analysis so that `okf.inspect.v1` stays
frozen; that schema is `additionalProperties: false` and is read across a process boundary.

Passing `evaluatedAt` for an analysis that was never dated is refused, because it would print
an evaluation date over no verdicts.

## Browser storage

Split orientation, split position and layout algorithm persist in `localStorage` under
`okf.viz.prefs.v1`, keyed by bundle name. Every access is wrapped in `try`/`catch`: a page
opened over `file://` throws on storage in some browsers. Filters and selection are
deliberately not persisted — a remembered filter would hide pages added since the last visit.
