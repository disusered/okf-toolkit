const MAX_LINES = 5_000;
const CONTEXT = 3;

function commonSubsequence(before: readonly string[], after: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const row = table[i]!;
      row[j] =
        before[i] === after[j]
          ? (table[i + 1]![j + 1] ?? 0) + 1
          : Math.max(table[i + 1]![j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return table;
}

type Operation = { readonly sign: " " | "-" | "+"; readonly text: string };

function operations(before: readonly string[], after: readonly string[]): Operation[] {
  const table = commonSubsequence(before, after);
  const result: Operation[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      result.push({ sign: " ", text: before[i]! });
      i += 1;
      j += 1;
    } else if ((table[i + 1]![j] ?? 0) >= (table[i]![j + 1] ?? 0)) {
      result.push({ sign: "-", text: before[i]! });
      i += 1;
    } else {
      result.push({ sign: "+", text: after[j]! });
      j += 1;
    }
  }
  for (; i < before.length; i += 1) result.push({ sign: "-", text: before[i]! });
  for (; j < after.length; j += 1) result.push({ sign: "+", text: after[j]! });
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
