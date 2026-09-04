import { fromMarkdown } from "mdast-util-from-markdown";

interface MdastNode {
  readonly type?: string;
  readonly depth?: number;
  readonly value?: string;
  readonly children?: readonly MdastNode[];
}

export interface MarkdownHeading {
  readonly depth: number;
  readonly text: string;
}

export type MarkdownBlock =
  | { readonly type: "heading"; readonly depth: number; readonly text: string }
  | { readonly type: "list" }
  | { readonly type: "other" };

function nodeText(node: MdastNode): string {
  if (node.type === "text" || node.type === "inlineCode") {
    return node.value ?? "";
  }
  return (node.children ?? []).map(nodeText).join("");
}

/**
 * A parsed CommonMark tree.
 *
 * Parsing dominates the cost of analysing a bundle, so a caller that needs more than one thing
 * from the same body parses once with `parseMarkdown` and passes the tree to the `*FromRoot`
 * functions. The string-taking wrappers remain for callers that only need one answer.
 */
export type MarkdownRoot = ReturnType<typeof fromMarkdown>;

export function parseMarkdown(markdown: string): MarkdownRoot {
  return fromMarkdown(markdown);
}

/** Return actual top-level CommonMark blocks, excluding syntax nested in code. */
export function blocksFromRoot(root: MarkdownRoot): readonly MarkdownBlock[] {
  const node: MdastNode = root;
  return (node.children ?? []).map((child): MarkdownBlock => {
    if (child.type === "heading" && typeof child.depth === "number") {
      return { type: "heading", depth: child.depth, text: nodeText(child) };
    }
    return child.type === "list" ? { type: "list" } : { type: "other" };
  });
}

/** Return actual CommonMark heading blocks, excluding fenced and indented code. */
export function headingsFromRoot(root: MarkdownRoot): readonly MarkdownHeading[] {
  return blocksFromRoot(root).flatMap((block) => (block.type === "heading" ? [block] : []));
}

export function markdownBlocks(markdown: string): readonly MarkdownBlock[] {
  return blocksFromRoot(parseMarkdown(markdown));
}

export function markdownHeadings(markdown: string): readonly MarkdownHeading[] {
  return headingsFromRoot(parseMarkdown(markdown));
}
