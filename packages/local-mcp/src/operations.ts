import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ApplyChangeRequest, BundleAnalysis, Change, ChangePreview, ChangeResult } from "okf-contracts";
import { listBundleEntries, searchBundle, type AnalyzeBundleOptions } from "okf-core";
import type { OkfV1Operations } from "okf-contracts";
import {
  applyChange,
  previewChange,
  readBundleContext,
  type ResolvedBundleTarget,
} from "okf-node";
import { generateVisualization } from "okf-viz";

import type { BundleSettings } from "./bundle.js";

/** A writing operation reached a bundle whose manifest declares `access: read`. */
export class ReadOnlyBundleError extends Error {
  readonly code = "OKF_BUNDLE_READ_ONLY";

  constructor(bundle: string, operation: string) {
    super(`bundle ${bundle} declares access: read; ${operation} is not available`);
    this.name = "ReadOnlyBundleError";
  }
}

export interface FilesystemOkfV1OperationsOptions {
  readonly target: ResolvedBundleTarget;
  readonly settings: BundleSettings;
  readonly analysis?: AnalyzeBundleOptions;
  /**
   * Where `okf_v1_visualize` writes the generated page. A local client opens a file, not a
   * URL served by this process, so the page has to land somewhere on disk. Defaults to a
   * per-process temporary directory created on the first call.
   */
  readonly visualizationDirectory?: string;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Create all versioned MCP operations for one filesystem bundle. */
export function createFilesystemOkfV1Operations(
  options: FilesystemOkfV1OperationsOptions,
): OkfV1Operations {
  const bundle = options.settings.name;
  // `FilesystemBundle.analyze` walks the root itself and threads what it finds that is not a
  // document, so a contract path naming a query or an attester script still resolves.
  const analyze = (): Promise<BundleAnalysis> => options.target.bundle.analyze(options.analysis ?? {});

  let visualizationDirectory = options.visualizationDirectory;
  const visualizationTarget = async (): Promise<string> => {
    visualizationDirectory ??= await mkdtemp(path.join(tmpdir(), "okf-mcp-viz-"));
    return path.join(visualizationDirectory, `${bundle}.html`);
  };

  const writable = (operation: string): void => {
    if (options.settings.access === "read") {
      throw new ReadOnlyBundleError(bundle, operation);
    }
  };

  return {
    async context() {
      let index = null;
      try {
        index = await options.target.bundle.readDocument(options.settings.index);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return {
        adapter: options.settings.adapter,
        bundle,
        audience: options.settings.audience,
        access: options.settings.access,
        instructions: await readBundleContext(options.target),
        index,
      };
    },
    async list({ path: requested, depth }) {
      const paths = await options.target.bundle.listPaths();
      return { bundle, path: requested, entries: listBundleEntries(paths, requested, depth) };
    },
    async search({ query, limit }) {
      return { bundle, query, ...searchBundle(await analyze(), query, limit) };
    },
    async read({ path: requested }) {
      return { bundle, ...await options.target.bundle.readDocument(requested) };
    },
    async links({ path: requested }) {
      const analysis = await analyze();
      const document = analysis.documents.find((entry) => entry.path === requested);
      if (!document) throw new Error(`path does not exist in bundle ${bundle}: ${requested}`);
      const backlinks = analysis.documents.flatMap((entry) => entry.links
        .filter((link) => link.resolvedPath === requested && entry.path !== requested)
        .map((link) => ({ path: entry.path, href: link.href })));
      return { bundle, path: requested, outgoing: document.links, backlinks };
    },
    async validate() {
      const analysis = await analyze();
      const diagnostics = [
        ...analysis.diagnostics.core,
        ...analysis.diagnostics.guidance,
        ...analysis.diagnostics.profile,
      ];
      return {
        bundle,
        passed: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
        diagnostics: analysis.diagnostics,
        summary: analysis.summary,
      };
    },
    async inspect() {
      return { ...await analyze() };
    },
    async visualize() {
      const analysis = await analyze();
      const output = await visualizationTarget();
      await writeFile(output, generateVisualization({
        bundle,
        analysis,
        // The same explicit date the analysis used, or nothing. Never the system clock, or
        // the page stops being reproducible from the bundle.
        evaluatedAt: options.analysis?.today ?? null,
      }), "utf8");
      return { bundle, url: pathToFileURL(output).href, path: output };
    },
    async previewChange(change: Change): Promise<ChangePreview> {
      writable("okf_v1_preview_change");
      return previewChange(options.target.bundle, change, options.analysis ?? {});
    },
    async applyChange(request: ApplyChangeRequest): Promise<ChangeResult> {
      writable("okf_v1_apply_change");
      return applyChange(options.target.bundle, request, options.analysis ?? {});
    },
  };
}
