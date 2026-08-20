import assert from "node:assert/strict";
import test from "node:test";
import { loadReleasePlan, parseVersion } from "../release-config.mjs";

test("release plan fixes package order and prerelease tag", async () => {
  const plan = await loadReleasePlan({ tag: "v1.0.0-rc.0" });
  assert.equal(plan.distTag, "next");
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
      "okf-cli",
    ],
  );
});

test("release plan rejects a tag that does not match the package version", async () => {
  await assert.rejects(
    loadReleasePlan({ tag: "v1.0.0" }),
    /release tag must be v1\.0\.0-rc\.0/,
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
