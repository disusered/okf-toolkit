import { loadReleasePlan, releaseTag } from "./release-config.mjs";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  if (index === process.argv.length - 1) {
    throw new Error(`${name} requires a value`);
  }
  return process.argv[index + 1];
}

const tag = optionValue("--tag");
const prerelease = optionValue("--prerelease");
const plan = await loadReleasePlan({ tag });

// Without a tag this is the workspace-wide check `pnpm check` runs: every public package is
// valid and the dependency order holds. There is no single version to report, because versions
// are independent.
if (plan.target === null) {
  if (prerelease !== undefined) {
    throw new Error("--prerelease requires --tag");
  }
  console.log(
    JSON.stringify(
      {
        // The tag is reported rather than left to the caller to build: a second place that
        // knows the format is what made a release fail once already.
        packages: plan.packages.map(({ name, version }) => ({
          name,
          tag: releaseTag(name, version),
          version,
        })),
        schema: "okf.release-plan.v1",
      },
      null,
      2,
    ),
  );
} else {
  if (prerelease !== undefined) {
    if (prerelease !== "true" && prerelease !== "false") {
      throw new Error("--prerelease requires true or false");
    }
    if ((prerelease === "true") !== plan.target.prerelease) {
      throw new Error(
        `GitHub prerelease state must be ${String(plan.target.prerelease)} for ${plan.expectedTag}`,
      );
    }
  }
  console.log(
    JSON.stringify(
      {
        dist_tag: plan.distTag,
        package: {
          filename: plan.target.filename,
          name: plan.target.name,
          version: plan.target.version,
        },
        prerelease: plan.target.prerelease,
        schema: "okf.release-plan.v1",
        tag: plan.expectedTag,
      },
      null,
      2,
    ),
  );
}
