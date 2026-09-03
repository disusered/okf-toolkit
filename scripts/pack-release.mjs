import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadReleasePlan, root } from "./release-config.mjs";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  if (index === process.argv.length - 1) {
    throw new Error(`${name} requires a value`);
  }
  return process.argv[index + 1];
}

const tag = optionValue("--tag");
if (tag === undefined) throw new Error("--tag is required");
const plan = await loadReleasePlan({ tag });
const target = plan.target;

const positional = process.argv
  .slice(2)
  .filter((argument, index, all) =>
    argument !== "--" && argument !== "--tag" && all[index - 1] !== "--tag"
  );
const output = resolve(root, positional[0] ?? `release/${target.name}@${target.version}`);

await mkdir(output, { recursive: true });
const existing = await readdir(output);
if (existing.length > 0) {
  throw new Error(`release directory is not empty: ${output}`);
}

const result = spawnSync("pnpm", ["pack", "--pack-destination", output], {
  cwd: join(root, "packages", target.directory),
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);

const bytes = await readFile(join(output, target.filename));
const artifact = {
  filename: target.filename,
  integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  name: target.name,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  version: target.version,
};

await writeFile(
  join(output, "SHA256SUMS"),
  `${artifact.sha256}  ${artifact.filename}\n`,
  { flag: "wx" },
);
await writeFile(
  join(output, "RELEASE.json"),
  `${JSON.stringify(
    {
      dist_tag: plan.distTag,
      package: artifact,
      prerelease: target.prerelease,
      schema: "okf.release.v1",
      tag: plan.expectedTag,
    },
    null,
    2,
  )}\n`,
  { flag: "wx" },
);
console.log(`Packed ${target.name}@${target.version} in ${output}`);
