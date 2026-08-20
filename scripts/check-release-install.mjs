import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { loadReleasePlan, root } from "./release-config.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
}

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${String(result.status)}`);
  }
}

const tag = argumentValue("--tag");
const directory = resolve(root, argumentValue("--directory"));
const plan = await loadReleasePlan({ tag });
const releaseManifest = JSON.parse(
  await readFile(join(directory, "RELEASE.json"), "utf8"),
);
if (releaseManifest.tag !== tag) throw new Error("release manifest tag mismatch");

const installation = await mkdtemp(join(tmpdir(), "okf-release-install-"));
try {
  const dependencies = {};
  const overrides = {};
  for (const releasePackage of plan.packages) {
    const tarball = `file:${join(directory, releasePackage.filename)}`;
    dependencies[releasePackage.name] = tarball;
    overrides[releasePackage.name] = tarball;
  }
  await writeFile(
    join(installation, "package.json"),
    `${JSON.stringify(
      {
        dependencies,
        name: "okf-release-install-check",
        pnpm: { overrides },
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );

  run("pnpm", ["install", "--offline", "--ignore-scripts"], installation);
  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await Promise.all(${JSON.stringify(
        plan.packages.map(({ name }) => name),
      )}.map((name) => import(name)));`,
    ],
    installation,
  );
  run(join(installation, "node_modules", ".bin", "okf"), [], installation);
} finally {
  await rm(installation, { force: true, recursive: true });
}

console.log(`Installed and imported all packages for ${plan.expectedTag}`);
