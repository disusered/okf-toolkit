import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INSPECT_SCHEMA,
  OKF_VERSION,
  OPERATIONS_SCHEMA,
  type ApplyChangeRequest,
} from "../src/index.js";

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as Record<string, unknown>;
}

test("versioned identifiers are stable", () => {
  assert.equal(OKF_VERSION, "0.2");
  assert.equal(INSPECT_SCHEMA, "okf.inspect.v1");
  assert.equal(OPERATIONS_SCHEMA, "okf.operations.v1");
});

test("published schemas and fixtures carry their expected identifiers", async () => {
  const inspect = await json("../../schemas/okf.inspect.v1.schema.json");
  const operations = await json("../../schemas/okf.operations.v1.schema.json");
  const fixture = await json("../../fixtures/conformance/valid-v0.2.json");

  assert.equal(inspect["$id"], "https://okf.md/schemas/okf.inspect.v1.schema.json");
  assert.equal(operations["$id"], "https://okf.md/schemas/okf.operations.v1.schema.json");
  assert.equal(fixture["today"], "2026-08-20");
});

test("vendored specification is pinned to OKF v0.2 with provenance", async () => {
  const spec = await readFile(new URL("../../spec/SPEC.md", import.meta.url), "utf8");
  const notice = await readFile(new URL("../../NOTICE", import.meta.url), "utf8");

  assert.match(spec, /^<!--[\s\S]*Commit:  3fcbb9f828c2f23d109c855ee403c3a4c81f3a96/);
  assert.match(spec, /\*\*Version 0\.2\*\*/);
  assert.match(notice, /Copyright 2026 Google LLC/);
});

test("apply requests bind one parsed change to its reviewed preview", async () => {
  const operations = await json("../../schemas/okf.operations.v1.schema.json");
  const fixture = await json("../../fixtures/operations/apply-request.json");
  const definitions = operations["$defs"] as Record<string, Record<string, unknown>>;
  const applyRequest = definitions["applyRequest"]!;
  const example = (fixture["valid"] as ApplyChangeRequest[])[0]!;

  assert.deepEqual(applyRequest["required"], ["change", "preview_id"]);
  assert.equal(applyRequest["additionalProperties"], false);
  assert.equal(example.change.operation, "create");
  assert.equal(
    example.preview_id,
    "sha256:f2a2084c80a19e29cc0e82a162a52363da615fd350afae5cb437587d2b57e66b",
  );
  assert.equal((fixture["digest_vectors"] as unknown[]).length, 4);
});
