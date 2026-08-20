import assert from "node:assert/strict";
import test from "node:test";

import type { OkfV1Operations } from "../src/mcp.js";
import { createOkfV1Worker } from "../src/worker.js";
import { memoryBucket } from "./support.js";

const neverOperations = {} as OkfV1Operations;

test("authorization runs before path disclosure", async () => {
  const { bucket } = memoryBucket({ "views/shared.html": "<!doctype html>" });
  const worker = createOkfV1Worker({
    name: "test",
    version: "1",
    bundle: "shared",
    visualizationKey: "views/shared.html",
    bucket: () => bucket,
    authorize: async () => null,
    canApply: async () => false,
    operations: () => neverOperations,
  });
  assert.equal((await worker.fetch(new Request("https://example.test/not-real"), {})).status, 401);
});

test("the versioned visualization route serves private uncached HTML", async () => {
  const { bucket } = memoryBucket({ "views/shared.html": "<!doctype html>" });
  const worker = createOkfV1Worker({
    name: "test",
    version: "1",
    bundle: "shared",
    visualizationKey: "views/shared.html",
    bucket: () => bucket,
    authorize: async () => ({ subject: "user" }),
    canApply: async () => false,
    operations: () => neverOperations,
  });
  const response = await worker.fetch(new Request("https://example.test/v1/viz"), {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<!doctype html>");
  assert.equal(response.headers.get("cache-control"), "no-store, private");
});

test("write authorization is a deployment composition point", async () => {
  const { bucket } = memoryBucket();
  let checked = false;
  const worker = createOkfV1Worker({
    name: "test",
    version: "1",
    bundle: "shared",
    visualizationKey: "views/shared.html",
    bucket: () => bucket,
    authorize: async () => ({ subject: "reader" }),
    canApply: async (_principal, change) => {
      checked = true;
      assert.equal(change?.operation, "delete");
      return false;
    },
    operations: () => neverOperations,
  });
  const response = await worker.fetch(new Request("https://example.test/v1/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "okf_v1_apply_change",
        arguments: { bundle: "shared", change: { operation: "delete", path: "a.md", expected_revision: "e" } },
      },
    }),
  }), {});
  assert.equal(checked, true);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /not authorized/);
});

test("every write in a JSON-RPC batch is authorized", async () => {
  const { bucket } = memoryBucket();
  const checked: string[] = [];
  const worker = createOkfV1Worker({
    name: "test",
    version: "1",
    bundle: "shared",
    visualizationKey: "views/shared.html",
    bucket: () => bucket,
    authorize: async () => ({ subject: "author" }),
    canApply: async (_principal, change) => {
      checked.push(change?.operation ?? "malformed");
      return change?.operation === "create";
    },
    operations: () => neverOperations,
  });
  const response = await worker.fetch(new Request("https://example.test/v1/mcp", {
    method: "POST",
    body: JSON.stringify([
      {
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "okf_v1_apply_change", arguments: { change: { operation: "create", path: "a.md", content: "# A" } } },
      },
      {
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "okf_v1_apply_change", arguments: { change: { operation: "delete", path: "b.md", expected_revision: "e" } } },
      },
    ]),
  }), {});
  assert.equal(response.status, 200);
  assert.deepEqual(checked, ["create", "delete"]);
  assert.match(await response.text(), /not authorized/);
});

test("malformed writes reach authorization as null", async () => {
  const { bucket } = memoryBucket();
  let checked: unknown = "not-called";
  const worker = createOkfV1Worker({
    name: "test",
    version: "1",
    bundle: "shared",
    visualizationKey: "views/shared.html",
    bucket: () => bucket,
    authorize: async () => ({ subject: "author" }),
    canApply: async (_principal, change) => {
      checked = change;
      return false;
    },
    operations: () => neverOperations,
  });
  const response = await worker.fetch(new Request("https://example.test/v1/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "okf_v1_apply_change",
        arguments: { change: { operation: "delete", path: "../outside.md" } },
      },
    }),
  }), {});
  assert.equal(checked, null);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /not authorized/);
});
