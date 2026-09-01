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
  /**
   * The date the analysis was evaluated against, as `YYYY-MM-DD`, or null.
   *
   * This is an input rather than a field on the analysis, so `okf.inspect.v1` stays frozen.
   * Pass the same date here that you passed to `analyzeBundle` as `today`; the page prints it
   * so a reader knows what "stale" was judged against. Omit it and the page is reproducible
   * from the bundle alone.
   */
  readonly evaluatedAt?: string | null;
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reject anything but a bare calendar date, so a timestamp cannot leak into a stable page. */
function assertEvaluatedAt(value: string): void {
  const invalid = (): never => {
    throw new GeneratorError(`evaluatedAt must be a YYYY-MM-DD calendar date: ${value}`);
  };
  if (!ISO_DATE.test(value)) invalid();
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    invalid();
  }
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

  const evaluatedAt = input.evaluatedAt ?? null;
  if (evaluatedAt !== null) {
    assertEvaluatedAt(evaluatedAt);
    // A date with no verdicts behind it would print "evaluated <date>" over nothing. That only
    // happens when the caller dated the page but not the analysis, which is worth refusing.
    const dated = input.analysis.documents.some((document) => document.derived.staleAfter !== null);
    const judged = input.analysis.graph.nodes.some((node) => node.stale !== null);
    if (dated && !judged) {
      throw new GeneratorError(
        "analysis was not evaluated against a date; pass the same today to analyzeBundle",
      );
    }
  }

  const graph = toVisualizationGraph(input.analysis);
  const payload = jsonForScript({ bundle: input.bundle, evaluatedAt, graph });
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
    <span class="muted" id="evaluated"></span>
  </div>
  <div class="controls">
    <input id="search" type="search" placeholder="Search title, path, tag, or description" autocomplete="off">
    <select id="type" aria-label="Filter by type">
      <option value="">All types</option>
    </select>
    <select id="trust" aria-label="Filter by trust" hidden>
      <option value="">All trust</option>
    </select>
    <select id="status" aria-label="Filter by status" hidden>
      <option value="">All statuses</option>
    </select>
    <label id="stale-only-label" hidden><input id="stale-only" type="checkbox"> Stale only</label>
    <select id="layout" aria-label="Layout">
      <option value="cose">Force</option>
      <option value="concentric">Concentric</option>
      <option value="breadthfirst">Breadth-first</option>
      <option value="circle">Circle</option>
      <option value="grid">Grid</option>
    </select>
    <select id="orientation" aria-label="Split orientation">
      <option value="columns">Columns</option>
      <option value="rows">Rows</option>
    </select>
    <button id="reset" type="button">Reset view</button>
  </div>
</header>

<main>
  <section id="graph" aria-label="Bundle graph"></section>
  <div id="split" role="separator" aria-orientation="vertical" aria-label="Resize" tabindex="0"></div>
  <aside id="detail">
    <p id="detail-empty" class="empty">Select a page in the graph.</p>
    <article id="detail-content" hidden>
      <span class="chip" id="detail-type"></span>
      <span class="chip warn" id="detail-flag" hidden></span>
      <h1 id="detail-title"></h1>
      <p class="path" id="detail-path"></p>
      <dl>
        <dt>Description</dt><dd id="detail-description"></dd>
        <dt>Status</dt><dd id="detail-status"></dd>
        <dt>Verification</dt><dd id="detail-verified"></dd>
        <dt id="dt-generated" hidden>Written by</dt><dd id="detail-generated" hidden></dd>
        <dt id="dt-stale" hidden>Stale after</dt><dd id="detail-stale" hidden></dd>
        <dt id="dt-resource" hidden>Resource</dt><dd id="detail-resource" hidden></dd>
        <dt id="dt-tags" hidden>Tags</dt><dd id="detail-tags" hidden></dd>
        <dt>Sources</dt><dd id="detail-sources"></dd>
      </dl>
      <section id="detail-computation" hidden>
        <h2>Sanctioned computation</h2>
        <p class="muted">Run this rather than composing your own, then have the attester check the receipt.</p>
        <dl>
          <dt id="dt-runtime" hidden>Runtime</dt><dd id="comp-runtime" hidden></dd>
          <dt id="dt-parameters" hidden>Parameters</dt><dd id="comp-parameters" hidden></dd>
          <dt id="dt-computation" hidden>Computation</dt><dd id="comp-computation" hidden></dd>
          <dt id="dt-executor" hidden>Executor</dt><dd id="comp-executor" hidden></dd>
          <dt id="dt-receipt" hidden>Receipt must return</dt><dd id="comp-receipt" hidden></dd>
          <dt id="dt-attester" hidden>Attester</dt><dd id="comp-attester" hidden></dd>
        </dl>
      </section>
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
