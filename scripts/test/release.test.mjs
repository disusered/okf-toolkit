import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadReleasePlan, parseVersion } from "../release-config.mjs";

test("release plan fixes package order and prerelease tag", async () => {
  const plan = await loadReleasePlan({ tag: "v1.0.0-rc.1" });
  assert.equal(plan.distTag, "next");
  assert.equal(plan.packageManager, "pnpm@10.28.2");
  assert.equal(plan.prerelease, true);
  assert.deepEqual(
    plan.packages.map(({ name }) => name),
    [
      "okf-contracts",
      "okf-core",
      "okf-viz",
      "okf-node",
      "okf-signatures",
      "okf-cloudflare",
      "@disusered/okf-cli",
    ],
  );
  assert.equal(
    plan.packages.at(-1)?.filename,
    "disusered-okf-cli-1.0.0-rc.1.tgz",
  );
});

test("release plan rejects a tag that does not match the package version", async () => {
  await assert.rejects(
    loadReleasePlan({ tag: "v1.0.0" }),
    /release tag must be v1\.0\.0-rc\.1/,
  );
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
