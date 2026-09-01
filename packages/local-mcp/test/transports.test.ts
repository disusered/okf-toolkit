import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { serveHttp } from "../src/http.js";
import { createOkfLocalServer } from "../src/server.js";
import { fixture } from "./support.js";

const BIN = fileURLToPath(new URL("../src/bin.js", import.meta.url));

function collect(stream: NodeJS.ReadableStream): { read: () => string } {
  let text = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => { text += chunk; });
  return { read: () => text };
}

test("a real client drives the installed binary over stdio", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, fixture("project"), "--bundle", "fixture", "--today", "2026-09-01"],
    // Spawned from somewhere unrelated to the bundle: the root must come from argv.
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stderr: "pipe",
  });
  const notes = collect(transport.stderr as unknown as NodeJS.ReadableStream);
  const client = new Client({ name: "okf-mcp-stdio-test", version: "1" });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const result = await client.callTool({
      name: "okf_v1_read",
      arguments: { bundle: "fixture", path: "index.md" },
    }) as { content: { text?: string }[] };

    assert.equal(tools.length, 10);
    assert.match(String(result.content[0]?.text), /# Fixture bundle/);
    assert.match(notes.read(), /okf-mcp: serving bundle fixture \(read-write\) from .*knowledge over stdio/);
  } finally {
    await client.close();
  }
});

test("standard output carries protocol traffic only", async () => {
  const child = spawn(
    process.execPath,
    [BIN, fixture("project"), "--bundle", "fixture"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const stdout = collect(child.stdout);
  const stderr = collect(child.stderr);

  const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "raw", version: "1" },
    },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

  const identifiers = await new Promise<number[]>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error("no response before the deadline")); }, 15_000);
    const seen: number[] = [];
    child.stdout.on("data", () => {
      for (const line of stdout.read().split("\n")) {
        if (line.trim() === "") continue;
        const message = JSON.parse(line) as { jsonrpc: string; id?: number };
        // Every single line has to be a JSON-RPC frame; a stray log line fails the parse.
        assert.equal(message.jsonrpc, "2.0");
        if (typeof message.id === "number" && !seen.includes(message.id)) seen.push(message.id);
      }
      if (seen.includes(2)) {
        clearTimeout(timer);
        resolve(seen);
      }
    });
    child.once("error", reject);
  });

  child.kill("SIGTERM");
  assert.deepEqual(identifiers, [1, 2]);
  assert.match(stderr.read(), /okf-mcp: serving bundle fixture/);
});

test("loopback HTTP serves the versioned path and refuses a foreign origin", async () => {
  const local = await createOkfLocalServer({ projectRoot: fixture("project"), bundle: "fixture" });
  // Port 0 so parallel runs never collide on a fixed port.
  const handle = await serveHttp(() => local.createServer(), { port: 0 });

  try {
    assert.match(handle.url, /^http:\/\/127\.0\.0\.1:\d+\/v1\/mcp$/);

    const client = new Client({ name: "okf-mcp-http-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));
    const { tools } = await client.listTools();
    assert.equal(tools.length, 10);
    await client.close();

    const foreign = await fetch(handle.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        origin: "http://rebinding.test",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(foreign.status, 403);

    const elsewhere = await fetch(`http://127.0.0.1:${String(handle.port)}/mcp`, { method: "POST" });
    assert.equal(elsewhere.status, 404);
  } finally {
    await handle.close();
  }
});
