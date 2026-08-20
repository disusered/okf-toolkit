import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadReleasePlan, root } from "./release-config.mjs";

const plan = await loadReleasePlan();
const outputArgument = process.argv.slice(2).find((argument) => argument !== "--");
const output = resolve(root, outputArgument ?? `release/${plan.version}`);

await mkdir(output, { recursive: true });
const existing = await readdir(output);
if (existing.length > 0) {
  throw new Error(`release directory is not empty: ${output}`);
}

for (const releasePackage of plan.packages) {
  const result = spawnSync(
    "pnpm",
    ["pack", "--pack-destination", output],
    {
      cwd: join(root, "packages", releasePackage.directory),
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const artifacts = [];
for (const releasePackage of plan.packages) {
  const bytes = await readFile(join(output, releasePackage.filename));
  artifacts.push({
    filename: releasePackage.filename,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    name: releasePackage.name,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const sums = artifacts.map(({ filename, sha256 }) => `${sha256}  ${filename}`);
await writeFile(join(output, "SHA256SUMS"), `${sums.join("\n")}\n`, { flag: "wx" });
await writeFile(
  join(output, "RELEASE.json"),
  `${JSON.stringify(
    {
      dist_tag: plan.distTag,
      packages: artifacts,
      prerelease: plan.prerelease,
      schema: "okf.release.v1",
      tag: plan.expectedTag,
      version: plan.version,
    },
    null,
    2,
  )}\n`,
  { flag: "wx" },
);
console.log(`Packed ${plan.packages.length} public packages in ${output}`);
