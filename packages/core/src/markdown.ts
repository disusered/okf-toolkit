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

/** Return actual top-level CommonMark blocks, excluding syntax nested in code. */
export function markdownBlocks(markdown: string): readonly MarkdownBlock[] {
  const root: MdastNode = fromMarkdown(markdown);
  return (root.children ?? []).map((node): MarkdownBlock => {
    if (node.type === "heading" && typeof node.depth === "number") {
      return { type: "heading", depth: node.depth, text: nodeText(node) };
    }
    return node.type === "list" ? { type: "list" } : { type: "other" };
  });
}

/** Return actual CommonMark heading blocks, excluding fenced and indented code. */
export function markdownHeadings(markdown: string): readonly MarkdownHeading[] {
  return markdownBlocks(markdown).flatMap((block) => block.type === "heading" ? [block] : []);
}
