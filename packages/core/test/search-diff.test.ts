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
