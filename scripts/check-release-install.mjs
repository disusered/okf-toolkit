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
const target = plan.target;
const releaseManifest = JSON.parse(
  await readFile(join(directory, "RELEASE.json"), "utf8"),
);
if (releaseManifest.tag !== tag) throw new Error("release manifest tag mismatch");

const installation = await mkdtemp(join(tmpdir(), "okf-release-install-"));
try {
  const tarball = `file:${join(directory, target.filename)}`;
  // Only the package being released comes from the tarball. Its `okf-*` dependencies resolve
  // from the registry, which is the point: releasing a package whose dependency has not been
  // published yet must fail here rather than after publication.
  await writeFile(
    join(installation, "package.json"),
    `${JSON.stringify(
      {
        dependencies: { [target.name]: tarball },
        name: "okf-release-install-check",
        packageManager: plan.packageManager,
        pnpm: { overrides: { [target.name]: tarball } },
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );

  run("pnpm", ["install", "--prefer-offline", "--ignore-scripts"], installation);
  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(target.name)});`,
    ],
    installation,
  );
  const binaries = Object.keys(
    JSON.parse(
      await readFile(
        join(root, "packages", target.directory, "package.json"),
        "utf8",
      ),
    ).bin ?? {},
  );
  for (const binary of binaries) {
    run(join(installation, "node_modules", ".bin", binary), [], installation);
  }
} finally {
  await rm(installation, { force: true, recursive: true });
}

console.log(`Installed and imported ${target.name}@${target.version}`);
