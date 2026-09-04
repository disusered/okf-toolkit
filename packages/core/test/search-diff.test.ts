import assert from "node:assert/strict";
import test from "node:test";

import { analyzeBundle, searchBundle, unifiedDiff } from "../src/index.js";

const analysis = analyzeBundle([
  {
    path: "alpha.md",
    content: "---\ntype: Note\ntitle: Deployment Runbook\n---\n# Release\n\nRotate the canary deployment.\n",
  },
  {
    path: "beta.md",
    content: "---\ntype: Note\ntitle: Background\n---\n# Deployment model\n\nCanary traffic is isolated.\n",
  },
]);

test("search is ranked and deterministic", () => {
  const first = searchBundle(analysis, "canary deployment", 10);
  const second = searchBundle(analysis, "canary deployment", 10);
  assert.deepEqual(first, second);
  assert.deepEqual(first.terms, ["canary", "deployment"]);
  assert.ok(first.matches.length >= 2);
  assert.equal(first.truncated, false);
});

test("search limit is bounded", () => {
  const result = searchBundle(analysis, "deployment", 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.truncated, true);
});

test("search does not weight fenced code as a Markdown heading", () => {
  const fenced = analyzeBundle([
    {
      path: "a-plain.md",
      content: "---\ntype: Note\n---\nRareterm\n",
    },
    {
      path: "z-fenced.md",
      content: "---\ntype: Note\n---\n```markdown\n# Rareterm\n```\n",
    },
  ]);
  const result = searchBundle(fenced, "rareterm", 10);
  assert.equal(result.matches[0]?.path, "a-plain.md");
  assert.equal(result.matches[0]?.score, result.matches[1]?.score);
});

test("unified diff preserves the established wire form", () => {
  assert.equal(unifiedDiff("one\ntwo\n", "one\nthree\n", "page.md"), "--- a/page.md\n+++ b/page.md\n one\n-two\n+three\n \n");
  assert.equal(unifiedDiff("same", "same", "page.md"), "");
});

test("unified diff elides unchanged runs and keeps three lines of context", () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const after = before.replace("line 10", "line 10 edited");
  const diff = unifiedDiff(before, after, "page.md");
  assert.match(diff, /^--- a\/page\.md\n\+\+\+ b\/page\.md\n@@\n/);
  assert.match(diff, /-line 10\n\+line 10 edited\n/);
  // Three lines either side survive; the distant ones are elided into a single marker.
  for (const kept of [" line 7", " line 9", " line 11", " line 13"]) assert.ok(diff.includes(`${kept}\n`));
  for (const dropped of [" line 0", " line 19"]) assert.ok(!diff.includes(`${dropped}\n`));
});

test("a one-line edit in a long page costs memory proportional to the edit", () => {
  // Regression guard. This diff was computed by filling an (n+1) x (m+1) table of doubles,
  // which at 4,900 lines allocated ~190 MB and killed a 128 MB Cloudflare isolate outright.
  // Myers needs memory proportional to the difference, so the same input is now under a
  // megabyte. The ceiling here is deliberately far below the old cost and far above the new.
  const before = Array.from({ length: 4_900 }, (_, i) => `line ${i} of a long authored page`).join("\n");
  const after = before.replace("line 2450 of", "line 2450 edited of");
  globalThis.gc?.();
  const baseline = process.memoryUsage().heapUsed;
  const diff = unifiedDiff(before, after, "page.md");
  const grew = (process.memoryUsage().heapUsed - baseline) / 1_048_576;
  assert.match(diff, /-line 2450 of a long authored page\n\+line 2450 edited of a long authored page\n/);
  assert.ok(grew < 32, `a one-line edit in a 4,900-line page allocated ${grew.toFixed(1)} MB`);
});

test("unified diff refuses input beyond its line ceiling", () => {
  const huge = Array.from({ length: 5_001 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(
    unifiedDiff(huge, `${huge}\nmore`, "page.md"),
    "--- a/page.md\n+++ b/page.md\n@@ file too large to diff @@\n",
  );
});
