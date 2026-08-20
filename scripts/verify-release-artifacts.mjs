import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadReleasePlan, root } from "./release-config.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
}

function tar(arguments_) {
  const result = spawnSync("tar", arguments_, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `tar ${arguments_.join(" ")} failed`);
  }
  return result.stdout;
}

function exportedPaths(value) {
  if (typeof value === "string") return value.startsWith("./") ? [value] : [];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(exportedPaths);
}

function hasExport(entries, path) {
  const target = `package/${path.slice(2)}`;
  if (!target.includes("*")) return entries.has(target);
  const pattern = target
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".+");
  const expression = new RegExp(`^${pattern}$`);
  return [...entries].some((entry) => expression.test(entry));
}

const tag = argumentValue("--tag");
const directory = resolve(root, argumentValue("--directory"));
const plan = await loadReleasePlan({ tag });
const releaseManifest = JSON.parse(
  await readFile(join(directory, "RELEASE.json"), "utf8"),
);

if (
  releaseManifest.schema !== "okf.release.v1" ||
  releaseManifest.tag !== plan.expectedTag ||
  releaseManifest.version !== plan.version ||
  releaseManifest.dist_tag !== plan.distTag ||
  releaseManifest.prerelease !== plan.prerelease ||
  !Array.isArray(releaseManifest.packages) ||
  releaseManifest.packages.length !== plan.packages.length
) {
  throw new Error("RELEASE.json does not match the release plan");
}
if (
  JSON.stringify(releaseManifest.packages.map(({ name }) => name)) !==
  JSON.stringify(plan.packages.map(({ name }) => name))
) {
  throw new Error("RELEASE.json package order does not match the release plan");
}

const forbidden = [
  /^package\/(?:src|test|node_modules|\.git|\.test-dist)(?:\/|$)/,
  /^package\/(?:.*\/)?\.env(?:\.|$)/,
];

for (const releasePackage of plan.packages) {
  const artifact = releaseManifest.packages.find(
    ({ name }) => name === releasePackage.name,
  );
  if (artifact?.filename !== releasePackage.filename) {
    throw new Error(`RELEASE.json is missing ${releasePackage.name}`);
  }

  const tarball = join(directory, releasePackage.filename);
  const bytes = await readFile(tarball);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (artifact.sha256 !== sha256 || artifact.integrity !== integrity) {
    throw new Error(`RELEASE.json digest mismatch for ${releasePackage.filename}`);
  }

  const entries = tar(["-tf", tarball]).trimEnd().split("\n");
  const verboseEntries = tar(["-tvf", tarball]).trimEnd().split("\n");
  if (verboseEntries.length !== entries.length) {
    throw new Error(`${releasePackage.filename} has an unreadable archive listing`);
  }
  for (const [index, entry] of entries.entries()) {
    const segments = entry.split("/");
    if (
      !entry.startsWith("package/") ||
      entry.includes("\\") ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error(`${releasePackage.filename} has unsafe archive path ${entry}`);
    }
    if (verboseEntries[index]?.[0] !== "-") {
      throw new Error(`${releasePackage.filename} has non-file archive entry ${entry}`);
    }
  }
  const entrySet = new Set(entries);
  for (const required of ["package/package.json", "package/README.md", "package/LICENSE"]) {
    if (!entrySet.has(required)) {
      throw new Error(`${releasePackage.filename} is missing ${required}`);
    }
  }
  for (const entry of entries) {
    if (forbidden.some((pattern) => pattern.test(entry))) {
      throw new Error(`${releasePackage.filename} contains forbidden path ${entry}`);
    }
  }

  const packedManifest = JSON.parse(
    tar(["-xOf", tarball, "package/package.json"]),
  );
  if (
    packedManifest.name !== releasePackage.name ||
    packedManifest.version !== plan.version
  ) {
    throw new Error(`${releasePackage.filename} has incorrect package identity`);
  }
  if (JSON.stringify(packedManifest).includes("workspace:")) {
    throw new Error(`${releasePackage.filename} contains a workspace dependency`);
  }
  for (const [dependency, range] of Object.entries(packedManifest.dependencies ?? {})) {
    if (dependency.startsWith("okf-") && range !== plan.version) {
      throw new Error(
        `${releasePackage.filename} must pin ${dependency} to ${plan.version}`,
      );
    }
  }
  for (const path of exportedPaths(packedManifest.exports)) {
    if (!hasExport(entrySet, path)) {
      throw new Error(`${releasePackage.filename} is missing export ${path}`);
    }
  }

  for (const path of Object.values(packedManifest.bin ?? {})) {
    const entry = `package/${path.replace(/^\.\//, "")}`;
    if (!entrySet.has(entry)) {
      throw new Error(`${releasePackage.filename} is missing binary ${path}`);
    }
    const mode = tar(["-tvf", tarball, entry]).slice(0, 10);
    if (mode[0] !== "-" || mode[3] !== "x") {
      throw new Error(`${releasePackage.filename} binary is not executable: ${path}`);
    }
  }
}

const contracts = new Set(
  tar([
    "-tf",
    join(directory, `okf-contracts-${plan.version}.tgz`),
  ]).trimEnd().split("\n"),
);
for (const path of [
  "package/NOTICE",
  "package/schemas/okf.inspect.v1.schema.json",
  "package/schemas/okf.operations.v1.schema.json",
  "package/spec/SPEC.md",
]) {
  if (!contracts.has(path)) throw new Error(`okf-contracts is missing ${path}`);
}

const visualization = new Set(
  tar(["-tf", join(directory, `okf-viz-${plan.version}.tgz`)])
    .trimEnd()
    .split("\n"),
);
if (!visualization.has("package/THIRD_PARTY_NOTICES.md")) {
  throw new Error("okf-viz is missing THIRD_PARTY_NOTICES.md");
}

console.log(`Verified ${plan.packages.length} release tarballs for ${plan.expectedTag}`);
