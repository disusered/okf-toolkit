import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  ["contracts", "okf-contracts"],
  ["core", "okf-core"],
  ["viz", "okf-viz"],
  ["node", "okf-node"],
  ["signatures", "okf-signatures"],
  ["cloudflare", "okf-cloudflare"],
  ["cli", "okf-cli"],
];
const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const outputArgument = process.argv.slice(2).find((argument) => argument !== "--");
const output = resolve(root, outputArgument ?? `release/${rootManifest.version}`);

await mkdir(output, { recursive: true });
const existing = await readdir(output);
if (existing.some((name) => name.endsWith(".tgz") || name === "SHA256SUMS")) {
  throw new Error(`release directory is not empty: ${output}`);
}

for (const [directory] of packages) {
  const result = spawnSync(
    "pnpm",
    ["pack", "--pack-destination", output],
    { cwd: join(root, "packages", directory), stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const sums = [];
for (const [, name] of packages) {
  const filename = `${name}-${rootManifest.version}.tgz`;
  const bytes = await readFile(join(output, filename));
  sums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${filename}`);
}
await writeFile(join(output, "SHA256SUMS"), `${sums.join("\n")}\n`, { flag: "wx" });
console.log(`Packed ${packages.length} public packages in ${output}`);
