import { diffArrays } from "diff";

/**
 * Line ceiling for a diff. Myers needs memory proportional to the two inputs plus the size of
 * the difference, not to their product, so this is a sanity bound on absurd input rather than
 * the memory cliff it used to guard: the previous implementation filled an (n+1) x (m+1) table
 * of doubles, which at this very bound measured 190 MB against a 128 MB Cloudflare isolate.
 */
const MAX_LINES = 5_000;
const CONTEXT = 3;

type Operation = { readonly sign: " " | "-" | "+"; readonly text: string };

function operations(before: string[], after: string[]): Operation[] {
  const result: Operation[] = [];
  for (const part of diffArrays(before, after)) {
    const sign = part.added ? "+" : part.removed ? "-" : " ";
    for (const text of part.value) result.push({ sign, text: text ?? "" });
  }
  return result;
}

export function unifiedDiff(before: string, after: string, path: string): string {
  if (before === after) return "";
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  if (beforeLines.length > MAX_LINES || afterLines.length > MAX_LINES) {
    return `--- a/${path}\n+++ b/${path}\n@@ file too large to diff @@\n`;
  }
  const ops = operations(beforeLines, afterLines);
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((operation, index) => {
    if (operation.sign === " ") return;
    for (let offset = -CONTEXT; offset <= CONTEXT; offset += 1) {
      const current = index + offset;
      if (current >= 0 && current < ops.length) keep[current] = true;
    }
  });
  const body: string[] = [];
  let elided = false;
  ops.forEach((operation, index) => {
    if (keep[index]) {
      if (elided) body.push("@@");
      elided = false;
      body.push(`${operation.sign}${operation.text}`);
    } else {
      elided = true;
    }
  });
  return [`--- a/${path}`, `+++ b/${path}`, ...body, ""].join("\n");
}
