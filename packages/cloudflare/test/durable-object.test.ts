import assert from "node:assert/strict";
import test from "node:test";

import type { ApplyChangeRequest, ChangeResult } from "okf-contracts";

import {
  OKF_V1_DURABLE_APPLY_PATH,
  createApplyChangeDurableObject,
  createDurableObjectApplyClient,
  durableObjectNameForBundle,
  durableObjectStubForBundle,
  withDurableObjectApply,
} from "../src/durable-object.js";
import type { OkfV1Operations } from "okf-mcp";

function applyRequest(path: string, digit: string): ApplyChangeRequest {
  return {
    change: { operation: "create", path, content: `# ${path}\n` },
    preview_id: `sha256:${digit.repeat(64)}`,
  };
}

function applied(request: ApplyChangeRequest): ChangeResult {
  const change = request.change;
  const path = change.operation === "move" ? change.to_path : change.path;
  return {
    schema: "okf.operations.v1",
    outcome: "applied",
    operation: change.operation,
    revisions: { [path]: "revision-1" },
    diagnostics: [],
  };
}

function internalRequest(request: ApplyChangeRequest): Request {
  return new Request(`https://okf.internal${OKF_V1_DURABLE_APPLY_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
}

test("bundle names select one stable Durable Object stub", () => {
  const names: string[] = [];
  const stub = { fetch: async () => new Response() };
  const namespace = {
    idFromName(name: string) {
      names.push(name);
      return `id:${name}`;
    },
    get(id: string) {
      assert.equal(id, "id:okf-v1:shared");
      return stub;
    },
  };

  assert.equal(durableObjectNameForBundle("shared"), "okf-v1:shared");
  assert.equal(durableObjectStubForBundle(namespace, "shared"), stub);
  assert.deepEqual(names, ["okf-v1:shared"]);
  assert.throws(() => durableObjectNameForBundle("Shared"), /stable lowercase identifier/);
});

test("the Durable Object class serializes concurrent applies for its bundle", async () => {
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let reportStarted!: () => void;
  const started = new Promise<void>((resolve) => { reportStarted = resolve; });
  const order: string[] = [];
  let active = 0;
  let maximumActive = 0;

  const DurableApply = createApplyChangeDurableObject<{ marker: string }>({
    async apply(request, env) {
      assert.equal(env.marker, "environment");
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const path = request.change.operation === "move"
        ? request.change.from_path
        : request.change.path;
      order.push(`start:${path}`);
      if (path === "concepts/first.md") {
        reportStarted();
        await firstGate;
      }
      order.push(`end:${path}`);
      active -= 1;
      return applied(request);
    },
  });
  const durable = new DurableApply({}, { marker: "environment" });
  const firstRequest = applyRequest("concepts/first.md", "1");
  const secondRequest = applyRequest("concepts/second.md", "2");

  const first = durable.fetch(internalRequest(firstRequest));
  await started;
  const second = durable.fetch(internalRequest(secondRequest));
  await Promise.resolve();
  assert.deepEqual(order, ["start:concepts/first.md"]);

  releaseFirst();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, [
    "start:concepts/first.md",
    "end:concepts/first.md",
    "start:concepts/second.md",
    "end:concepts/second.md",
  ]);
});

test("the Durable Object rejects malformed or incorrectly routed requests", async () => {
  let called = false;
  const DurableApply = createApplyChangeDurableObject<unknown>({
    async apply(request) {
      called = true;
      return applied(request);
    },
  });
  const durable = new DurableApply({}, undefined);

  assert.equal((await durable.fetch(new Request("https://okf.internal/elsewhere"))).status, 404);
  const get = await durable.fetch(new Request(`https://okf.internal${OKF_V1_DURABLE_APPLY_PATH}`));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  const malformed = await durable.fetch(new Request(
    `https://okf.internal${OKF_V1_DURABLE_APPLY_PATH}`,
    { method: "POST", body: JSON.stringify({ change: {}, preview_id: "wrong" }) },
  ));
  assert.equal(malformed.status, 400);
  assert.equal(called, false);
});

test("the apply client forwards the reviewed request and validates the result schema", async () => {
  const expected = applyRequest("concepts/example.md", "a");
  let received: { url: string; method: string; body: unknown } | undefined;
  const client = createDurableObjectApplyClient({
    async fetch(request) {
      received = {
        url: request.url,
        method: request.method,
        body: await request.json(),
      };
      return Response.json(applied(expected));
    },
  });

  assert.deepEqual(await client(expected), applied(expected));
  assert.deepEqual(received, {
    url: `https://okf.internal${OKF_V1_DURABLE_APPLY_PATH}`,
    method: "POST",
    body: expected,
  });

  const incompatible = createDurableObjectApplyClient({
    async fetch() {
      return Response.json({ ...applied(expected), schema: "okf.operations.v2" });
    },
  });
  await assert.rejects(() => incompatible(expected), /incompatible operations schema/);

  const malformed = createDurableObjectApplyClient({
    async fetch() {
      return Response.json({ ...applied(expected), diagnostics: "not-an-array" });
    },
  });
  await assert.rejects(() => malformed(expected), /invalid change result/);
});

test("Durable Object composition replaces only applyChange", async () => {
  const localApply: OkfV1Operations["applyChange"] = async (request) => applied(request);
  const context = async () => ({ schema: "context" });
  const operations = {
    context,
    applyChange: localApply,
  } as unknown as OkfV1Operations;
  const request = applyRequest("concepts/example.md", "b");
  let durableCalls = 0;

  const composed = withDurableObjectApply(operations, {
    async fetch() {
      durableCalls += 1;
      return Response.json(applied(request));
    },
  });

  assert.equal(composed.context, context);
  assert.notEqual(composed.applyChange, localApply);
  assert.deepEqual(await composed.applyChange(request), applied(request));
  assert.equal(durableCalls, 1);
});
