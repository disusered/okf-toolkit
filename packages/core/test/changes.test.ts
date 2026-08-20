import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { Change } from "okf-contracts";

import {
  canonicalChangeJson,
  canonicalizeBundlePath,
  canonicalizeOperationPath,
  parseChange,
} from "../src/index.js";

interface DigestVector {
  readonly name: string;
  readonly change: Change;
  readonly canonical_json: string;
  readonly preview_id: string;
}

test("path validation preserves exact Unicode and significant whitespace", () => {
  const decomposed = "concepts/Cafe\u0301.md";
  assert.equal(canonicalizeBundlePath(decomposed), decomposed);
  assert.notEqual(decomposed, decomposed.normalize("NFC"));
  assert.equal(canonicalizeOperationPath(" page.md"), " page.md");
  assert.equal(canonicalizeOperationPath("dir /page.md"), "dir /page.md");
  assert.throws(() => canonicalizeOperationPath("page.md "), /end in \.md/);
});

test("path validation rejects absolute, aliased, empty, and unsafe keys", () => {
  for (const path of [
    "",
    "\0.md",
    "/page.md",
    "C:/page.md",
    "a\\page.md",
    "a//page.md",
    "a/./page.md",
    "a/../page.md",
  ]) {
    assert.throws(() => canonicalizeOperationPath(path), path);
  }
  assert.throws(() => canonicalizeOperationPath("page.MD"), /end in \.md/);
});

test("change parsing is strict and returns path-confined discriminated values", () => {
  assert.deepEqual(parseChange({ operation: "delete", path: "page.md", expected_revision: "r1" }), {
    operation: "delete",
    path: "page.md",
    expected_revision: "r1",
  });
  assert.throws(
    () => parseChange({ operation: "delete", path: "page.md", expected_revision: "r1", extra: true }),
    /exactly/,
  );
  assert.throws(() => parseChange({ operation: "delete", path: "page.md", expected_revision: "" }), /non-empty/);
});

test("language-neutral change digest vectors agree with canonical JSON", async () => {
  const url = new URL("../../../contracts/fixtures/operations/apply-request.json", import.meta.url);
  const fixture = JSON.parse(await readFile(url, "utf8")) as { readonly digest_vectors: readonly DigestVector[] };
  for (const vector of fixture.digest_vectors) {
    const canonical = canonicalChangeJson(vector.change);
    const digest = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
    assert.equal(canonical, vector.canonical_json, vector.name);
    assert.equal(digest, vector.preview_id, vector.name);
  }
});
