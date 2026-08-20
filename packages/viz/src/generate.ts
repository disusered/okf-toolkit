import type { BundleAnalysis } from "okf-contracts";

import { toVisualizationGraph } from "./graph.js";
import { PAGE_SCRIPT } from "./page/script.js";
import { PAGE_STYLE } from "./page/style.js";
import { CYTOSCAPE_SOURCE, CYTOSCAPE_VERSION } from "./vendor/cytoscape.js";
import { DOMPURIFY_SOURCE, DOMPURIFY_VERSION } from "./vendor/dompurify.js";
import { MARKED_SOURCE, MARKED_VERSION } from "./vendor/marked.js";

export interface VisualizationInput {
  /** Display name only. Bundle selection and loading happen before this call. */
  readonly bundle: string;
  readonly analysis: BundleAnalysis;
}

export class GeneratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneratorError";
  }
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Make a JSON script block unable to terminate itself and become markup. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function assertInlinable(name: string, source: string): void {
  if (/<\/script/i.test(source)) {
    throw new GeneratorError(`${name} contains a closing script tag and cannot be inlined`);
  }
}

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * Generate one deterministic, self-contained reader and graph from `okf.inspect.v1` data.
 *
 * Pure: no clock, environment, storage, network, parsing, or link resolution enters this call.
 */
export function generateVisualization(input: VisualizationInput): string {
  if (input.analysis.schema !== "okf.inspect.v1") {
    throw new GeneratorError(`unsupported analysis schema: ${String(input.analysis.schema)}`);
  }
  assertInlinable("cytoscape", CYTOSCAPE_SOURCE);
  assertInlinable("marked", MARKED_SOURCE);
  assertInlinable("dompurify", DOMPURIFY_SOURCE);
  assertInlinable("the page script", PAGE_SCRIPT);

  const graph = toVisualizationGraph(input.analysis);
  const payload = jsonForScript({ bundle: input.bundle, graph });
  const title = escapeText(`${input.bundle} — OKF graph`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeText(CSP)}">
<title>${title}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<header>
  <div class="brand">
    <strong id="bundle"></strong>
    <span class="muted" id="counts"></span>
  </div>
  <div class="controls">
    <input id="search" type="search" placeholder="Search title, path, or description" autocomplete="off">
    <select id="type" aria-label="Filter by type">
      <option value="">All types</option>
    </select>
    <select id="layout" aria-label="Layout">
      <option value="cose">Force</option>
      <option value="concentric">Concentric</option>
      <option value="breadthfirst">Breadth-first</option>
      <option value="circle">Circle</option>
      <option value="grid">Grid</option>
    </select>
    <button id="reset" type="button">Reset view</button>
  </div>
</header>

<main>
  <section id="graph" aria-label="Bundle graph"></section>
  <aside id="detail">
    <p id="detail-empty" class="empty">Select a page in the graph.</p>
    <article id="detail-content" hidden>
      <span class="chip" id="detail-type"></span>
      <h1 id="detail-title"></h1>
      <p class="path" id="detail-path"></p>
      <dl>
        <dt>Description</dt><dd id="detail-description"></dd>
        <dt>Status</dt><dd id="detail-status"></dd>
        <dt>Sources</dt><dd id="detail-sources"></dd>
      </dl>
      <hr>
      <div id="detail-body"></div>
      <section id="detail-out" hidden>
        <h2>Links to</h2>
        <ul class="plain" id="links-out"></ul>
      </section>
      <section id="detail-back" hidden>
        <h2>Linked from</h2>
        <ul class="plain" id="links-back"></ul>
      </section>
    </article>
  </aside>
</main>

<script id="okf-graph" type="application/json">${payload}</script>
<!-- Bundled, not fetched: cytoscape ${CYTOSCAPE_VERSION}, marked ${MARKED_VERSION}, DOMPurify
     ${DOMPURIFY_VERSION}. Each source below opens with its own license banner. -->
<script>${CYTOSCAPE_SOURCE}</script>
<script>${MARKED_SOURCE}</script>
<script>${DOMPURIFY_SOURCE}</script>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
}
