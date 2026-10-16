import assert from "node:assert/strict";
import test from "node:test";

import { ConfigurationError, healthResponse, logError, requiredEnv, withMcpAccept } from "../src/service.js";

test("a required setting is trimmed and refuses empty values", () => {
  assert.equal(requiredEnv({ NAME: "  value " }, "NAME"), "value");
  assert.throws(() => requiredEnv({ NAME: "   " }, "NAME"), ConfigurationError);
  assert.throws(() => requiredEnv({}, "NAME"), /NAME is required/);
});

test("health answers GET with the service and version, and 405 otherwise", async () => {
  const ok = healthResponse(new Request("https://x.test/healthz"), { service: "svc", version: "1.2.3" });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: "ok", service: "svc", version: "1.2.3" });
  const post = healthResponse(new Request("https://x.test/healthz", { method: "POST" }), { service: "svc", version: "1" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET");
});

test("an MCP request's Accept is widened only when it lacks a required type", async () => {
  const complete = new Request("https://x.test/mcp", { headers: { accept: "application/json, text/event-stream" } });
  assert.equal(withMcpAccept(complete), complete);

  const partial = withMcpAccept(new Request("https://x.test/mcp", { method: "POST", headers: { accept: "application/json" }, body: "{}" }));
  assert.equal(partial.headers.get("accept"), "application/json, text/event-stream");
  assert.equal(await partial.text(), "{}");

  const rebuilt = withMcpAccept(new Request("https://x.test/mcp", { method: "POST", headers: { accept: "text/event-stream" } }), "[]");
  assert.equal(rebuilt.headers.get("accept"), "application/json, text/event-stream");
  assert.equal(await rebuilt.text(), "[]");
});

test("an error log names the event and class, never the message", () => {
  const original = console.error;
  const lines: string[] = [];
  console.error = (line: string) => { lines.push(line); };
  try {
    logError("request_failed", new TypeError("secret request content"));
  } finally {
    console.error = original;
  }
  assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ severity: "ERROR", event: "request_failed", error: "TypeError" }]);
  assert.ok(!lines[0]!.includes("secret"));
});
