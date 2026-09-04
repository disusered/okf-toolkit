import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { Diagnostic, RawBundleDocument } from "okf-contracts";

import type { ProfileDiagnostic } from "../src/index.js";
import { analyzeBundle, documentExtensions, parseBundleDocument } from "../src/index.js";

interface Fixture {
  readonly today?: string;
  readonly documents: readonly RawBundleDocument[];
  readonly profile?: unknown;
  readonly expected: Record<string, unknown>;
}

async function fixture(name: string): Promise<Fixture> {
  const url = new URL(`../../../contracts/fixtures/conformance/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as Fixture;
}

function codes(analysis: ReturnType<typeof analyzeBundle>, family: "core" | "guidance") {
  return [...new Set(analysis.diagnostics[family].map((entry) => entry.code))].sort();
}

function pathCodes(entries: readonly Diagnostic[]) {
  return entries
    .map(({ path, code }) => ({ path, code }))
    .sort((left, right) => {
      const leftKey = `${left.path}\0${left.code}`;
      const rightKey = `${right.path}\0${right.code}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

test("analyzes the shared valid v0.2 fixture without losing extensions", async () => {
  const input = await fixture("valid-v0.2.json");
  const analysis = analyzeBundle(input.documents, { today: input.today });

  assert.equal(analysis.schema, "okf.inspect.v1");
  assert.equal(analysis.okfVersion, "0.2");
  assert.deepEqual(analysis.summary, {
    documents: 6,
    concepts: 3,
    indexes: 2,
    logs: 1,
    errors: 0,
    warnings: 1,
  });
  assert.deepEqual(codes(analysis, "core"), []);
  assert.deepEqual(codes(analysis, "guidance"), ["guidance.link.broken"]);
  /*
   * Five nodes, not three: the two indexes are in the graph. Their links are authored — a
   * person wrote each entry, grouped it under a heading and described it — so leaving them out
   * dropped the spine of the bundle and drew the rest as unrelated islands.
   */
  assert.equal(analysis.graph.nodes.length, 5);
  assert.deepEqual(
    analysis.graph.nodes.filter((node) => node.type === "Index").map((node) => node.path),
    ["guides/index.md", "index.md"],
  );
  assert.equal(analysis.graph.edges.length, 5);
  // Both the root index and the nested one reach the page they list.
  for (const source of ["index.md", "guides/index.md"]) {
    assert.ok(
      analysis.graph.edges.some(
        (edge) => edge.source === source && edge.target === "guides/release.md",
      ),
      `${source} should link to the page it lists`,
    );
  }
  // A log is a dated history of what happened, not a statement of what relates to what.
  assert.equal(analysis.graph.nodes.some((node) => node.path.endsWith("log.md")), false);

  const release = analysis.documents.find((document) => document.path === "guides/release.md");
  assert.ok(release);
  assert.equal(release.revision, "fixture-revision-1");
  assert.deepEqual(release.metadata["x-consumer"], { preserve: true, priority: 7 });
  assert.match(release.frontmatter?.raw ?? "", /^---\ntype: Playbook/);
  assert.equal(release.derived.trustTier, "human-reviewed");
  assert.equal(release.derived.stale, false);
  assert.equal(release.links[0]?.href, "../references/policy.md");
  assert.equal(release.links[0]?.resolvedPath, "references/policy.md");
  assert.equal(release.links[0]?.range?.start.line, 21);
});

test("analysis bytes do not depend on input enumeration order", async () => {
  const input = await fixture("valid-v0.2.json");
  const forward = analyzeBundle(input.documents, { today: input.today });
  const reverse = analyzeBundle([...input.documents].reverse(), { today: input.today });
  assert.equal(JSON.stringify(forward), JSON.stringify(reverse));
});

test("reports exactly the fixture's core conformance families", async () => {
  const input = await fixture("invalid-core.json");
  const analysis = analyzeBundle(input.documents);
  assert.deepEqual(codes(analysis, "core"), input.expected["coreCodes"]);
  assert.ok(analysis.diagnostics.core.every((entry) => entry.severity === "error"));
});

test("keeps soft guidance out of core conformance", async () => {
  const input = await fixture("guidance-only.json");
  const analysis = analyzeBundle(input.documents, { today: input.today });
  assert.deepEqual(codes(analysis, "core"), input.expected["coreCodes"]);
  assert.deepEqual(codes(analysis, "guidance"), input.expected["guidanceCodes"]);
  assert.ok(analysis.diagnostics.guidance.every((entry) => entry.severity === "warning"));
});

test("isolates consumer profile diagnostics from conformance and guidance", () => {
  const analysis = analyzeBundle(
    [{ path: "page.md", content: "---\ntype: Note\nstatus: draft\n---\n# Page\n" }],
    {
      profile: {
        id: "stable-only",
        validate(context) {
          return context.documents
            .filter((document) => document.derived.status !== "stable")
            .map((document) => ({
              code: "stable-only.status",
              path: document.path,
              message: "consumer requires stable concepts",
            }));
        },
      },
    },
  );
  assert.equal(analysis.diagnostics.core.length, 0);
  assert.equal(analysis.diagnostics.guidance.length, 0);
  assert.deepEqual(analysis.diagnostics.profile, [
    {
      code: "stable-only.status",
      family: "profile",
      severity: "error",
      path: "page.md",
      message: "consumer requires stable concepts",
      profile: "stable-only",
    },
  ]);
});

test("matches the language-neutral reserved structure fixture", async () => {
  const input = await fixture("reserved-structure.json");
  const analysis = analyzeBundle(input.documents);
  assert.deepEqual(pathCodes(analysis.diagnostics.core), input.expected["core"]);
  assert.deepEqual(analysis.diagnostics.guidance, input.expected["guidance"]);
  assert.deepEqual(analysis.diagnostics.profile, input.expected["profile"]);
});

test("matches the language-neutral profile partition fixture", async () => {
  const input = await fixture("profile-only.json");
  const profile = input.profile as {
    readonly id: string;
    readonly diagnostics: readonly ProfileDiagnostic[];
  };
  const analysis = analyzeBundle(input.documents, {
    profile: { id: profile.id, validate: () => profile.diagnostics },
  });
  assert.deepEqual(analysis.diagnostics.core, input.expected["core"]);
  assert.deepEqual(analysis.diagnostics.guidance, input.expected["guidance"]);
  assert.deepEqual(analysis.diagnostics.profile, input.expected["profile"]);
});

test("rejects invalid profile output before emitting okf.inspect.v1", () => {
  const documents = [{ path: "page.md", content: "---\ntype: Note\n---\n# Page\n" }];
  assert.throws(
    () => analyzeBundle(documents, {
      profile: {
        id: "broken",
        validate: () => [{ code: "broken", path: "page.md", message: "bad", severity: "fatal" }] as never,
      },
    }),
    new TypeError('profile "broken" returned an invalid diagnostic: entry 0.severity must be error, warning, or info'),
  );
  assert.throws(
    () => analyzeBundle(documents, {
      profile: { id: "broken", validate: () => null as never },
    }),
    new TypeError('profile "broken" returned an invalid diagnostic: validate(context) must return an array'),
  );
});

test("sanitizes valid profile ranges to the inspect contract", () => {
  const analysis = analyzeBundle(
    [{ path: "page.md", content: "---\ntype: Note\n---\n# Page\n" }],
    {
      profile: {
        id: "range",
        validate: () => [{
          code: "range.code",
          path: "page.md",
          message: "bounded",
          range: {
            start: { line: 1, column: 1, offset: 0, ignored: true },
            end: { line: 1, column: 2, offset: 1, ignored: true },
            ignored: true,
          },
        }] as unknown as readonly ProfileDiagnostic[],
      },
    },
  );
  assert.deepEqual(analysis.diagnostics.profile[0]?.range, {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 2, offset: 1 },
  });
});

test("preserves JSON-safe extension metadata and rejects cyclic or non-finite YAML", async () => {
  const input = await fixture("metadata-roundtrip.json");
  const analysis = analyzeBundle(input.documents);
  const expected = input.expected as {
    readonly path: string;
    readonly metadata: Record<string, unknown>;
    readonly core: readonly { readonly path: string; readonly code: string }[];
  };
  const document = analysis.documents.find(({ path }) => path === expected.path);
  assert.ok(document);
  assert.deepEqual(document.metadata, expected.metadata);
  assert.equal(Object.hasOwn(document.metadata, "__proto__"), true);
  assert.notEqual(document.metadata["copy"], (document.metadata["x-extension"] as Record<string, unknown>)["nested"]);
  assert.deepEqual(pathCodes(analysis.diagnostics.core), expected.core);
  for (const rejected of analysis.documents.filter(({ path }) => path !== expected.path)) {
    assert.equal(rejected.frontmatter, null);
    assert.equal(rejected.content, input.documents.find(({ path }) => path === rejected.path)?.content);
  }
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(analysis)));
});

test("uses deterministic timestamp and actor guidance with date-only compatibility", async () => {
  const input = await fixture("guidance-trust.json");
  const analysis = analyzeBundle(input.documents);
  assert.deepEqual(pathCodes(analysis.diagnostics.core), input.expected["core"]);
  assert.deepEqual(pathCodes(analysis.diagnostics.guidance), input.expected["guidance"]);
  assert.deepEqual(analysis.diagnostics.profile, input.expected["profile"]);
});

test("retains exact CRLF frontmatter and body boundaries", () => {
  const content = "---\r\ntype: Note\r\nx-extension: &same { enabled: true }\r\ncopy: *same\r\n---\r\n# Body\r\n";
  const parsed = parseBundleDocument({ path: "page.md", content });
  assert.equal(parsed.document.frontmatter?.raw, content.slice(0, content.indexOf("# Body")));
  assert.equal(parsed.document.body, "# Body\r\n");
  assert.equal(parsed.document.bodyStartLine, 6);
  assert.deepEqual(parsed.document.metadata["copy"], { enabled: true });
});

test("accepts a UTF-8 BOM without losing it from the raw document", () => {
  const content = "\uFEFF---\ntype: Note\n---\n# Body\n";
  const parsed = parseBundleDocument({ path: "page.md", content });
  assert.equal(parsed.diagnostics.core.length, 0);
  assert.ok(parsed.document.frontmatter?.raw.startsWith("\uFEFF---"));
  assert.equal(parsed.document.content, content);
});

test("does not derive titles from headings inside code fences", () => {
  const parsed = parseBundleDocument({
    path: "fallback.md",
    content: "---\ntype: Note\n---\n```markdown\n# Not the title\n```\n",
  });
  assert.equal(parsed.document.derived.title, "fallback");
});

test("duplicate paths are a deterministic bundle error", () => {
  const analysis = analyzeBundle([
    { path: "page.md", content: "---\ntype: Note\n---\n# B\n" },
    { path: "page.md", content: "---\ntype: Note\n---\n# A\n" },
  ]);
  assert.equal(analysis.diagnostics.core.at(-1)?.code, "core.bundle.path.duplicate");
});

test("the attested computation contract is validated, not just its runtime", () => {
  const codes = analyzeBundle([
    { path: "index.md", content: '---\nokf_version: "0.2"\n---\n\n# Index\n' },
    {
      path: "concepts/bad.md",
      content: `---
type: Attested Computation
title: Bad contract
description: Every contract field is malformed.
runtime: bigquery
parameters:
  - { type: integer }
executor: "not a mapping"
attester: { resource: "" }
usage_window: { from: "2026-13-01", to: 2026 }
---

# Bad contract
`,
    },
  ]).diagnostics.guidance.map((entry) => entry.code);

  assert.ok(codes.includes("guidance.parameter.name"), "a parameter needs a name");
  assert.ok(codes.includes("guidance.executor.type"), "executor must be a mapping");
  assert.ok(codes.includes("guidance.attester.resource"), "attester needs a resource");
  assert.ok(codes.includes("guidance.usage-window.from"), "usage_window bounds are dates");
  assert.ok(codes.includes("guidance.usage-window.to"), "usage_window bounds are dates");
});

test("a well-formed contract is reported clean", () => {
  const codes = analyzeBundle([
    { path: "index.md", content: '---\nokf_version: "0.2"\n---\n\n# Index\n' },
    { path: "references/run.md", content: '---\ntype: Skill\ntitle: Run\ndescription: How to run it.\n---\n\n# Run\n' },
    { path: "references/attest.md", content: '---\ntype: Skill\ntitle: Attest\ndescription: How to check it.\n---\n\n# Attest\n' },
    {
      path: "concepts/good.md",
      content: `---
type: Attested Computation
title: Good contract
description: A complete, well-formed contract.
runtime: bigquery
parameters:
  - { name: year, type: integer, required: true }
executor:
  resource: /references/run.md
  receipt: [job_id, executed_sql]
attester:
  resource: /references/attest.md
usage_window: { from: "2026-06-01", to: "2026-06-30" }
---

# Good contract
`,
    },
  ]).diagnostics.guidance.map((entry) => entry.code);

  for (const code of [
    "guidance.parameter.name",
    "guidance.executor.type",
    "guidance.executor.resource",
    "guidance.executor.receipt",
    "guidance.attester.resource",
    "guidance.usage-window.from",
    "guidance.contract.broken",
  ]) {
    assert.ok(!codes.includes(code), `${code} should not fire on a good contract`);
  }
});

test("a contract path that names a page nobody wrote is reported", () => {
  const diagnostics = analyzeBundle([
    { path: "index.md", content: '---\nokf_version: "0.2"\n---\n\n# Index\n' },
    {
      path: "concepts/broken.md",
      content: `---
type: Attested Computation
title: Broken executor
description: Points at a runner that does not exist.
runtime: bigquery
executor:
  resource: /references/missing.md
---

# Broken executor
`,
    },
  ]).diagnostics.guidance;

  const broken = diagnostics.find((entry) => entry.code === "guidance.contract.broken");
  assert.ok(broken, "a broken executor path must be reported");
  assert.match(broken!.message, /executor\.resource does not resolve/);
});

test("the OKF type and both usage windows reach a consumer as extensions", () => {
  const analysis = analyzeBundle([
    { path: "index.md", content: '---\nokf_version: "0.2"\n---\n\n# Index\n' },
    {
      path: "concepts/revenue.md",
      content: `---
type: Metric
title: Revenue
description: Recognised revenue.
usage_window: { from: "2026-06-01", to: "2026-06-30" }
sources:
  - resource: https://example.com/shared-window
    usage_count: 5000
  - resource: https://example.com/own-window
    usage_count: 12
    usage_window: { from: "2026-01-01", to: "2026-03-31" }
---

# Revenue
`,
    },
  ]);

  const document = analysis.documents.find((entry) => entry.path === "concepts/revenue.md");
  assert.ok(document);
  const extensions = documentExtensions(document);

  assert.equal(extensions.okf_type, "Metric");
  assert.equal(extensions.okf_type, document.derived.type);
  assert.deepEqual(extensions.usageWindow, { from: "2026-06-01", to: "2026-06-30" });
  assert.deepEqual(extensions.sourceUsageWindows, [
    null,
    { from: "2026-01-01", to: "2026-03-31" },
  ]);
  assert.equal(extensions.sourceUsageWindows.length, document.derived.sources.length);
  assert.deepEqual(analysis.diagnostics.guidance, []);
});

test("a document with no type or windows projects nulls rather than guessing", () => {
  const { document } = parseBundleDocument({
    path: "concepts/plain.md",
    content: "---\ntitle: Plain\n---\n\n# Plain\n",
  });

  assert.deepEqual(documentExtensions(document), {
    path: "concepts/plain.md",
    okf_type: null,
    usageWindow: null,
    sourceUsageWindows: [],
  });
});

test("a malformed usage window bound is reported, shared and per source", () => {
  const guidance = analyzeBundle([
    { path: "index.md", content: '---\nokf_version: "0.2"\n---\n\n# Index\n' },
    {
      path: "concepts/bad-window.md",
      content: `---
type: Metric
title: Bad windows
description: Both windows are malformed.
usage_window: { from: "2026-6-1", to: "2026-06-30" }
sources:
  - resource: https://example.com/source
    usage_count: 4
    usage_window: last quarter
---

# Bad windows
`,
    },
  ]).diagnostics.guidance;

  const shared = guidance.find((entry) => entry.code === "guidance.usage-window.from");
  assert.ok(shared, "a malformed shared bound must be reported");
  assert.equal(shared!.severity, "warning");
  assert.match(shared!.message, /^usage_window\.from should be YYYY-MM-DD$/);

  const perEntry = guidance.find((entry) => entry.code === "guidance.source.usage-window.type");
  assert.ok(perEntry, "a per-entry window that is not a mapping must be reported");
  assert.equal(perEntry!.severity, "warning");
  assert.match(perEntry!.message, /^sources\[0\]\.usage_window should be a mapping$/);

  assert.ok(!guidance.some((entry) => entry.code === "guidance.usage-window.to"));
});

test("well-formed usage windows stay silent", () => {
  const codes = analyzeBundle([
    { path: "index.md", content: '---\nokf_version: "0.2"\n---\n\n# Index\n' },
    {
      path: "concepts/good-window.md",
      content: `---
type: Metric
title: Good windows
description: Both windows are well formed.
usage_window: { from: "2026-06-01", to: "2026-06-30" }
sources:
  - resource: https://example.com/source
    usage_count: 4
    usage_window: { from: "2026-01-01", to: "2026-03-31" }
---

# Good windows
`,
    },
  ]).diagnostics.guidance.map((entry) => entry.code);

  for (const code of [
    "guidance.usage-window.type",
    "guidance.usage-window.from",
    "guidance.usage-window.to",
    "guidance.source.usage-window.type",
    "guidance.source.usage-window.from",
    "guidance.source.usage-window.to",
  ]) {
    assert.ok(!codes.includes(code), `${code} should not fire on a well-formed window`);
  }
});

test("a perishable page with no expiry date is reported", () => {
  const { diagnostics } = parseBundleDocument({
    path: "concepts/plans.md",
    content: `---
type: Reference
title: Plan pricing
description: What each plan costs.
tags: [pricing, finance, vendor-limits]
---

# Plan pricing
`,
  });

  const perishable = diagnostics.guidance.find(
    (entry) => entry.code === "guidance.stale-after.perishable",
  );
  assert.ok(perishable, "a perishable page with no stale_after must be reported");
  assert.equal(perishable!.severity, "warning");
  assert.equal(perishable!.family, "guidance");
  assert.match(perishable!.message, /^tags pricing, vendor-limits perish/);
});

test("a perishable page that declares an expiry date stays silent", () => {
  const codes = parseBundleDocument({
    path: "concepts/plans.md",
    content: `---
type: Reference
title: Plan pricing
description: What each plan costs.
tags: [pricing]
stale_after: "2026-12-31"
---

# Plan pricing
`,
  }).diagnostics.guidance.map((entry) => entry.code);

  assert.ok(!codes.includes("guidance.stale-after.perishable"));
});

test("an untagged page is never asked for an expiry date", () => {
  const codes = parseBundleDocument({
    path: "concepts/glossary.md",
    content: "---\ntype: Reference\ntitle: Glossary\ndescription: Words.\ntags: [finance]\n---\n\n# Glossary\n",
  }).diagnostics.guidance.map((entry) => entry.code);

  assert.ok(!codes.includes("guidance.stale-after.perishable"));
});

test("a contract path that names a bundle file the loader saw is not broken", () => {
  const codes = analyzeBundle(
    [
      { path: "index.md", content: '---\nokf_version: "0.2"\n---\n\n# Index\n' },
      {
        path: "computations/clubs.md",
        content: `---
type: Attested Computation
title: Club count
description: How many clubs there are.
runtime: postgres
computation: ../references/computations/clubs.sql
attester:
  resource: ../references/attesters/clubs.mjs
---

# Club count
`,
      },
    ],
    {
      nonDocumentPaths: new Set([
        "references/attesters/clubs.mjs",
        "references/computations/clubs.sql",
      ]),
    },
  ).diagnostics.guidance.map((entry) => entry.code);

  assert.ok(
    !codes.includes("guidance.contract.broken"),
    "a query and an attester script are files rather than pages, so neither is broken",
  );
});

test("a contract path that names no file at all is still broken", () => {
  const diagnostics = analyzeBundle(
    [
      { path: "index.md", content: '---\nokf_version: "0.2"\n---\n\n# Index\n' },
      {
        path: "computations/clubs.md",
        content: `---
type: Attested Computation
title: Club count
description: Points at a query nobody wrote.
runtime: postgres
computation: ../references/computations/clubs.sql
---

# Club count
`,
      },
    ],
    { nonDocumentPaths: new Set(["references/computations/members.sql"]) },
  ).diagnostics.guidance;

  const broken = diagnostics.find((entry) => entry.code === "guidance.contract.broken");
  assert.ok(broken, "knowing about other files must not excuse a path that resolves to none of them");
  assert.match(broken!.message, /^computation does not resolve: \.\.\/references\/computations\/clubs\.sql$/);
});

test("a contract path that leaves the bundle escapes rather than resolving to a file", () => {
  const diagnostics = analyzeBundle(
    [
      { path: "index.md", content: '---\nokf_version: "0.2"\n---\n\n# Index\n' },
      {
        path: "computations/clubs.md",
        content: `---
type: Attested Computation
title: Club count
description: Points outside the bundle.
runtime: postgres
computation: ../../elsewhere/clubs.sql
---

# Club count
`,
      },
    ],
    { nonDocumentPaths: new Set(["elsewhere/clubs.sql"]) },
  ).diagnostics.guidance;

  const escape = diagnostics.find((entry) => entry.code === "guidance.contract.escape");
  assert.ok(escape, "a path that leaves the bundle is an escape whatever the loader saw inside it");
  assert.match(escape!.message, /^computation escapes the bundle: \.\.\/\.\.\/elsewhere\/clubs\.sql$/);
  assert.ok(!diagnostics.some((entry) => entry.code === "guidance.contract.broken"));
});

test("a source resource naming an unwritten page still reports, whatever files exist", () => {
  const diagnostics = analyzeBundle(
    [
      { path: "index.md", content: '---\nokf_version: "0.2"\n---\n\n# Index\n' },
      {
        path: "concepts/revenue.md",
        content: `---
type: Metric
title: Revenue
description: Cites a page that has not been written.
sources:
  - title: The pricing page
    resource: ../references/pricing.md
---

# Revenue
`,
      },
    ],
    { nonDocumentPaths: new Set(["references/pricing.md"]) },
  ).diagnostics.guidance;

  const broken = diagnostics.find((entry) => entry.code === "guidance.source.broken");
  assert.ok(broken, "a source naming an unwritten page is the corpus's to-do list, not a file reference");
  assert.match(broken!.message, /^sources\[0\]\.resource does not resolve: \.\.\/references\/pricing\.md$/);
});
