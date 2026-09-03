import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryUrl = "git+https://github.com/disusered/okf-toolkit.git";

/**
 * Every public package, in dependency order.
 *
 * The order is an invariant of the repository rather than a release schedule: a package may
 * only depend on one that appears before it. Releases are per package, so this list no longer
 * describes what a single release publishes.
 */
export const releasePackages = [
  { directory: "contracts", name: "okf-contracts" },
  { directory: "core", name: "okf-core" },
  { directory: "viz", name: "okf-viz" },
  { directory: "node", name: "okf-node" },
  { directory: "signatures", name: "okf-signatures" },
  { directory: "cloudflare", name: "okf-cloudflare" },
  { directory: "cli", name: "@disusered/okf-cli" },
];

export function packFilename(name, version) {
  const stem = name.startsWith("@")
    ? name.slice(1).replaceAll("/", "-")
    : name;
  return `${stem}-${version}.tgz`;
}

/** A package name flattened to one path-safe segment: `@disusered/okf-cli` → `disusered-okf-cli`. */
export function packageStem(name) {
  return name.startsWith("@") ? name.slice(1).replaceAll("/", "-") : name;
}

/**
 * The git tag that releases one package.
 *
 * It leads with `v` and carries no slash, for both packages and scopes, so one deployment rule
 * on the release environment covers every package there is and every package there will be.
 * Tags and environment rules living in different places is what made a release fail after its
 * build had already passed; a format that needs no rule cannot fail that way again.
 */
export function releaseTag(name, version) {
  return `v-${packageStem(name)}@${version}`;
}

/**
 * Split `v-<stem>@<version>`.
 *
 * Returns null rather than throwing so a caller can report the tag it was given. The stem is
 * matched back to a package name by `loadReleasePlan`, since only it knows the package set.
 */
export function parseReleaseTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v-")) return null;
  const rest = tag.slice(2);
  const separator = rest.lastIndexOf("@");
  if (separator <= 0) return null;
  const stem = rest.slice(0, separator);
  const version = rest.slice(separator + 1);
  if (stem === "" || version === "") return null;
  return { stem, version };
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

/**
 * Validate every public package, and resolve the one a tag names.
 *
 * Without a tag this checks the whole workspace and returns no target, which is what
 * `pnpm release:verify` runs. With a tag it additionally resolves that package, and the caller
 * releases only it. Package versions are independent: nothing here requires two packages to
 * carry the same version, and the workspace root's version is not a release version at all.
 */
export async function loadReleasePlan({ tag } = {}) {
  const rootManifest = await readManifest(join(root, "package.json"));
  if (rootManifest.private !== true) {
    throw new Error("workspace root must remain private");
  }
  if (packageRepositoryUrl(rootManifest) !== repositoryUrl) {
    throw new Error(`workspace repository must be ${repositoryUrl}`);
  }
  if (!/^pnpm@[0-9]+\.[0-9]+\.[0-9]+$/.test(rootManifest.packageManager ?? "")) {
    throw new Error("workspace must pin an exact pnpm package manager version");
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
    const parsedVersion = parseVersion(manifest.version);
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
      filename: packFilename(releasePackage.name, parsedVersion.value),
      prerelease: parsedVersion.prerelease,
      version: parsedVersion.value,
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

  /** What `pnpm pack` will write in place of each `workspace:*` range. */
  const workspaceVersions = Object.fromEntries(
    packages.map(({ name, version }) => [name, version]),
  );
  const published = packages.map(({ dependencies: _, ...releasePackage }) => releasePackage);

  if (tag === undefined) {
    return { packages: published, target: null, workspaceVersions };
  }

  const parsedTag = parseReleaseTag(tag);
  if (parsedTag === null) {
    throw new Error(`release tag must be v-<package>@<version>, received ${String(tag)}`);
  }
  const target = published.find(({ name }) => packageStem(name) === parsedTag.stem);
  if (target === undefined) {
    throw new Error(`release tag names an unknown package: ${parsedTag.stem}`);
  }
  if (target.version !== parsedTag.version) {
    throw new Error(
      `release tag must be ${releaseTag(target.name, target.version)}, received ${tag}`,
    );
  }

  return {
    distTag: target.prerelease ? "next" : "latest",
    expectedTag: releaseTag(target.name, target.version),
    packageManager: rootManifest.packageManager,
    packages: published,
    target,
    workspaceVersions,
  };
}
