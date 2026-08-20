import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { ChangePreview, ChangeResult } from "okf-contracts";

import { createOkfV1McpServer, type OkfV1Operations } from "../src/mcp.js";

function operations(calls: string[]): OkfV1Operations {
  return {
    async context() { calls.push("context"); return { bundle: "shared" }; },
    async list(input) { calls.push(`list:${input.path}:${input.depth}`); return { entries: [] }; },
    async search(input) { calls.push(`search:${input.query}:${input.limit}`); return { matches: [] }; },
    async read(input) { calls.push(`read:${input.path}`); return { path: input.path, content: "# A" }; },
    async links(input) { calls.push(`links:${input.path}`); return { path: input.path, outgoing: [] }; },
    async validate() { calls.push("validate"); return { passed: true }; },
    async inspect() { calls.push("inspect"); return { schema: "okf.inspect.v1" }; },
    async visualize() { calls.push("visualize"); return { url: "https://example.test/v1/viz" }; },
    async previewChange(change): Promise<ChangePreview> {
      calls.push(`preview:${change.operation}`);
      return {
        schema: "okf.operations.v1",
        passed: true,
        preview_id: "preview-1",
        operation: change.operation,
        affected_paths: ["a.md"],
        diff: "",
        diagnostics: [],
      };
    },
    async applyChange(request): Promise<ChangeResult> {
      calls.push(`apply:${request.change.operation}:${request.preview_id}`);
      return {
        schema: "okf.operations.v1",
        outcome: "applied",
        operation: request.change.operation,
        revisions: { "a.md": "etag-2" },
        diagnostics: [],
      };
    },
  };
}

async function connected() {
  const calls: string[] = [];
  const server = createOkfV1McpServer({
    name: "test-okf",
    version: "1.0.0-rc.0",
    bundle: "shared",
    operations: operations(calls),
  });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, calls };
}

test("the MCP surface is explicitly versioned", async () => {
  const { client } = await connected();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "okf_v1_apply_change",
    "okf_v1_context",
    "okf_v1_inspect",
    "okf_v1_links",
    "okf_v1_list",
    "okf_v1_preview_change",
    "okf_v1_read",
    "okf_v1_search",
    "okf_v1_validate",
    "okf_v1_visualize",
  ]);
});

test("each operation refuses any bundle except the deployment bundle", async () => {
  const { client, calls } = await connected();
  const result = await client.callTool({
    name: "okf_v1_read",
    arguments: { bundle: "private", path: "index.md" },
  });
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.match(String((result as { content: { text: string }[] }).content[0]?.text), /unknown bundle/);
  assert.deepEqual(calls, []);
});

test("change operations preserve the discriminated change contract", async () => {
  const { client, calls } = await connected();
  await client.callTool({
    name: "okf_v1_preview_change",
    arguments: { bundle: "shared", change: { operation: "delete", path: "a.md", expected_revision: "etag-1" } },
  });
  await client.callTool({
    name: "okf_v1_apply_change",
    arguments: {
      bundle: "shared",
      change: { operation: "create", path: "a.md", content: "# A" },
      preview_id: `sha256:${"a".repeat(64)}`,
    },
  });
  assert.deepEqual(calls, ["preview:delete", `apply:create:sha256:${"a".repeat(64)}`]);
});

test("apply requires the reviewed preview id on the wire", async () => {
  const { client, calls } = await connected();
  const result = await client.callTool({
    name: "okf_v1_apply_change",
    arguments: { bundle: "shared", change: { operation: "create", path: "a.md", content: "# A" } },
  });
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.deepEqual(calls, []);
});
