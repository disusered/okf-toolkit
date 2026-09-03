import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  loadReleasePlan,
  packFilename,
  parseReleaseTag,
  parseVersion,
  releaseTag,
} from "../release-config.mjs";

/*
 * Read versions rather than hardcoding them. These assertions used to name a release literally,
 * so every version bump failed a test that was not about versions. Now that each package carries
 * its own version, hardcoding one would fail for six packages instead of one.
 */
async function manifestVersion(directory) {
  return JSON.parse(
    await readFile(
      new URL(`../../packages/${directory}/package.json`, import.meta.url),
      "utf8",
    ),
  ).version;
}

const VIZ_VERSION = await manifestVersion("viz");
const CLI_VERSION = await manifestVersion("cli");

test("the workspace check validates every package without a tag", async () => {
  const plan = await loadReleasePlan();
  assert.equal(plan.target, null);
  assert.deepEqual(
    plan.packages.map(({ name }) => name),
    [
      "okf-contracts",
      "okf-core",
      "okf-viz",
      "okf-page",
      "okf-node",
      "okf-signatures",
      "okf-cloudflare",
      "@disusered/okf-cli",
    ],
  );
  // Dependency order is a repository invariant, not a release schedule.
  const indexes = new Map(plan.packages.map(({ name }, index) => [name, index]));
  assert.ok(indexes.get("okf-contracts") < indexes.get("okf-core"));
  assert.ok(indexes.get("okf-viz") < indexes.get("okf-page"));
  assert.ok(indexes.get("okf-page") < indexes.get("@disusered/okf-cli"));
});

test("a tag resolves exactly one package to release", async () => {
  const plan = await loadReleasePlan({ tag: `okf-viz@${VIZ_VERSION}` });
  assert.equal(plan.target.name, "okf-viz");
  assert.equal(plan.target.version, VIZ_VERSION);
  assert.equal(plan.expectedTag, `okf-viz@${VIZ_VERSION}`);
  assert.equal(plan.distTag, parseVersion(VIZ_VERSION).prerelease ? "next" : "latest");
  assert.equal(plan.packageManager, "pnpm@10.28.2");
});

test("a scoped package keeps its leading @ in the tag and loses it in the filename", async () => {
  const tag = `@disusered/okf-cli@${CLI_VERSION}`;
  const plan = await loadReleasePlan({ tag });
  assert.equal(plan.target.name, "@disusered/okf-cli");
  assert.equal(plan.target.filename, `disusered-okf-cli-${CLI_VERSION}.tgz`);
  assert.deepEqual(parseReleaseTag(tag), {
    name: "@disusered/okf-cli",
    version: CLI_VERSION,
  });
  assert.equal(releaseTag("@disusered/okf-cli", CLI_VERSION), tag);
  assert.equal(packFilename("okf-viz", "2.0.0"), "okf-viz-2.0.0.tgz");
});

test("package versions are independent of one another", async () => {
  const plan = await loadReleasePlan();
  // The point of the per-package release: nothing requires two packages to agree, and the
  // workspace root's version is not a release version at all.
  assert.equal(typeof plan.workspaceVersions["okf-contracts"], "string");
  assert.equal(plan.workspaceVersions["okf-viz"], VIZ_VERSION);
  for (const { name, version } of plan.packages) {
    assert.equal(plan.workspaceVersions[name], version);
    assert.doesNotThrow(() => parseVersion(version));
  }
});

test("release tags are rejected when malformed or wrong", async () => {
  await assert.rejects(
    loadReleasePlan({ tag: `v${VIZ_VERSION}` }),
    /release tag must be <name>@<version>/,
  );
  await assert.rejects(
    loadReleasePlan({ tag: "okf-viz" }),
    /release tag must be <name>@<version>/,
  );
  await assert.rejects(
    loadReleasePlan({ tag: "not-a-package@1.0.0" }),
    /release tag names an unknown package: not-a-package/,
  );
  await assert.rejects(
    loadReleasePlan({ tag: "okf-viz@0.0.0-not-the-version" }),
    new RegExp(`release tag must be okf-viz@${VIZ_VERSION.replace(/[.\-+]/g, "\\$&")}`),
  );
  assert.equal(parseReleaseTag("okf-viz"), null);
  assert.equal(parseReleaseTag("@scope/name"), null);
});

test("version parsing follows SemVer prerelease rules", () => {
  assert.equal(parseVersion("1.0.0-rc.0").prerelease, true);
  assert.equal(parseVersion("1.0.0+build-x").prerelease, false);
  assert.throws(() => parseVersion("1.0.0-01"), /not valid SemVer/);
  assert.throws(
    () => parseVersion("9007199254740992.0.0"),
    /not valid npm SemVer/,
  );
});

test("release workflow uses OIDC without an npm publish token", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /npm publish/);
  assert.match(
    workflow,
    /registry_visibility_delays=\(0 1 2 4 8 16 32 64\)/,
  );
  assert.match(workflow, /npm is still processing/);
  assert.match(workflow, /path: \$\{\{ env\.RELEASE_DIRECTORY \}\}/);
  assert.doesNotMatch(workflow, /runner\.temp.*okf-release/);
  assert.doesNotMatch(
    workflow,
    /NODE_AUTH_TOKEN|NPM_BOOTSTRAP_TOKEN|NPM_TOKEN/,
  );
});

test("release workflow releases one package, not the whole workspace", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  // The seven-package assumption used to be hardcoded in five places. If any of them comes
  // back, a single-package release will silently try to publish packages it never built.
  assert.doesNotMatch(workflow, /\(\.packages \| length\) == 7/);
  assert.doesNotMatch(workflow, /okf-signatures\s+okf-cloudflare/);
  assert.match(workflow, /PACKAGE_NAME/);
  assert.match(workflow, /\.package\.name/);
});
