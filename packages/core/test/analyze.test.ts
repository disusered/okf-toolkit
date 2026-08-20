import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { Diagnostic, RawBundleDocument } from "okf-contracts";

import type { ProfileDiagnostic } from "../src/index.js";
import { analyzeBundle, parseBundleDocument } from "../src/index.js";

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
  assert.equal(analysis.graph.nodes.length, 3);
  assert.equal(analysis.graph.edges.length, 3);

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
