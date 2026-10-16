import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_HTTP_PORT, parseServerArguments } from "../../src/mcp/arguments.js";

test("the project root comes from argv, never from the process cwd", () => {
  const parsed = parseServerArguments(["/srv/knowledge", "--bundle", "private"]);

  assert.equal(parsed.projectRoot, "/srv/knowledge");
  assert.equal(parsed.bundle, "private");
  assert.equal(parsed.http, false);
  assert.equal(parsed.port, DEFAULT_HTTP_PORT);
});

test("a bundle name is always required", () => {
  assert.throws(() => parseServerArguments(["/srv/knowledge"]), /requires --bundle NAME/);
  assert.throws(() => parseServerArguments([]), /requires a project root and --bundle NAME/);
  assert.throws(() => parseServerArguments(["--bundle", "private"]), /requires a project root/);
  assert.throws(() => parseServerArguments(["/a", "/b", "--bundle", "x"]), /exactly one project root/);
});

test("value options refuse a missing value the way the CLI does", () => {
  assert.throws(() => parseServerArguments(["/srv", "--bundle"]), /--bundle requires a value/);
  assert.throws(
    () => parseServerArguments(["/srv", "--bundle", "--today", "2026-09-01"]),
    /--bundle requires a value/,
  );
});

test("a mistyped date stops the server instead of leaving every page unjudged", () => {
  assert.throws(
    () => parseServerArguments(["/srv", "--bundle", "x", "--today", "01-09-2026"]),
    /--today must be a YYYY-MM-DD date/,
  );
  assert.equal(
    parseServerArguments(["/srv", "--bundle", "x", "--today", "2026-09-01"]).today,
    "2026-09-01",
  );
});

test("named profiles are refused; only a trusted module is accepted", () => {
  assert.throws(
    () => parseServerArguments(["/srv", "--bundle", "x", "--profile", "iteramind"]),
    /does not support named --profile values/,
  );
  assert.equal(
    parseServerArguments(["/srv", "--bundle", "x", "--profile-module", "./p.mjs"]).profileModule,
    "./p.mjs",
  );
});

test("a port belongs to the HTTP transport only", () => {
  assert.throws(
    () => parseServerArguments(["/srv", "--bundle", "x", "--port", "8080"]),
    /--port applies to --http only/,
  );
  const parsed = parseServerArguments(["/srv", "--bundle", "x", "--http", "--port", "8080"]);
  assert.equal(parsed.http, true);
  assert.equal(parsed.port, 8080);
  assert.throws(
    () => parseServerArguments(["/srv", "--bundle", "x", "--http", "--port", "70000"]),
    /--port must be a TCP port/,
  );
});

test("an unknown option is rejected rather than read as a project root", () => {
  assert.throws(() => parseServerArguments(["/srv", "--bundle", "x", "--json"]), /unknown option: --json/);
});

test("help is available without a project root", () => {
  assert.equal(parseServerArguments(["--help"]).help, true);
  assert.equal(parseServerArguments(["/srv", "--bundle", "x", "-h"]).help, true);
});

test("identity flags describe the deployment", () => {
  const parsed = parseServerArguments([
    "/srv/knowledge", "--bundle", "xbol", "--http",
    "--name", "xbol-knowledge",
    "--title", "XBOL Knowledge",
    "--description", "Evidence-backed platform knowledge.",
    "--website", "https://example.test/xbol",
    "--icon", "https://example.test/icon.svg",
    "--purpose", "Knowledge for the XBOL platforms.",
    "--allowed-host", "XBOL-mcp.example.test",
    "--allowed-host", "other-mcp.example.test",
  ]);

  assert.equal(parsed.name, "xbol-knowledge");
  assert.equal(parsed.title, "XBOL Knowledge");
  assert.equal(parsed.description, "Evidence-backed platform knowledge.");
  assert.equal(parsed.website, "https://example.test/xbol");
  assert.equal(parsed.icon, "https://example.test/icon.svg");
  assert.equal(parsed.purpose, "Knowledge for the XBOL platforms.");
  assert.deepEqual(parsed.allowedHosts, ["xbol-mcp.example.test", "other-mcp.example.test"]);
});

test("a forwarded host is a bare hostname and only means something over HTTP", () => {
  assert.throws(
    () => parseServerArguments(["/srv", "--bundle", "x", "--allowed-host", "a.example.test"]),
    /--allowed-host applies to --http only/,
  );
  assert.throws(
    () => parseServerArguments(["/srv", "--bundle", "x", "--http", "--allowed-host", "https://a.example.test/"]),
    /bare hostname/,
  );
  assert.throws(
    () => parseServerArguments(["/srv", "--bundle", "x", "--http", "--allowed-host", "*.example.test"]),
    /bare hostname/,
  );
  assert.throws(() => parseServerArguments(["/srv", "--bundle", "x", "--website", "not a url"]), /absolute URL/);
});
