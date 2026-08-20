import assert from "node:assert/strict";
import test from "node:test";

import { extractMarkdownLinks, resolveWithinBundle } from "../src/index.js";

test("extracts inline and reference links structurally while ignoring images and code", () => {
  const markdown = [
    "See [**inline**](./other.md#part \"Title\") and [reference][policy].",
    "",
    "![not an edge](image.md)",
    "",
    "`[not a link](code.md)`",
    "",
    "[policy]: ../policy.md",
    "",
  ].join("\n");
  const links = extractMarkdownLinks(markdown, {
    sourcePath: "guides/page.md",
    knownPaths: new Set(["guides/page.md", "guides/other.md", "policy.md"]),
  });
  assert.deepEqual(
    links.map(({ href, text, kind, resolvedPath, exists }) => ({ href, text, kind, resolvedPath, exists })),
    [
      { href: "./other.md#part", text: "inline", kind: "internal", resolvedPath: "guides/other.md", exists: true },
      { href: "../policy.md", text: "reference", kind: "internal", resolvedPath: "policy.md", exists: true },
    ],
  );
});

test("classifies fragment, external, escaped, and malformed destinations", () => {
  assert.deepEqual(resolveWithinBundle("a/page.md", "#part"), { kind: "fragment", fragment: "part" });
  assert.deepEqual(resolveWithinBundle("a/page.md", "https://example.com"), { kind: "external" });
  assert.deepEqual(resolveWithinBundle("page.md", "../outside.md"), { kind: "escape" });
  assert.deepEqual(resolveWithinBundle("page.md", "%ZZ"), { kind: "invalid" });
  assert.deepEqual(resolveWithinBundle("a/page.md", "/root.md?view=1#part"), {
    kind: "internal",
    path: "root.md",
    fragment: "part",
  });
});
