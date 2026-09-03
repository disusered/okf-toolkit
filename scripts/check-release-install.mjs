import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  if (index === process.argv.length - 1) {
    throw new Error(`${name} requires a value`);
  }
  return process.argv[index + 1];
}

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${String(result.status)}`);
  }
}

/**
 * Resolve `okf-*` dependencies from local tarballs instead of the registry.
 *
 * A release resolves them from npm on purpose, so releasing a package before its dependency
 * has been published fails here. CI has no published version to resolve against when a
 * dependency has been bumped but not yet released, so it packs the whole workspace and points
 * this at that directory.
 */
async function localOverrides(directory) {
  if (directory === undefined) return {};
  const overrides = {};
  for (const entry of await readdir(directory)) {
    if (!entry.endsWith(".tgz")) continue;
    const tarball = join(directory, entry);
    const listed = spawnSync("tar", ["-xOf", tarball, "package/package.json"], {
      encoding: "utf8",
    });
    if (listed.status !== 0) {
      throw new Error(`could not read ${entry}`);
    }
    overrides[JSON.parse(listed.stdout).name] = `file:${tarball}`;
  }
  return overrides;
}

const tag = argumentValue("--tag");
const directory = resolve(root, argumentValue("--directory"));
const dependencyDirectoryArgument = optionValue("--dependencies");
const dependencyDirectory =
  dependencyDirectoryArgument === undefined
    ? undefined
    : resolve(root, dependencyDirectoryArgument);
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
  // published yet must fail here rather than after publication. `--dependencies` overrides
  // that for CI, which has nothing published to resolve against.
  const overrides = {
    ...(await localOverrides(dependencyDirectory)),
    [target.name]: tarball,
  };
  await writeFile(
    join(installation, "package.json"),
    `${JSON.stringify(
      {
        dependencies: { [target.name]: tarball },
        name: "okf-release-install-check",
        packageManager: plan.packageManager,
        pnpm: { overrides },
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
