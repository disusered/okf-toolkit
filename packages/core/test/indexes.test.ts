import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBundle, generateBundleIndexes, selectBundleIndex } from "../src/index.js";

const root = { path: "index.md", content: '---\nokf_version: "0.2"\n---\n\n# Knowledge\n\n[Unrelated](a.md)\n' };
const page = (path: string, title: string, description = "A description") => ({ path,
  content: `---\ntype: Concept\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${title}\n` });

test("indexes disclose one directory and preserve the root format declaration", () => {
  const analysis = analyzeBundle([root, page("a.md", "A"), page("guides/b.md", "B"), page("guides/deep/c.md", "C")]);
  const indexes = generateBundleIndexes(analysis);
  assert.deepEqual(indexes.map((index) => index.directory), [".", "guides", "guides/deep"]);
  const top = selectBundleIndex(indexes);
  assert.deepEqual(top.entries.map((entry) => entry.path), ["a.md", "guides"]);
  assert.match(top.content, /^---\nokf_version: "0.2"\n---\n/);
  assert.match(top.content, /\[A\]\(a.md\) — A description/);
  const nested = selectBundleIndex(indexes, "guides");
  assert.deepEqual(nested.entries.map((entry) => entry.href), ["b.md", "deep/index.md"]);
  assert.ok(!nested.content.startsWith("---"));
  assert.equal(analysis.graph.nodes.length, 3);
  assert.equal(analysis.graph.edges.length, 0);
  assert.equal(analysis.documents.find((document) => document.path === "index.md")?.content, root.content);
  assert.throws(() => selectBundleIndex(indexes, "../outside"));
  assert.throws(() => selectBundleIndex(indexes, "missing"), /does not exist/);
});

test("regeneration reflects create, move, delete, title and description changes", () => {
  const first = generateBundleIndexes(analyzeBundle([root, page("old/a.md", "Before")]));
  const next = generateBundleIndexes(analyzeBundle([root, page("new/b.md", "After", "Updated"), page("new/c.md", "Created")]));
  assert.ok(first.some((index) => index.directory === "old"));
  assert.ok(!next.some((index) => index.directory === "old"));
  assert.deepEqual(selectBundleIndex(next, "new").entries.map(({ title, description }) => ({ title, description })),
    [{ title: "After", description: "Updated" }, { title: "Created", description: "A description" }]);
  assert.deepEqual(generateBundleIndexes(analyzeBundle([root])).map((index) => index.entries), [[]]);
});

test("generated Markdown escapes metadata and link destinations", () => {
  const index = selectBundleIndex(generateBundleIndexes(analyzeBundle([root,
    page("a (b)#c.md", "[unsafe](x)", "<script>\nnext")])));
  assert.equal(index.entries[0]?.href, "a%20%28b%29%23c.md");
  assert.ok(index.content.includes("\\[unsafe\\](x)"));
  assert.ok(index.content.includes("\\<script\\> next"));
});
