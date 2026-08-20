import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeBundle } from "okf-core";
import { FilesystemBundle } from "okf-node";
import type { RawBundleDocument } from "okf-contracts";

import { confinedBundlePath, R2BundleAdapter, R2BundleError } from "../src/r2.js";
import { memoryBucket } from "./support.js";

test("filesystem and R2 adapters produce the same analysis for the same bytes", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "okf-adapter-parity-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "concepts"));

  const source = {
    "index.md": "---\nokf_version: \"0.2\"\n---\n# Bundle\n\n[Page](concepts/page.md)\n",
    "concepts/page.md": "---\ntype: Note\ntitle: Page\n---\n# Page\n",
  } as const;
  await Promise.all(Object.entries(source).map(([documentPath, content]) =>
    writeFile(path.join(root, ...documentPath.split("/")), content, "utf8")
  ));

  const local = await (await FilesystemBundle.open(root)).readDocuments();
  const { bucket } = memoryBucket(Object.fromEntries(
    Object.entries(source).map(([documentPath, content]) => [`shared/${documentPath}`, content]),
  ));
  const hosted = await new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" }).documents();
  const withoutStorageRevision = (documents: readonly RawBundleDocument[]) =>
    documents.map(({ path, content }) => ({ path, content }));

  assert.deepEqual(withoutStorageRevision(local), withoutStorageRevision(hosted));
  assert.deepEqual(
    analyzeBundle(withoutStorageRevision(local), { today: "2026-08-20" }),
    analyzeBundle(withoutStorageRevision(hosted), { today: "2026-08-20" }),
  );
});

test("the adapter lists only Markdown under its one configured prefix", async () => {
  const { bucket } = memoryBucket({
    "shared/index.md": "index",
    "shared/concepts/b.md": "b",
    "shared/concepts/a.md": "a",
    "shared/data.json": "{}",
    "private/secret.md": "secret",
  });
  const adapter = new R2BundleAdapter(bucket, { bundle: "shared", prefix: "/shared/" });
  assert.deepEqual((await adapter.documents()).map((document) => document.path), [
    "concepts/a.md",
    "concepts/b.md",
    "index.md",
  ]);
});

test("bundle paths cannot escape or alias the prefix", () => {
  assert.equal(confinedBundlePath("concepts/a.md"), "concepts/a.md");
  assert.equal(confinedBundlePath(" concepts/a.md"), " concepts/a.md");
  const decomposed = "concepts/cafe\u0301.md";
  assert.equal(confinedBundlePath(decomposed), decomposed);
  for (const path of ["/index.md", "C:/index.md", "../index.md", "a/../index.md", "a//b.md", "a\\b.md"]) {
    assert.throws(() => confinedBundlePath(path), R2BundleError);
  }
  const { bucket } = memoryBucket();
  for (const prefix of ["../shared", "shared//drafts", "C:/shared"]) {
    assert.throws(() => new R2BundleAdapter(bucket, { bundle: "shared", prefix }), R2BundleError);
  }
  assert.equal(new R2BundleAdapter(bucket, { bundle: "shared", prefix: " shared " }).prefix, " shared /");
});

test("R2 list and read preserve exact Unicode storage keys", async () => {
  const decomposed = "concepts/cafe\u0301.md";
  const composed = "concepts/caf\u00e9.md";
  const { bucket } = memoryBucket({ [`shared/${decomposed}`]: "# Decomposed\n" });
  const adapter = new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" });
  assert.equal((await adapter.documents())[0]?.path, decomposed);
  assert.equal((await adapter.read(decomposed)).content, "# Decomposed\n");
  await assert.rejects(() => adapter.read(composed), /does not exist/);
});

test("conditional create and update preserve revision checks", async () => {
  const { bucket, objects } = memoryBucket({ "shared/index.md": "old" });
  const adapter = new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" });
  const current = await adapter.read("index.md");
  await assert.rejects(() => adapter.create("index.md", "duplicate"), /already exists/);
  await assert.rejects(() => adapter.update("index.md", "stale", "wrong"), /revision changed/);
  const revision = await adapter.update("index.md", "new", current.revision!);
  assert.equal(objects.get("shared/index.md")?.body, "new");
  assert.notEqual(revision, current.revision);
});

test("storage change variants are confined to the configured bundle", async () => {
  const { bucket, objects } = memoryBucket({ "shared/a.md": "a" });
  const adapter = new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" });
  const current = await adapter.read("a.md");
  const moved = await adapter.applyStorageChange({
    operation: "move",
    from_path: "a.md",
    to_path: "nested/a.md",
    expected_revision: current.revision!,
  }, `sha256:${"a".repeat(64)}`);
  assert.equal(objects.has("shared/a.md"), false);
  assert.equal(objects.get("shared/nested/a.md")?.body, "a");
  assert.equal(moved["a.md"], null);
  assert.ok(moved["nested/a.md"]);
});
