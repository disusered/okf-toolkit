import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { OPERATIONS_SCHEMA } from "okf-contracts";
import {
  BundlePathError,
  FilesystemBundle,
  applyChange,
  changePreviewId,
  contentRevision,
  normalizeBundlePath,
  parseChange,
  previewChange,
  readBundleContext,
  resolveBundleTarget,
  watchBundle,
} from "../src/index.js";
import type { Change } from "okf-contracts";
import { applyChangeWithHooks } from "../src/changes.js";

const INDEX = `---
okf_version: "0.2"
---

# Test bundle
`;

const CONCEPT = `---
type: Concept
title: Alpha
description: First concept.
---

# Alpha

[Index](../index.md)
`;

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "okf-node-"));
  await mkdir(path.join(root, "concepts"));
  await writeFile(path.join(root, "index.md"), INDEX);
  await writeFile(path.join(root, "concepts", "alpha.md"), CONCEPT);
  return root;
}

function applyRequest(change: Change) {
  return { change, preview_id: changePreviewId(change) };
}

function failPostWriteProfile() {
  let validationCalls = 0;
  return {
    id: "post-write-failure",
    validate() {
      validationCalls += 1;
      return validationCalls === 2
        ? [{ code: "test.post-write", path: ".", message: "injected post-write failure" }]
        : [];
    },
  };
}

test("filesystem adapter returns sorted UTF-8 documents with opaque revisions", async () => {
  const root = await fixture();
  const bundle = await FilesystemBundle.open(root);
  assert.deepEqual(await bundle.listPaths(), ["concepts/alpha.md", "index.md"]);
  const document = await bundle.readDocument("concepts/alpha.md");
  assert.equal(document.content, CONCEPT);
  assert.equal(document.revision, contentRevision(CONCEPT));
  assert.match(document.revision!, /^sha256:[0-9a-f]{64}$/);
});

test("filesystem ordering is code-point based rather than locale dependent", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "concepts", "z.md"), CONCEPT);
  await writeFile(path.join(root, "concepts", "ä.md"), CONCEPT);
  const bundle = await FilesystemBundle.open(root);
  assert.deepEqual(await bundle.listPaths(), [
    "concepts/alpha.md",
    "concepts/z.md",
    "concepts/ä.md",
    "index.md",
  ]);
});

test("filesystem adapter rejects traversal and symbolic links", async () => {
  const root = await fixture();
  const outside = path.join(await mkdtemp(path.join(tmpdir(), "okf-outside-")), "secret.md");
  await writeFile(outside, "secret");
  await symlink(outside, path.join(root, "concepts", "linked.md"));
  const bundle = await FilesystemBundle.open(root);
  await assert.rejects(bundle.readDocument("../secret.md"), BundlePathError);
  await assert.rejects(bundle.listPaths(), /symbolic links are not allowed/);
});

test("singular manifest resolves one named bundle and its instruction context", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "okf-manifest-"));
  await mkdir(path.join(project, ".agents"));
  await mkdir(path.join(project, "knowledge", "private"), { recursive: true });
  await writeFile(path.join(project, "AGENTS.md"), "# Instructions\n");
  await writeFile(path.join(project, "knowledge", "private", "index.md"), INDEX);
  await writeFile(path.join(project, ".agents", "okf.yaml"), `schema_version: 1
adapter: test
instructions:
  common:
    - AGENTS.md
bundles:
  private:
    root: knowledge/private
    index: index.md
`);

  const target = await resolveBundleTarget(path.join(project, "knowledge"));
  assert.equal(target.name, "private");
  assert.equal(target.bundle.root, path.join(project, "knowledge", "private"));
  assert.deepEqual(await readBundleContext(target), [{
    path: "AGENTS.md",
    content: "# Instructions\n",
    revision: contentRevision("# Instructions\n"),
  }]);
});

test("project target keeps manifest governance even when the project has an index", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "okf-project-root-"));
  await mkdir(path.join(project, ".agents"));
  await mkdir(path.join(project, "docs"));
  await writeFile(path.join(project, "index.md"), INDEX);
  await writeFile(path.join(project, "docs", "index.md"), INDEX.replace("Test bundle", "Governed docs"));
  await writeFile(path.join(project, ".agents", "okf.yaml"), `schema_version: 1
bundles:
  xbol:
    root: docs
`);

  const target = await resolveBundleTarget(project);
  assert.equal(target.name, "xbol");
  assert.equal(target.bundle.root, path.join(project, "docs"));
  assert.equal(target.manifestPath, path.join(project, ".agents", "okf.yaml"));
});

test("exact configured XBOL docs target keeps manifest governance", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "okf-xbol-docs-"));
  await mkdir(path.join(project, ".agents"));
  await mkdir(path.join(project, "docs"));
  await writeFile(path.join(project, "AGENTS.md"), "# XBOL governance\n");
  await writeFile(path.join(project, "docs", "index.md"), INDEX);
  await writeFile(path.join(project, ".agents", "okf.yaml"), `schema_version: 1
instructions:
  bundles:
    xbol:
      - AGENTS.md
bundles:
  xbol:
    root: docs
`);

  const target = await resolveBundleTarget(path.join(project, "docs"));
  assert.equal(target.name, "xbol");
  assert.equal(target.manifestPath, path.join(project, ".agents", "okf.yaml"));
  assert.equal((await readBundleContext(target))[0]?.content, "# XBOL governance\n");
});

test("an unowned direct bundle remains anonymous under an unrelated manifest", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "okf-anonymous-"));
  await mkdir(path.join(project, ".agents"));
  await mkdir(path.join(project, "governed"));
  await mkdir(path.join(project, "scratch"));
  await writeFile(path.join(project, "governed", "index.md"), INDEX);
  await writeFile(path.join(project, "scratch", "index.md"), INDEX);
  await writeFile(path.join(project, ".agents", "okf.yaml"), `schema_version: 1
bundles:
  governed:
    root: governed
`);

  const target = await resolveBundleTarget(path.join(project, "scratch"));
  assert.equal(target.name, null);
  assert.equal(target.manifestPath, null);
  assert.equal(target.bundle.root, path.join(project, "scratch"));
});

test("change preview and apply enforce revisions across all variants", async () => {
  const root = await fixture();
  const bundle = await FilesystemBundle.open(root);

  const create = { operation: "create", path: "concepts/beta.md", content: CONCEPT.replaceAll("Alpha", "Beta") } as const;
  const createPreview = await previewChange(bundle, create);
  assert.equal(createPreview.schema, OPERATIONS_SCHEMA);
  assert.equal(createPreview.passed, true);
  assert.match(createPreview.diff, /\+\+\+ b\/concepts\/beta\.md/);
  assert.equal((await applyChange(await FilesystemBundle.open(root), applyRequest(create))).outcome, "applied");
  assert.equal((await applyChange(bundle, applyRequest(create))).outcome, "unchanged");

  const beta = await bundle.readDocument("concepts/beta.md");
  assert.ok(beta.revision);
  const update = {
    operation: "update",
    path: "concepts/beta.md",
    content: beta.content.replace("First concept.", "Second concept."),
    expected_revision: beta.revision,
  } as const;
  assert.equal((await applyChange(bundle, applyRequest(update))).outcome, "applied");
  assert.equal((await applyChange(bundle, applyRequest(update))).outcome, "unchanged");

  const revised = await bundle.readDocument("concepts/beta.md");
  assert.ok(revised.revision);
  const move = {
    operation: "move",
    from_path: "concepts/beta.md",
    to_path: "archive/beta.md",
    expected_revision: revised.revision,
  } as const;
  assert.equal((await applyChange(bundle, applyRequest(move))).outcome, "applied");
  assert.equal((await applyChange(bundle, applyRequest(move))).outcome, "unchanged");
  assert.equal(await readFile(path.join(root, "archive", "beta.md"), "utf8"), revised.content);

  const moved = await bundle.readDocument("archive/beta.md");
  assert.ok(moved.revision);
  const deletion = { operation: "delete", path: "archive/beta.md", expected_revision: moved.revision } as const;
  assert.equal((await applyChange(bundle, applyRequest(deletion))).outcome, "applied");
  assert.equal((await applyChange(bundle, applyRequest(deletion))).outcome, "unchanged");
  await assert.rejects(readFile(path.join(root, "archive", "beta.md")), { code: "ENOENT" });
});

test("bundle analysis is a storage-neutral okf.inspect.v1 snapshot", async () => {
  const bundle = await FilesystemBundle.open(await fixture());
  const analysis = await bundle.analyze();
  assert.equal(analysis.schema, "okf.inspect.v1");
  assert.equal(analysis.okfVersion, "0.2");
  assert.equal(analysis.summary.documents, 2);
});

test("apply refuses a proposed bundle with core errors and does not write it", async () => {
  const root = await fixture();
  const bundle = await FilesystemBundle.open(root);
  const invalid = { operation: "create", path: "concepts/invalid.md", content: "# No frontmatter\n" } as const;
  const preview = await previewChange(bundle, invalid);
  assert.equal(preview.passed, false);
  assert.ok(preview.diagnostics.some((diagnostic) => diagnostic.code === "core.concept.frontmatter.missing"));
  assert.equal((await applyChange(bundle, applyRequest(invalid))).outcome, "rejected");
  await assert.rejects(readFile(path.join(root, "concepts", "invalid.md")), { code: "ENOENT" });
});

test("watch emits a fresh single-bundle analysis after Markdown changes", async () => {
  const root = await fixture();
  const bundle = await FilesystemBundle.open(root);
  const controller = new AbortController();
  const eventPromise = new Promise<{ changed: readonly string[]; schema: string }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("watch event timed out")), 2_000);
    watchBundle(bundle, (event) => {
      clearTimeout(timeout);
      controller.abort();
      resolve(event);
    }, { debounceMs: 10, signal: controller.signal });
  });
  await writeFile(path.join(root, "concepts", "alpha.md"), CONCEPT.replace("First concept.", "Revised concept."));
  const event = await eventPromise;
  assert.equal(event.schema, "okf.watch.v1");
  assert.ok(event.changed.includes("concepts/alpha.md"));
});

test("preview ids match canonical contract vectors and change with reviewed input", () => {
  const create = {
    operation: "create",
    path: "concepts/new-page.md",
    content: "---\ntype: Note\n---\n# New page\n",
  } as const;
  const update = {
    operation: "update",
    path: "concepts/page.md",
    content: "---\ntype: Note\n---\n# Updated page\n",
    expected_revision: "opaque-revision-1",
  } as const;
  assert.equal(changePreviewId(create), "sha256:5de53d466647b768ecb7ed4c63f31cb4c38b03c624800ea73924c42286a4788e");
  assert.equal(changePreviewId(update), "sha256:34d88fbb989098faf9dea06fd41e9524643aad545cc0a0e862943feae7815ee2");
  assert.notEqual(changePreviewId(create), changePreviewId({ ...create, content: `${create.content}\n` }));
});

test("bundle paths preserve exact Unicode and operation paths require lowercase .md", () => {
  const composed = "concepts/\u00e9.md";
  const decomposed = "concepts/e\u0301.md";
  assert.equal(normalizeBundlePath(decomposed), decomposed);
  assert.equal(normalizeBundlePath(" concepts/page.md "), " concepts/page.md ");
  assert.notEqual(
    changePreviewId({ operation: "create", path: composed, content: CONCEPT }),
    changePreviewId({ operation: "create", path: decomposed, content: CONCEPT }),
  );
  assert.throws(
    () => parseChange({ operation: "create", path: "concepts/page.MD", content: CONCEPT }),
    /must end in \.md/,
  );
  assert.throws(
    () => parseChange({ operation: "create", path: "concepts/page.md ", content: CONCEPT }),
    /must end in \.md/,
  );
});

test("apply rejects a preview id for different input before writing", async () => {
  const root = await fixture();
  const bundle = await FilesystemBundle.open(root);
  const reviewed = { operation: "create", path: "concepts/reviewed.md", content: CONCEPT } as const;
  const changed = { ...reviewed, path: "concepts/changed.md" } as const;
  const result = await applyChange(bundle, { change: changed, preview_id: changePreviewId(reviewed) });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.diagnostics[0]?.code, "change.preview_id.conflict");
  await assert.rejects(readFile(path.join(root, "concepts", "changed.md")), { code: "ENOENT" });
});

test("move apply finishes deletion when matching source and destination both exist", async () => {
  const root = await fixture();
  const bundle = await FilesystemBundle.open(root);
  const source = await bundle.readDocument("concepts/alpha.md");
  await mkdir(path.join(root, "archive"));
  await writeFile(path.join(root, "archive", "alpha.md"), source.content);
  const move = {
    operation: "move",
    from_path: "concepts/alpha.md",
    to_path: "archive/alpha.md",
    expected_revision: source.revision!,
  } as const;
  const result = await applyChange(bundle, applyRequest(move));
  assert.equal(result.outcome, "applied");
  await assert.rejects(readFile(path.join(root, "concepts", "alpha.md")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, "archive", "alpha.md"), "utf8"), source.content);
});

test("move apply rejects EXDEV without copying or deleting the source", async () => {
  const root = await fixture();
  const bundle = await FilesystemBundle.open(root);
  const source = await bundle.readDocument("concepts/alpha.md");
  const move = {
    operation: "move",
    from_path: "concepts/alpha.md",
    to_path: "archive/alpha.md",
    expected_revision: source.revision!,
  } as const;
  const result = await applyChangeWithHooks(bundle, applyRequest(move), {}, {
    link: async () => {
      const error = new Error("cross-device link") as NodeJS.ErrnoException;
      error.code = "EXDEV";
      throw error;
    },
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.diagnostics[0]?.code, "change.move.cross_device_conflict");
  assert.equal(await readFile(path.join(root, "concepts", "alpha.md"), "utf8"), source.content);
  await assert.rejects(lstat(path.join(root, "archive")), { code: "ENOENT" });
});

test("post-write validation failure restores update bytes and mode", async () => {
  const root = await fixture();
  const bundle = await FilesystemBundle.open(root);
  const before = await bundle.readDocument("concepts/alpha.md");
  const mode = (await lstat(path.join(root, "concepts", "alpha.md"))).mode;
  const update = {
    operation: "update",
    path: "concepts/alpha.md",
    content: before.content.replace("First concept.", "Updated concept."),
    expected_revision: before.revision!,
  } as const;
  const result = await applyChange(bundle, applyRequest(update), { profile: failPostWriteProfile() });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.diagnostics[0]?.code, "change.post_write.validation_failed");
  assert.equal(await readFile(path.join(root, "concepts", "alpha.md"), "utf8"), before.content);
  assert.equal((await lstat(path.join(root, "concepts", "alpha.md"))).mode, mode);
});

test("post-write validation rollback removes creates and restores deletes and moves", async () => {
  const createRoot = await fixture();
  const createBundle = await FilesystemBundle.open(createRoot);
  const create = { operation: "create", path: "new/note.md", content: CONCEPT } as const;
  assert.equal(
    (await applyChange(createBundle, applyRequest(create), { profile: failPostWriteProfile() })).outcome,
    "rejected",
  );
  await assert.rejects(lstat(path.join(createRoot, "new")), { code: "ENOENT" });

  const deleteRoot = await fixture();
  const deleteBundle = await FilesystemBundle.open(deleteRoot);
  const beforeDelete = await deleteBundle.readDocument("concepts/alpha.md");
  const deleteMode = (await lstat(path.join(deleteRoot, "concepts", "alpha.md"))).mode;
  const deletion = {
    operation: "delete",
    path: "concepts/alpha.md",
    expected_revision: beforeDelete.revision!,
  } as const;
  assert.equal(
    (await applyChange(deleteBundle, applyRequest(deletion), { profile: failPostWriteProfile() })).outcome,
    "rejected",
  );
  assert.equal(await readFile(path.join(deleteRoot, "concepts", "alpha.md"), "utf8"), beforeDelete.content);
  assert.equal((await lstat(path.join(deleteRoot, "concepts", "alpha.md"))).mode, deleteMode);

  const moveRoot = await fixture();
  const moveBundle = await FilesystemBundle.open(moveRoot);
  const beforeMove = await moveBundle.readDocument("concepts/alpha.md");
  const moveMode = (await lstat(path.join(moveRoot, "concepts", "alpha.md"))).mode;
  const move = {
    operation: "move",
    from_path: "concepts/alpha.md",
    to_path: "archive/alpha.md",
    expected_revision: beforeMove.revision!,
  } as const;
  assert.equal(
    (await applyChange(moveBundle, applyRequest(move), { profile: failPostWriteProfile() })).outcome,
    "rejected",
  );
  assert.equal(await readFile(path.join(moveRoot, "concepts", "alpha.md"), "utf8"), beforeMove.content);
  assert.equal((await lstat(path.join(moveRoot, "concepts", "alpha.md"))).mode, moveMode);
  await assert.rejects(lstat(path.join(moveRoot, "archive")), { code: "ENOENT" });
});
