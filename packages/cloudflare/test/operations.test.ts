import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { Change } from "okf-contracts";
import type { ValidationProfile } from "okf-core";
import { changePreviewId as nodeChangePreviewId } from "okf-node";

import {
  changePreviewId,
  createR2OkfV1Operations,
  readR2ContextDocuments,
} from "../src/operations.js";
import { R2BundleAdapter } from "../src/r2.js";
import { memoryBucket } from "./support.js";

const INDEX = '---\nokf_version: "0.2"\n---\n\n# Shared\n\n- [A](concepts/a.md)\n';
const CONCEPT = "---\ntype: Concept\ntitle: A\ndescription: The first page.\nstatus: stable\n---\n\n# A\n";
const SECOND = "---\ntype: Concept\ntitle: B\ndescription: The second page.\nstatus: stable\n---\n\n# B\n";

test("R2 operations compose canonical inspect, search, links, and context", async () => {
  const { bucket } = memoryBucket({
    "shared/index.md": INDEX,
    "shared/concepts/a.md": CONCEPT,
    "instructions/agents.md": "# Rules",
  });
  const adapter = new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" });
  const operations = createR2OkfV1Operations({
    adapter,
    audience: "team",
    instructions: () => readR2ContextDocuments(bucket, ["instructions/agents.md"]),
    visualizationUrl: "https://example.test/v1/viz",
  });

  const context = await operations.context();
  assert.equal(context["bundle"], "shared");
  assert.equal(context["audience"], "team");
  assert.deepEqual(context["instructions"], [
    { path: "instructions/agents.md", content: "# Rules" },
  ]);
  const inspect = await operations.inspect();
  assert.equal(inspect["schema"], "okf.inspect.v1");
  const search = await operations.search({ query: "first page", limit: 5 });
  assert.equal((search["matches"] as { path: string }[])[0]?.path, "concepts/a.md");
  const links = await operations.links({ path: "concepts/a.md" });
  assert.deepEqual(links["backlinks"], [{ path: "index.md", href: "concepts/a.md" }]);
});

test("context accepts a conformant bundle without a root index", async () => {
  const { bucket } = memoryBucket({ "shared/concepts/a.md": CONCEPT });
  const operations = createR2OkfV1Operations({
    adapter: new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" }),
  });
  const context = await operations.context();
  assert.equal(context["index"], null);
  assert.equal((await operations.inspect())["okfVersion"], null);
});

test("list uses the same exact path policy as R2 reads", async () => {
  const { bucket } = memoryBucket({ "shared/ concepts/a.md": CONCEPT });
  const operations = createR2OkfV1Operations({
    adapter: new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" }),
  });
  assert.deepEqual((await operations.list({ path: " concepts", depth: 1 }))["entries"], [
    { path: " concepts/a.md", type: "markdown" },
  ]);
  await assert.rejects(() => operations.list({ path: "/concepts", depth: 1 }), /not confined/);
  await assert.rejects(() => operations.list({ path: "concepts/", depth: 1 }), /not confined/);
});

test("preview and apply revalidate a full snapshot", async () => {
  const { bucket, objects } = memoryBucket({
    "shared/index.md": INDEX,
    "shared/concepts/a.md": CONCEPT,
  });
  const adapter = new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" });
  const operations = createR2OkfV1Operations({ adapter });

  const preview = await operations.previewChange({
    operation: "create",
    path: "concepts/b.md",
    content: SECOND,
  });
  assert.equal(preview.passed, true);
  assert.match(preview.preview_id, /^sha256:[0-9a-f]{64}$/);
  const result = await operations.applyChange({
    change: {
      operation: "create",
      path: "concepts/b.md",
      content: SECOND,
    },
    preview_id: preview.preview_id,
  });
  assert.equal(result.outcome, "applied");
  assert.equal(objects.get("shared/concepts/b.md")?.body, SECOND);
});

test("onApplied receives the written bundle without listing it again", async () => {
  const { bucket, reads } = memoryBucket({
    "shared/index.md": INDEX,
    "shared/concepts/a.md": CONCEPT,
  });
  const adapter = new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" });
  const seen: { paths: readonly string[]; nodes: number }[] = [];
  const operations = createR2OkfV1Operations({
    adapter,
    onApplied: ({ analysis, documents }) => {
      seen.push({
        paths: documents.map((document) => document.path),
        nodes: analysis.graph.nodes.length,
      });
    },
  });

  const change: Change = { operation: "create", path: "concepts/b.md", content: SECOND };
  const preview = await operations.previewChange(change);
  const before = reads.length;
  const result = await operations.applyChange({ change, preview_id: preview.preview_id });

  assert.equal(result.outcome, "applied");
  assert.equal(seen.length, 1);
  // The analysis is of the bundle as written, so the new page is present.
  assert.deepEqual([...(seen[0]?.paths ?? [])].sort(), ["concepts/a.md", "concepts/b.md", "index.md"]);
  assert.equal(seen[0]?.nodes, 2);
  // The hook exists so a consumer need not re-read the bundle. The apply reads the two pages
  // already on storage exactly once each; the created page is not there yet and comes from the
  // change itself. A second full pass, which is what this hook replaces, would double it.
  const readsDuringApply = reads.length - before;
  assert.equal(readsDuringApply, 2, "an apply reads each stored document exactly once");
});

test("onApplied does not fire when a change is rejected or changes nothing", async () => {
  const { bucket } = memoryBucket({
    "shared/index.md": INDEX,
    "shared/concepts/a.md": CONCEPT,
  });
  const adapter = new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" });
  let calls = 0;
  const operations = createR2OkfV1Operations({ adapter, onApplied: () => { calls += 1; } });

  const change: Change = { operation: "create", path: "concepts/a.md", content: CONCEPT };
  const preview = await operations.previewChange(change);
  assert.equal((await operations.applyChange({ change, preview_id: preview.preview_id })).outcome, "unchanged");
  assert.equal(calls, 0);

  const rejectedResult = await operations.applyChange({ change, preview_id: "sha256:not-the-preview" });
  assert.equal(rejectedResult.outcome, "rejected");
  assert.equal(calls, 0);
});

test("profile errors and stale revisions reject without storage writes", async () => {
  const { bucket, writes } = memoryBucket({
    "shared/index.md": INDEX,
    "shared/concepts/a.md": CONCEPT,
  });
  const adapter = new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" });
  const profile: ValidationProfile = {
    id: "shared-only",
    validate(context) {
      return context.documents.some((document) => document.path === "concepts/b.md")
        ? [{ code: "shared.refuse-b", path: "concepts/b.md", message: "B is not shared" }]
        : [];
    },
  };
  const operations = createR2OkfV1Operations({ adapter, analysis: { profile } });

  const profiledChange = { operation: "create", path: "concepts/b.md", content: SECOND } as const;
  const profiled = await operations.applyChange({
    change: profiledChange,
    preview_id: await changePreviewId(profiledChange),
  });
  assert.equal(profiled.outcome, "rejected");

  const staleChange = {
    operation: "update",
    path: "concepts/a.md",
    content: `${CONCEPT}\nChanged.\n`,
    expected_revision: "stale",
  } as const;
  const stale = await operations.applyChange({
    change: staleChange,
    preview_id: await changePreviewId(staleChange),
  });
  assert.equal(stale.outcome, "rejected");
  assert.deepEqual(writes, []);
});

test("an identical update is unchanged and does not rotate the revision", async () => {
  const { bucket, writes } = memoryBucket({ "shared/index.md": INDEX, "shared/concepts/a.md": CONCEPT });
  const adapter = new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" });
  const current = await adapter.read("concepts/a.md");
  const operations = createR2OkfV1Operations({ adapter });
  const change = {
    operation: "update",
    path: "concepts/a.md",
    content: CONCEPT,
    expected_revision: current.revision!,
  } as const;
  const result = await operations.applyChange({
    change,
    preview_id: await changePreviewId(change),
  });
  assert.equal(result.outcome, "unchanged");
  assert.equal(result.revisions["concepts/a.md"], current.revision);
  assert.deepEqual(writes, []);
});

test("hosted and filesystem preview ids match every language-neutral vector", async () => {
  const fixtureUrl = import.meta.resolve("okf-contracts/fixtures/operations/apply-request.json");
  const fixture = JSON.parse(await readFile(new URL(fixtureUrl), "utf8")) as {
    readonly digest_vectors: readonly {
      readonly name: string;
      readonly change: Change;
      readonly preview_id: string;
    }[];
  };
  for (const vector of fixture.digest_vectors) {
    assert.equal(await changePreviewId(vector.change), vector.preview_id, vector.name);
    assert.equal(nodeChangePreviewId(vector.change), vector.preview_id, vector.name);
  }
});

test("a mismatched preview is rejected before any storage mutation", async () => {
  const { bucket, writes } = memoryBucket({ "shared/index.md": INDEX });
  const operations = createR2OkfV1Operations({
    adapter: new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" }),
  });
  const result = await operations.applyChange({
    change: { operation: "create", path: "concepts/b.md", content: SECOND },
    preview_id: `sha256:${"0".repeat(64)}`,
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.diagnostics[0]?.code, "change.preview.mismatch");
  assert.deepEqual(writes, []);
});

test("create, update, and delete accept duplicate stateless delivery", async () => {
  const { bucket } = memoryBucket({ "shared/index.md": INDEX, "shared/concepts/a.md": CONCEPT });
  const adapter = new R2BundleAdapter(bucket, { bundle: "shared", prefix: "shared" });
  const operations = createR2OkfV1Operations({ adapter });

  const create = { operation: "create", path: "concepts/b.md", content: SECOND } as const;
  const createRequest = { change: create, preview_id: await changePreviewId(create) };
  assert.equal((await operations.applyChange(createRequest)).outcome, "applied");
  assert.equal((await operations.applyChange(createRequest)).outcome, "unchanged");

  const original = await adapter.read("concepts/a.md");
  const update = {
    operation: "update",
    path: "concepts/a.md",
    content: `${CONCEPT}\nUpdated.\n`,
    expected_revision: original.revision!,
  } as const;
  const updateRequest = { change: update, preview_id: await changePreviewId(update) };
  assert.equal((await operations.applyChange(updateRequest)).outcome, "applied");
  assert.equal((await operations.applyChange(updateRequest)).outcome, "unchanged");

  const current = await adapter.read("concepts/a.md");
  const remove = {
    operation: "delete",
    path: "concepts/a.md",
    expected_revision: current.revision!,
  } as const;
  const deleteRequest = { change: remove, preview_id: await changePreviewId(remove) };
  assert.equal((await operations.applyChange(deleteRequest)).outcome, "applied");
  assert.equal((await operations.applyChange(deleteRequest)).outcome, "unchanged");
});

test("an interrupted move resumes after a server restart and then accepts replay", async () => {
  const memory = memoryBucket({ "shared/index.md": INDEX, "shared/concepts/a.md": CONCEPT });
  let failDelete = true;
  const flaky = {
    ...memory.bucket,
    async delete(key: string) {
      if (key === "shared/concepts/a.md" && failDelete) {
        failDelete = false;
        throw new Error("interrupted after destination put");
      }
      await memory.bucket.delete(key);
    },
  };
  const firstAdapter = new R2BundleAdapter(flaky, { bundle: "shared", prefix: "shared" });
  const source = await firstAdapter.read("concepts/a.md");
  const change = {
    operation: "move",
    from_path: "concepts/a.md",
    to_path: "concepts/moved.md",
    expected_revision: source.revision!,
  } as const;
  const request = { change, preview_id: await changePreviewId(change) };
  const first = await createR2OkfV1Operations({ adapter: firstAdapter }).applyChange(request);
  assert.equal(first.outcome, "rejected");
  assert.equal(memory.objects.has("shared/concepts/a.md"), true);
  assert.equal(memory.objects.has("shared/concepts/moved.md"), true);

  const restarted = createR2OkfV1Operations({
    adapter: new R2BundleAdapter(flaky, { bundle: "shared", prefix: "shared" }),
  });
  assert.equal((await restarted.applyChange(request)).outcome, "applied");
  assert.equal(memory.objects.has("shared/concepts/a.md"), false);
  assert.equal(memory.objects.get("shared/concepts/moved.md")?.body, CONCEPT);
  assert.equal((await restarted.applyChange(request)).outcome, "unchanged");
});

test("a move compensates its marked destination if the source turns stale", async () => {
  const memory = memoryBucket({ "shared/index.md": INDEX, "shared/concepts/a.md": CONCEPT });
  let mutateAfterDestination = true;
  const racing = {
    ...memory.bucket,
    async put(key: string, value: string | Uint8Array, options?: Parameters<typeof memory.bucket.put>[2]) {
      const result = await memory.bucket.put(key, value, options);
      if (key === "shared/concepts/moved.md" && result && mutateAfterDestination) {
        mutateAfterDestination = false;
        await memory.bucket.put("shared/concepts/a.md", `${CONCEPT}\nConcurrent edit.\n`);
      }
      return result;
    },
  };
  const adapter = new R2BundleAdapter(racing, { bundle: "shared", prefix: "shared" });
  const source = await adapter.read("concepts/a.md");
  const change = {
    operation: "move",
    from_path: "concepts/a.md",
    to_path: "concepts/moved.md",
    expected_revision: source.revision!,
  } as const;
  const result = await createR2OkfV1Operations({ adapter }).applyChange({
    change,
    preview_id: await changePreviewId(change),
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(memory.objects.has("shared/concepts/moved.md"), false);
  assert.match(memory.objects.get("shared/concepts/a.md")?.body ?? "", /Concurrent edit/);
});

test("move rejects a stale source and an unrelated destination conflict", async () => {
  const memory = memoryBucket({
    "shared/index.md": INDEX,
    "shared/concepts/a.md": CONCEPT,
    "shared/concepts/moved.md": SECOND,
  });
  const adapter = new R2BundleAdapter(memory.bucket, { bundle: "shared", prefix: "shared" });
  const source = await adapter.read("concepts/a.md");
  const conflict = {
    operation: "move",
    from_path: "concepts/a.md",
    to_path: "concepts/moved.md",
    expected_revision: source.revision!,
  } as const;
  const conflictResult = await createR2OkfV1Operations({ adapter }).applyChange({
    change: conflict,
    preview_id: await changePreviewId(conflict),
  });
  assert.equal(conflictResult.outcome, "rejected");
  assert.equal(memory.objects.get("shared/concepts/moved.md")?.body, SECOND);

  const stale = { ...conflict, to_path: "concepts/other.md" } as const;
  await adapter.update("concepts/a.md", `${CONCEPT}\nChanged.\n`, source.revision!);
  const staleResult = await createR2OkfV1Operations({ adapter }).applyChange({
    change: stale,
    preview_id: await changePreviewId(stale),
  });
  assert.equal(staleResult.outcome, "rejected");
  assert.equal(memory.objects.has("shared/concepts/other.md"), false);
});
