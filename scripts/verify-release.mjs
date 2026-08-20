import { loadReleasePlan } from "./release-config.mjs";

const arguments_ = process.argv.slice(2);
const tagIndex = arguments_.indexOf("--tag");
if (tagIndex !== -1 && tagIndex === arguments_.length - 1) {
  throw new Error("--tag requires a value");
}
const tag = tagIndex === -1 ? undefined : arguments_[tagIndex + 1];
const prereleaseIndex = arguments_.indexOf("--prerelease");
if (prereleaseIndex !== -1 && prereleaseIndex === arguments_.length - 1) {
  throw new Error("--prerelease requires true or false");
}
const plan = await loadReleasePlan({ tag });
if (prereleaseIndex !== -1) {
  const value = arguments_[prereleaseIndex + 1];
  if (value !== "true" && value !== "false") {
    throw new Error("--prerelease requires true or false");
  }
  if ((value === "true") !== plan.prerelease) {
    throw new Error(
      `GitHub prerelease state must be ${String(plan.prerelease)} for ${plan.version}`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      dist_tag: plan.distTag,
      packages: plan.packages.map(({ filename, name }) => ({ filename, name })),
      prerelease: plan.prerelease,
      schema: "okf.release-plan.v1",
      tag: plan.expectedTag,
      version: plan.version,
    },
    null,
    2,
  ),
);
