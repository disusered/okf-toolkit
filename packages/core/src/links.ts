import { fromMarkdown } from "mdast-util-from-markdown";

import type { AnalyzedLink, SourceRange } from "okf-contracts";

import type { MarkdownRoot } from "./markdown.js";
import { resolveWithinBundle } from "./paths.js";

interface MdastPoint {
  readonly line?: number;
  readonly column?: number;
  readonly offset?: number;
}

interface MdastNode {
  readonly type?: string;
  readonly value?: string;
  readonly alt?: string | null;
  readonly url?: string;
  readonly identifier?: string;
  readonly children?: readonly MdastNode[];
  readonly position?: { readonly start?: MdastPoint; readonly end?: MdastPoint };
}

export interface ExtractLinksOptions {
  readonly sourcePath: string;
  readonly knownPaths?: ReadonlySet<string>;
  readonly lineOffset?: number;
  readonly offsetOffset?: number;
}

function normalizeIdentifier(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function textOf(node: MdastNode): string {
  if (node.type === "text" || node.type === "inlineCode") {
    return node.value ?? "";
  }
  if (node.type === "image") {
    return node.alt ?? "";
  }
  return (node.children ?? []).map(textOf).join("");
}

function rangeOf(node: MdastNode, lineOffset: number, offsetOffset: number): SourceRange | null {
  const start = node.position?.start;
  const end = node.position?.end;
  if (
    start?.line === undefined ||
    start.column === undefined ||
    start.offset === undefined ||
    end?.line === undefined ||
    end.column === undefined ||
    end.offset === undefined
  ) {
    return null;
  }
  return {
    start: {
      line: start.line + lineOffset,
      column: start.column,
      offset: start.offset + offsetOffset,
    },
    end: {
      line: end.line + lineOffset,
      column: end.column,
      offset: end.offset + offsetOffset,
    },
  };
}

/** Extract CommonMark links, including reference links, from the Markdown AST. */
export function extractMarkdownLinks(
  markdown: string,
  options: ExtractLinksOptions,
): readonly AnalyzedLink[] {
  return linksFromRoot(fromMarkdown(markdown), options);
}

/**
 * The same extraction over a tree the caller already parsed. Analysing a document needs links
 * and headings from one body, and parsing it twice was more than a quarter of the cost.
 */
export function linksFromRoot(
  parsed: MarkdownRoot,
  options: ExtractLinksOptions,
): readonly AnalyzedLink[] {
  const root: MdastNode = parsed;
  const definitions = new Map<string, string>();

  const collectDefinitions = (node: MdastNode): void => {
    if (node.type === "definition" && node.identifier && typeof node.url === "string") {
      definitions.set(normalizeIdentifier(node.identifier), node.url);
    }
    for (const child of node.children ?? []) {
      collectDefinitions(child);
    }
  };
  collectDefinitions(root);

  const result: AnalyzedLink[] = [];
  const visit = (node: MdastNode): void => {
    let href: string | null = null;
    if (node.type === "link" && typeof node.url === "string") {
      href = node.url;
    } else if (node.type === "linkReference" && node.identifier) {
      href = definitions.get(normalizeIdentifier(node.identifier)) ?? null;
    }

    if (href !== null) {
      const resolution = resolveWithinBundle(options.sourcePath, href);
      const base = {
        href,
        text: textOf(node),
        range: rangeOf(node, options.lineOffset ?? 0, options.offsetOffset ?? 0),
      };
      if (resolution.kind === "internal") {
        result.push({
          ...base,
          kind: "internal",
          resolvedPath: resolution.path,
          fragment: resolution.fragment,
          exists: options.knownPaths?.has(resolution.path) ?? null,
        });
      } else if (resolution.kind === "fragment") {
        result.push({
          ...base,
          kind: "fragment",
          resolvedPath: options.sourcePath,
          fragment: resolution.fragment,
          exists: true,
        });
      } else {
        result.push({
          ...base,
          kind: resolution.kind,
          resolvedPath: null,
          fragment: null,
          exists: null,
        });
      }
      return;
    }

    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return result;
}
