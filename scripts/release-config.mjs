import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryUrl = "git+https://github.com/disusered/okf-toolkit.git";
export const releasePackages = [
  { directory: "contracts", name: "okf-contracts" },
  { directory: "core", name: "okf-core" },
  { directory: "viz", name: "okf-viz" },
  { directory: "node", name: "okf-node" },
  { directory: "signatures", name: "okf-signatures" },
  { directory: "mcp", name: "okf-mcp" },
  { directory: "cloudflare", name: "okf-cloudflare" },
  { directory: "cli", name: "@disusered/okf-cli" },
];

export function packFilename(name, version) {
  const stem = name.startsWith("@")
    ? name.slice(1).replaceAll("/", "-")
    : name;
  return `${stem}-${version}.tgz`;
}

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseVersion(value) {
  if (typeof value !== "string") {
    throw new Error(`package version is not valid SemVer: ${String(value)}`);
  }
  const match = semverPattern.exec(value);
  if (!match) {
    throw new Error(`package version is not valid SemVer: ${value}`);
  }
  if (
    match
      .slice(1, 4)
      .some((part) => BigInt(part) > BigInt(Number.MAX_SAFE_INTEGER))
  ) {
    throw new Error(`package version is not valid npm SemVer: ${value}`);
  }
  return { prerelease: match[4] !== undefined, value };
}

async function readManifest(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function packageRepositoryUrl(manifest) {
  return typeof manifest.repository === "string"
    ? manifest.repository
    : manifest.repository?.url;
}

export async function loadReleasePlan({ tag } = {}) {
  const rootManifest = await readManifest(join(root, "package.json"));
  const parsedVersion = parseVersion(rootManifest.version);
  const version = parsedVersion.value;
  if (rootManifest.private !== true) {
    throw new Error("workspace root must remain private");
  }
  if (packageRepositoryUrl(rootManifest) !== repositoryUrl) {
    throw new Error(`workspace repository must be ${repositoryUrl}`);
  }
  if (!/^pnpm@[0-9]+\.[0-9]+\.[0-9]+$/.test(rootManifest.packageManager ?? "")) {
    throw new Error("workspace must pin an exact pnpm package manager version");
  }

  const expectedTag = `v${version}`;
  if (tag !== undefined && tag !== expectedTag) {
    throw new Error(`release tag must be ${expectedTag}, received ${tag}`);
  }

  const packageDirectories = await readdir(join(root, "packages"), {
    withFileTypes: true,
  });
  const discoveredPublicPackages = [];
  for (const entry of packageDirectories) {
    if (!entry.isDirectory()) continue;
    const manifest = await readManifest(
      join(root, "packages", entry.name, "package.json"),
    );
    if (manifest.private !== true) {
      discoveredPublicPackages.push(`${entry.name}:${String(manifest.name)}`);
    }
  }
  const configuredPublicPackages = releasePackages.map(
    ({ directory, name }) => `${directory}:${name}`,
  );
  discoveredPublicPackages.sort();
  configuredPublicPackages.sort();
  if (
    JSON.stringify(discoveredPublicPackages) !==
    JSON.stringify(configuredPublicPackages)
  ) {
    throw new Error(
      `public package set does not match release configuration: ${discoveredPublicPackages.join(", ")}`,
    );
  }

  const packages = [];
  for (const releasePackage of releasePackages) {
    const manifestPath = join(
      root,
      "packages",
      releasePackage.directory,
      "package.json",
    );
    const manifest = await readManifest(manifestPath);

    if (manifest.name !== releasePackage.name) {
      throw new Error(
        `${manifestPath} must declare package name ${releasePackage.name}`,
      );
    }
    if (manifest.version !== version) {
      throw new Error(
        `${releasePackage.name} version ${String(manifest.version)} does not match ${version}`,
      );
    }
    if (manifest.private === true) {
      throw new Error(`${releasePackage.name} must be public`);
    }
    if (manifest.publishConfig?.access !== "public") {
      throw new Error(`${releasePackage.name} must publish with public access`);
    }
    if (packageRepositoryUrl(manifest) !== repositoryUrl) {
      throw new Error(`${releasePackage.name} repository must be ${repositoryUrl}`);
    }
    if (manifest.repository?.directory !== `packages/${releasePackage.directory}`) {
      throw new Error(
        `${releasePackage.name} repository directory must be packages/${releasePackage.directory}`,
      );
    }

    for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
      if (dependency.startsWith("okf-") && range !== "workspace:*") {
        throw new Error(
          `${releasePackage.name} must declare ${dependency} as workspace:*`,
        );
      }
    }

    packages.push({
      ...releasePackage,
      dependencies: Object.keys(manifest.dependencies ?? {}).filter((name) =>
        name.startsWith("okf-"),
      ),
      filename: packFilename(releasePackage.name, version),
    });
  }

  const packageIndexes = new Map(
    packages.map(({ name }, index) => [name, index]),
  );
  for (const [index, releasePackage] of packages.entries()) {
    for (const dependency of releasePackage.dependencies) {
      const dependencyIndex = packageIndexes.get(dependency);
      if (dependencyIndex === undefined) {
        throw new Error(
          `${releasePackage.name} depends on unconfigured package ${dependency}`,
        );
      }
      if (dependencyIndex >= index) {
        throw new Error(
          `${releasePackage.name} must appear after dependency ${dependency}`,
        );
      }
    }
  }

  return {
    distTag: parsedVersion.prerelease ? "next" : "latest",
    expectedTag,
    packageManager: rootManifest.packageManager,
    packages: packages.map(({ dependencies: _, ...releasePackage }) =>
      releasePackage
    ),
    prerelease: parsedVersion.prerelease,
    version,
  };
}
