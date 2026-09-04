import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { Diagnostic } from "okf-contracts";
import { changePreviewId } from "okf-node";

import { createOkfLocalServer, SERVER_VERSION } from "../src/server.js";
import { callJson, callTool, connect, fixture, fixtureCopy } from "./support.js";

const PROJECT = { projectRoot: fixture("project"), bundle: "fixture" } as const;

const GAMMA = `---
type: Concept
title: Gamma reconciliation
description: A concept written through okf_v1_apply_change.
---

# Gamma reconciliation
`;

test("the reported version matches the package manifest", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string };

  assert.equal(SERVER_VERSION, manifest.version);
});

test("the versioned tools answer from the filesystem bundle", async () => {
  const { client, bundle } = await connect(PROJECT);

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "okf_v1_apply_change",
    "okf_v1_context",
    "okf_v1_index",
    "okf_v1_inspect",
    "okf_v1_links",
    "okf_v1_list",
    "okf_v1_preview_change",
    "okf_v1_read",
    "okf_v1_search",
    "okf_v1_validate",
    "okf_v1_visualize",
  ]);

  const context = await callJson<{
    adapter: string;
    bundle: string;
    audience: string;
    access: string;
    instructions: { path: string }[];
    index: { path: string; revision: string } | null;
  }>(client, "okf_v1_context", { bundle });
  assert.equal(context.adapter, "fixture");
  assert.equal(context.bundle, "fixture");
  assert.equal(context.access, "read-write");
  assert.equal(context.audience, "Fixture bundle for okf-mcp tests");
  assert.deepEqual(context.instructions.map((document) => document.path), ["INSTRUCTIONS.md", "CONTEXT.md"]);
  assert.equal(context.index?.path, "index.md");
  assert.match(context.index?.revision ?? "", /^sha256:[0-9a-f]{64}$/);

  const navigation = await callJson<{ entries: { path: string; description: string | null }[] }>(
    client, "okf_v1_index", { bundle, path: "concepts" });
  assert.deepEqual(navigation.entries.map((entry) => entry.path), ["concepts/alpha.md", "concepts/nested"]);
  assert.ok(navigation.entries[0]?.description);

  const listed = await callJson<{ entries: { path: string; type: string }[] }>(
    client,
    "okf_v1_list",
    { bundle, path: ".", depth: 2 },
  );
  assert.deepEqual(listed.entries, [
    { path: "concepts", type: "directory" },
    { path: "concepts/alpha.md", type: "markdown" },
    { path: "concepts/nested", type: "directory" },
    { path: "concepts/nested/beta.md", type: "markdown" },
    { path: "index.md", type: "markdown" },
  ]);

  const shallow = await callJson<{ entries: { path: string }[] }>(
    client,
    "okf_v1_list",
    { bundle, path: ".", depth: 1 },
  );
  assert.deepEqual(shallow.entries.map((entry) => entry.path), [
    "concepts",
    "concepts/alpha.md",
    "index.md",
  ]);

  const nested = await callJson<{ entries: { path: string }[] }>(
    client,
    "okf_v1_list",
    { bundle, path: "concepts", depth: 2 },
  );
  assert.deepEqual(nested.entries.map((entry) => entry.path), [
    "concepts/alpha.md",
    "concepts/nested",
    "concepts/nested/beta.md",
  ]);

  const found = await callJson<{ query: string; matches: { path: string }[] }>(
    client,
    "okf_v1_search",
    { bundle, query: "settlement", limit: 5 },
  );
  assert.equal(found.query, "settlement");
  // The page itself first, then the page whose link text names it.
  assert.deepEqual([...new Set(found.matches.map((match) => match.path))], [
    "concepts/nested/beta.md",
    "concepts/alpha.md",
  ]);

  const document = await callJson<{ path: string; content: string; revision: string }>(
    client,
    "okf_v1_read",
    { bundle, path: "concepts/alpha.md" },
  );
  assert.equal(document.path, "concepts/alpha.md");
  assert.match(document.content, /# Alpha orchestration/);
  assert.match(document.revision, /^sha256:[0-9a-f]{64}$/);

  const links = await callJson<{
    outgoing: { href: string; resolvedPath: string | null }[];
    backlinks: { path: string; href: string }[];
  }>(client, "okf_v1_links", { bundle, path: "concepts/nested/beta.md" });
  assert.deepEqual(links.outgoing, []);
  assert.deepEqual(links.backlinks, [{ path: "concepts/alpha.md", href: "nested/beta.md" }]);

  const validated = await callJson<{
    passed: boolean;
    summary: { documents: number; errors: number };
  }>(client, "okf_v1_validate", { bundle });
  assert.equal(validated.passed, true);
  assert.equal(validated.summary.documents, 3);
  assert.equal(validated.summary.errors, 0);

  const inspected = await callJson<{ schema: string; documents: { path: string }[] }>(
    client,
    "okf_v1_inspect",
    { bundle },
  );
  assert.equal(inspected.schema, "okf.inspect.v1");
  assert.deepEqual(inspected.documents.map((entry) => entry.path), [
    "concepts/alpha.md",
    "concepts/nested/beta.md",
    "index.md",
  ]);

  const visualized = await callJson<{ url: string; path: string }>(
    client,
    "okf_v1_visualize",
    { bundle },
  );
  assert.equal(visualized.url, new URL(`file://${visualized.path}`).href);
  assert.match(await readFile(visualized.path, "utf8"), /<!doctype html>/i);
});

test("every operation refuses a bundle the deployment does not serve", async () => {
  const { client } = await connect(PROJECT);

  const outcome = await callTool(client, "okf_v1_read", { bundle: "private", path: "index.md" });

  assert.equal(outcome.isError, true);
  assert.match(outcome.text, /unknown bundle/);
});

test("a bundle the manifest does not declare fails at startup, not on the first call", async () => {
  await assert.rejects(
    createOkfLocalServer({ projectRoot: fixture("project"), bundle: "private" }),
    /unknown OKF bundle private; available bundles: fixture/,
  );
});

test("a profile module is loaded, resolved against the project root, and applied", async () => {
  const { client, bundle } = await connect({
    ...PROJECT,
    profileModule: "profile.mjs",
    today: "2026-09-01",
  });

  const validated = await callJson<{
    passed: boolean;
    diagnostics: { profile: Diagnostic[] };
    summary: { warnings: number };
  }>(client, "okf_v1_validate", { bundle });

  assert.deepEqual(validated.diagnostics.profile, [{
    code: "fixture.profile.loaded",
    family: "profile",
    severity: "warning",
    path: "index.md",
    message: "fixture profile ran over 3 documents for today=2026-09-01",
    profile: "okf-mcp-fixture-profile",
  }]);
  assert.equal(validated.summary.warnings, 1);
  assert.equal(validated.passed, true);
});

test("without --profile-module nothing profile-shaped appears", async () => {
  const { client, bundle } = await connect(PROJECT);

  const validated = await callJson<{ diagnostics: { profile: Diagnostic[] } }>(
    client,
    "okf_v1_validate",
    { bundle },
  );

  assert.deepEqual(validated.diagnostics.profile, []);
});

test("a profile module that does not exist stops the server at startup", async () => {
  await assert.rejects(
    createOkfLocalServer({ ...PROJECT, profileModule: "missing-profile.mjs" }),
    { code: "ERR_MODULE_NOT_FOUND" },
  );
});

test("a bundle declaring access: read refuses both writing operations", async () => {
  const { client, bundle } = await connect({ projectRoot: fixture("readonly"), bundle: "sealed" });
  const change = { operation: "create", path: "concepts/new.md", content: "# New\n" };

  const preview = await callTool(client, "okf_v1_preview_change", { bundle, change });
  const applied = await callTool(client, "okf_v1_apply_change", {
    bundle,
    change,
    preview_id: `sha256:${"a".repeat(64)}`,
  });

  assert.equal(preview.isError, true);
  assert.match(preview.text, /bundle sealed declares access: read; okf_v1_preview_change is not available/);
  assert.equal(applied.isError, true);
  assert.match(applied.text, /bundle sealed declares access: read; okf_v1_apply_change is not available/);

  const read = await callTool(client, "okf_v1_read", { bundle, path: "index.md" });
  assert.equal(read.isError, false);
});

test("a reviewed change previews and applies against the real bundle", async () => {
  const project = await fixtureCopy("project");
  const { client, bundle } = await connect({ projectRoot: project, bundle: "fixture" });
  const change = { operation: "create" as const, path: "concepts/gamma.md", content: GAMMA };

  const preview = await callJson<{ passed: boolean; preview_id: string; diff: string }>(
    client,
    "okf_v1_preview_change",
    { bundle, change },
  );
  assert.equal(preview.passed, true);
  assert.equal(preview.preview_id, changePreviewId(change));
  assert.match(preview.diff, /\+# Gamma reconciliation/);

  const result = await callJson<{ outcome: string; revisions: Record<string, string> }>(
    client,
    "okf_v1_apply_change",
    { bundle, change, preview_id: preview.preview_id },
  );
  assert.equal(result.outcome, "applied");
  const navigation = await callJson<{ entries: { path: string }[] }>(client, "okf_v1_index", { bundle, path: "concepts" });
  assert.ok(navigation.entries.some((entry) => entry.path === "concepts/gamma.md"));
  assert.equal(
    await readFile(path.join(project, "knowledge", "concepts", "gamma.md"), "utf8"),
    GAMMA,
  );

  const repeated = await callJson<{ outcome: string }>(
    client,
    "okf_v1_apply_change",
    { bundle, change, preview_id: preview.preview_id },
  );
  assert.equal(repeated.outcome, "unchanged");
});

test("apply refuses a preview id that does not match the change", async () => {
  const project = await fixtureCopy("project");
  const { client, bundle } = await connect({ projectRoot: project, bundle: "fixture" });

  const result = await callJson<{ outcome: string; diagnostics: Diagnostic[] }>(
    client,
    "okf_v1_apply_change",
    {
      bundle,
      change: { operation: "create", path: "concepts/gamma.md", content: GAMMA },
      preview_id: `sha256:${"0".repeat(64)}`,
    },
  );

  assert.equal(result.outcome, "rejected");
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [
    "change.preview_id.conflict",
  ]);
});
