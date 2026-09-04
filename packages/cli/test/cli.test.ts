import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli, stableJson } from "../src/index.js";

const INDEX = `---
okf_version: "0.2"
---

# Test bundle
`;

const ALPHA = `---
type: Concept
title: Alpha orchestration
description: First concept.
---

# Alpha orchestration
`;

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "okf-cli-"));
  await mkdir(path.join(root, "concepts"));
  await writeFile(path.join(root, "index.md"), INDEX);
  await writeFile(path.join(root, "concepts", "alpha.md"), ALPHA);
  return root;
}

async function invoke(cwd: string, argv: string[], stdin = ""): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, {
    cwd,
    readStdin: async () => stdin,
    stdout: (value) => { stdout += value; },
    stderr: (value) => { stderr += value; },
  });
  return { code, stdout, stderr };
}

test("inspect emits deterministic okf.inspect.v1 JSON for Python and Rust consumers", async () => {
  const root = await fixture();
  const first = await invoke(path.dirname(root), ["inspect", path.basename(root), "--json"]);
  const second = await invoke(path.dirname(root), ["inspect", path.basename(root)]);
  assert.equal(first.code, 0);
  assert.equal(first.stderr, "");
  assert.equal(first.stdout, second.stdout);
  const result = JSON.parse(first.stdout) as { schema: string; documents: Array<{ path: string }> };
  assert.equal(result.schema, "okf.inspect.v1");
  assert.deepEqual(result.documents.map((document) => document.path), ["concepts/alpha.md", "index.md"]);
  assert.equal(first.stdout.includes(root), false);
});

test("project and exact bundle targets both retain manifest context", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "okf-cli-manifest-"));
  await mkdir(path.join(project, ".agents"));
  await mkdir(path.join(project, "docs"));
  await writeFile(path.join(project, "index.md"), INDEX);
  await writeFile(path.join(project, "docs", "index.md"), INDEX);
  await writeFile(path.join(project, "AGENTS.md"), "# Governed context\n");
  await writeFile(path.join(project, ".agents", "okf.yaml"), `schema_version: 1
instructions:
  common:
    - AGENTS.md
bundles:
  xbol:
    root: docs
`);

  for (const target of [".", "docs"]) {
    const result = await invoke(project, ["context", target]);
    assert.equal(result.code, 0, result.stderr);
    const context = JSON.parse(result.stdout);
    assert.equal(context.bundle.name, "xbol");
    assert.equal(context.documents[0].content, "# Governed context\n");
  }
});

test("list, read, links, and search use versioned JSON envelopes", async () => {
  const root = await fixture();
  const listed = await invoke(root, ["list"]);
  const read = await invoke(root, ["read", ".", "concepts/alpha.md"]);
  const links = await invoke(root, ["links"]);
  const searched = await invoke(root, ["search", "orchestration"]);
  assert.equal(JSON.parse(listed.stdout).schema, "okf.list.v1");
  assert.equal(JSON.parse(read.stdout).schema, "okf.read.v1");
  assert.equal(JSON.parse(links.stdout).schema, "okf.links.v1");
  assert.equal(JSON.parse(searched.stdout).schema, "okf.search.v1");
  assert.equal(JSON.parse(searched.stdout).matches[0].path, "concepts/alpha.md");
});

test("change preview and apply consume snake_case JSON from stdin", async () => {
  const root = await fixture();
  const request = JSON.stringify({
    operation: "create",
    path: "concepts/beta.md",
    content: ALPHA.replaceAll("Alpha", "Beta"),
  });
  const preview = await invoke(root, ["change", "preview", "--input", "-"], request);
  assert.equal(preview.code, 0);
  const previewResult = JSON.parse(preview.stdout);
  assert.equal(previewResult.schema, "okf.operations.v1");
  const applied = await invoke(root, ["change", "apply", "--preview-id", previewResult.preview_id], request);
  assert.equal(applied.code, 0);
  assert.equal(JSON.parse(applied.stdout).outcome, "applied");
  assert.match(await readFile(path.join(root, "concepts", "beta.md"), "utf8"), /Beta orchestration/);

  const replayed = await invoke(root, ["change", "apply", "--preview-id", previewResult.preview_id], request);
  assert.equal(replayed.code, 0);
  assert.equal(JSON.parse(replayed.stdout).outcome, "unchanged");
});

test("index is callable and regenerates descriptions without writing reserved files", async () => {
  const root = await fixture();
  const top = await invoke(root, ["index"]);
  assert.equal(top.code, 0, top.stderr);
  assert.equal(JSON.parse(top.stdout).schema, "okf.index.v1");
  assert.deepEqual(JSON.parse(top.stdout).entries.map((entry: { path: string }) => entry.path), ["concepts"]);
  const nested = await invoke(root, ["index", ".", "concepts"]);
  assert.equal(nested.code, 0, nested.stderr);
  assert.equal(JSON.parse(nested.stdout).entries[0].description, "First concept.");
  await writeFile(path.join(root, "concepts", "alpha.md"), ALPHA.replace("First concept.", "Revised description."));
  const revised = await invoke(root, ["index", ".", "concepts"]);
  assert.equal(JSON.parse(revised.stdout).entries[0].description, "Revised description.");
  assert.equal(await readFile(path.join(root, "index.md"), "utf8"), INDEX);
  assert.equal((await invoke(root, ["index", ".", "../outside"])).code, 2);
});

test("change apply requires the exact preview id", async () => {
  const root = await fixture();
  const request = JSON.stringify({ operation: "create", path: "concepts/beta.md", content: ALPHA });
  const missing = await invoke(root, ["change", "apply"], request);
  assert.equal(missing.code, 2);
  assert.match(JSON.parse(missing.stderr).error.message, /requires --preview-id/);

  const preview = JSON.parse((await invoke(root, ["change", "preview"], request)).stdout);
  const changed = JSON.stringify({ operation: "create", path: "concepts/gamma.md", content: ALPHA });
  const conflict = await invoke(root, ["change", "apply", "--preview-id", preview.preview_id], changed);
  assert.equal(conflict.code, 1);
  assert.equal(JSON.parse(conflict.stdout).diagnostics[0].code, "change.preview_id.conflict");
});

test("visualize writes a deterministic self-contained viewer", async () => {
  const root = await fixture();
  const output = path.join(root, ".okf", "viewer.html");
  const result = await invoke(root, ["visualize", ".", "--out", ".okf/viewer.html"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).schema, "okf.visualize.v1");
  const html = await readFile(output, "utf8");
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Alpha orchestration/);
});

test("validate uses exit status one for diagnostics and errors stay JSON", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "concepts", "broken.md"), "# Missing frontmatter\n");
  const validation = await invoke(root, ["validate"]);
  assert.equal(validation.code, 1);
  assert.equal(JSON.parse(validation.stdout).passed, false);

  const error = await invoke(root, ["no-such-command"]);
  assert.equal(error.code, 2);
  assert.equal(JSON.parse(error.stderr).schema, "okf.error.v1");
});

test("consumer profiles require an explicit module and named profiles are rejected", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "profile.mjs"), `export const profile = {
  id: "test-profile",
  validate(context) {
    return [{ code: "test.profile", path: context.documents[0].path, message: "profile ran" }];
  }
};
`);
  const profiled = await invoke(root, ["validate", ".", "--profile-module", "profile.mjs"]);
  assert.equal(profiled.code, 1);
  assert.equal(JSON.parse(profiled.stdout).diagnostics.profile[0].profile, "test-profile");

  const named = await invoke(root, ["validate", ".", "--profile", "test-profile"]);
  assert.equal(named.code, 2);
  assert.match(JSON.parse(named.stderr).error.message, /does not support named --profile values/);
});

test("strict validation makes guidance warnings fail without relabeling them", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "concepts", "alpha.md"), `${ALPHA}\n[Missing](missing.md)\n`);
  const normal = await invoke(root, ["validate"]);
  const strict = await invoke(root, ["validate", "--strict"]);
  assert.equal(normal.code, 0);
  assert.equal(strict.code, 1);
  const result = JSON.parse(strict.stdout);
  assert.equal(result.strict, true);
  assert.equal(result.diagnostics.guidance[0].family, "guidance");
});

test("stableJson recursively sorts mapping keys", () => {
  assert.equal(stableJson({ z: 1, a: { y: 2, b: 3 } }), '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n');
  assert.equal(stableJson({ "ä": 1, z: 2 }), '{\n  "z": 2,\n  "ä": 1\n}\n');
});

test("stableJson preserves unknown prototype-shaped keys as own properties", () => {
  const input = JSON.parse('{"z":1,"__proto__":{"safe":true},"constructor":"authored"}') as Record<string, unknown>;
  const result = JSON.parse(stableJson(input)) as Record<string, unknown>;
  assert.equal(Object.hasOwn(result, "__proto__"), true);
  assert.deepEqual(result["__proto__"], { safe: true });
  assert.equal(Object.hasOwn(result, "constructor"), true);
  assert.equal(result["constructor"], "authored");
  assert.equal(({} as Record<string, unknown>)["safe"], undefined);
});

const EXPIRING = `---
type: Concept
title: Expiring vendor fact
description: A fact with a shelf life.
stale_after: "2026-01-01"
---

# Expiring vendor fact
`;

test("--today evaluates stale_after; omitting it keeps the build reproducible", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "concepts", "expiring.md"), EXPIRING);
  const parent = path.dirname(root);
  const name = path.basename(root);

  const undated = await invoke(parent, ["inspect", name, "--json"]);
  const undatedNode = (JSON.parse(undated.stdout) as {
    documents: Array<{ path: string; derived: { stale: boolean | null; staleAfter: string | null } }>;
  }).documents.find((entry) => entry.path === "concepts/expiring.md");
  assert.equal(undatedNode?.derived.staleAfter, "2026-01-01");
  // Without a date there is no verdict to give.
  assert.equal(undatedNode?.derived.stale, null);

  const dated = await invoke(parent, ["inspect", name, "--json", "--today", "2026-08-31"]);
  const datedNode = (JSON.parse(dated.stdout) as {
    documents: Array<{ path: string; derived: { stale: boolean | null } }>;
  }).documents.find((entry) => entry.path === "concepts/expiring.md");
  assert.equal(datedNode?.derived.stale, true);
});

test("visualize is byte-identical across runs when no date is given", async () => {
  const root = await fixture();
  const parent = path.dirname(root);
  const name = path.basename(root);
  const first = path.join(root, "one.html");
  const second = path.join(root, "two.html");

  await invoke(parent, ["visualize", name, "--out", first]);
  await invoke(parent, ["visualize", name, "--out", second]);
  assert.equal(await readFile(first, "utf8"), await readFile(second, "utf8"));
});

test("a malformed --today stops the command instead of being ignored", async () => {
  const root = await fixture();
  const result = await invoke(path.dirname(root), [
    "inspect", path.basename(root), "--json", "--today", "2026-8-31",
  ]);
  assert.notEqual(result.code, 0);
  assert.match(result.stdout + result.stderr, /--today must be a YYYY-MM-DD date/);
});
