import assert from "node:assert/strict";
import test from "node:test";

import { corpusEventKeys, createVisualizationQueueWorker, r2EventObjectKey } from "../src/queue.js";
import { memoryBucket, queueBatch } from "./support.js";

const PAGE = '---\nokf_version: "0.2"\n---\n\n# Bundle\n';

test("event selection ignores output and coalesces unordered duplicates", () => {
  assert.equal(r2EventObjectKey({ object: { key: "shared/index.md" } }), "shared/index.md");
  assert.equal(r2EventObjectKey({ object: {} }), null);
  assert.deepEqual(corpusEventKeys([
    { object: { key: "shared/z.md" } },
    { object: { key: "views/shared.html" } },
    { object: { key: "shared/a.md" } },
    { object: { key: "shared/z.md" } },
    { object: { key: "other/a.md" } },
  ], "shared", "views"), ["shared/a.md", "shared/z.md"]);
});

test("one batch causes one full deterministic rebuild", async () => {
  const { bucket, writes } = memoryBucket({
    "shared/index.md": PAGE,
    "shared/concepts/a.md": "# A\n",
    "views/shared.html": "stale",
  });
  const worker = createVisualizationQueueWorker({
    bundle: "shared",
    bundlePrefix: "shared",
    outputPrefix: "views",
    outputKey: "views/shared.html",
    bucket: () => bucket,
    build: ({ documents }) => JSON.stringify(documents.map(({ path, content }) => ({ path, content }))),
  });
  const { batch, outcomes } = queueBatch("shared/concepts/a.md", "shared/index.md", "shared/index.md");
  await worker.queue(batch, {});
  assert.deepEqual(outcomes, ["ack"]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.key, "views/shared.html");
  assert.equal(writes[0]?.contentType, "text/html; charset=utf-8");
});

test("duplicate deliveries rebuild the same object from current state", async () => {
  const { bucket, writes } = memoryBucket({ "shared/index.md": PAGE });
  const worker = createVisualizationQueueWorker({
    bundle: "shared",
    bundlePrefix: "shared",
    outputPrefix: "views",
    outputKey: "views/shared.html",
    bucket: () => bucket,
    build: ({ documents }) => JSON.stringify(documents),
  });
  await worker.queue(queueBatch("shared/index.md").batch, {});
  await worker.queue(queueBatch("shared/index.md", "shared/index.md").batch, {});
  assert.equal(writes.length, 2);
  assert.equal(writes[0]?.body, writes[1]?.body);
});

test("output-only events acknowledge without reading or writing the bundle", async () => {
  const { bucket, writes } = memoryBucket({ "shared/index.md": PAGE });
  const worker = createVisualizationQueueWorker({
    bundle: "shared",
    bundlePrefix: "shared",
    outputPrefix: "views",
    outputKey: "views/shared.html",
    bucket: () => bucket,
    build: () => "never",
  });
  const { batch, outcomes } = queueBatch("views/shared.html");
  await worker.queue(batch, {});
  assert.deepEqual(outcomes, ["ack"]);
  assert.deepEqual(writes, []);
});

test("overlapping output and authored prefixes are refused", () => {
  assert.throws(() => createVisualizationQueueWorker({
    bundle: "shared",
    bundlePrefix: "shared",
    outputPrefix: "shared/views",
    outputKey: "shared/views/shared.html",
    bucket: () => null,
    build: () => "",
  }), /must not overlap/);
});
