import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { byCodePoint } from "okf-core";
import { errorCode } from "./errors.js";
import { contentRevision, FilesystemBundle } from "./filesystem.js";
import { isWithinRoot } from "./path.js";

export const OKF_MANIFEST_PATH = ".agents/okf.yaml";

export interface OkfManifestBundle {
  root: string;
  index?: string;
  audience?: string;
  access?: string;
}

export interface OkfManifest {
  schema_version: number;
  adapter?: string;
  instructions?: {
    common?: string[];
    bundles?: Record<string, string[]>;
  };
  bundles: Record<string, OkfManifestBundle>;
}

export interface ResolvedBundleTarget {
  bundle: FilesystemBundle;
  name: string | null;
  manifestPath: string | null;
  projectRoot: string;
  manifest: OkfManifest | null;
}

export interface ContextDocument {
  path: string;
  content: string;
  revision: string;
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    throw new Error(`${field} must be a list of paths`);
  }
  return value;
}

async function confinedProjectPath(projectRoot: string, configuredPath: string, label: string): Promise<string> {
  if (path.isAbsolute(configuredPath) || path.win32.isAbsolute(configuredPath) || configuredPath.includes("\\")) {
    throw new Error(`${label} must be a project-relative path`);
  }
  const parts = configuredPath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} contains an unsafe path segment`);
  }
  let cursor = projectRoot;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const metadata = await lstat(cursor);
    if (metadata.isSymbolicLink()) {
      throw new Error(`${label} must not contain a symbolic link`);
    }
  }
  const canonical = await realpath(cursor);
  if (!isWithinRoot(projectRoot, canonical)) {
    throw new Error(`${label} escapes the project`);
  }
  return canonical;
}

export async function discoverOkfManifest(start: string): Promise<string | null> {
  const metadata = await stat(start);
  let cursor = metadata.isDirectory() ? await realpath(start) : path.dirname(await realpath(start));
  while (true) {
    const candidate = path.join(cursor, OKF_MANIFEST_PATH);
    if (await exists(candidate)) {
      const candidateMetadata = await lstat(candidate);
      if (candidateMetadata.isSymbolicLink() || !candidateMetadata.isFile()) {
        throw new Error(`${OKF_MANIFEST_PATH} must be a regular file`);
      }
      return candidate;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return null;
    }
    cursor = parent;
  }
}

export async function loadOkfManifest(manifestPath: string): Promise<OkfManifest> {
  if (path.basename(manifestPath) !== "okf.yaml" || path.basename(path.dirname(manifestPath)) !== ".agents") {
    throw new Error(`manifest must use the singular ${OKF_MANIFEST_PATH} path`);
  }
  const value: unknown = parse(await readFile(manifestPath, "utf8"));
  if (!mapping(value)) {
    throw new Error("OKF manifest must be a YAML mapping");
  }
  if (value.schema_version !== 1) {
    throw new Error("OKF manifest schema_version must be 1");
  }
  if (!mapping(value.bundles)) {
    throw new Error("OKF manifest bundles must be a mapping");
  }

  const bundles: Record<string, OkfManifestBundle> = {};
  for (const [name, bundleValue] of Object.entries(value.bundles).sort(([a], [b]) => byCodePoint(a, b))) {
    if (!mapping(bundleValue)) {
      throw new Error(`bundle ${name} must be a mapping`);
    }
    if (typeof bundleValue.root !== "string" || bundleValue.root.trim() === "") {
      throw new Error(`bundle ${name}.root must be a non-empty path`);
    }
    bundles[name] = {
      root: bundleValue.root,
      ...(typeof bundleValue.index === "string" ? { index: bundleValue.index } : {}),
      ...(typeof bundleValue.audience === "string" ? { audience: bundleValue.audience } : {}),
      ...(typeof bundleValue.access === "string" ? { access: bundleValue.access } : {}),
    };
  }
  if (Object.keys(bundles).length === 0) {
    throw new Error("OKF manifest must declare at least one bundle");
  }

  let instructions: OkfManifest["instructions"];
  if (value.instructions !== undefined) {
    if (!mapping(value.instructions)) {
      throw new Error("instructions must be a mapping");
    }
    const raw = value.instructions;
    const bundleInstructions: Record<string, string[]> = {};
    if (raw.bundles !== undefined) {
      if (!mapping(raw.bundles)) {
        throw new Error("instructions.bundles must be a mapping");
      }
      for (const [name, paths] of Object.entries(raw.bundles)) {
        bundleInstructions[name] = asStringArray(paths, `instructions.bundles.${name}`) ?? [];
      }
    }
    instructions = {
      common: asStringArray(raw.common, "instructions.common"),
      bundles: bundleInstructions,
    };
  }

  return {
    schema_version: 1,
    ...(typeof value.adapter === "string" ? { adapter: value.adapter } : {}),
    ...(instructions === undefined ? {} : { instructions }),
    bundles,
  };
}

function selectBundleName(manifest: OkfManifest, requested: string | undefined): string {
  const names = Object.keys(manifest.bundles).sort(byCodePoint);
  if (requested !== undefined) {
    if (!(requested in manifest.bundles)) {
      throw new Error(`unknown OKF bundle ${requested}; available bundles: ${names.join(", ")}`);
    }
    return requested;
  }
  if (names.length !== 1) {
    throw new Error(`manifest declares multiple bundles; select exactly one with --bundle (${names.join(", ")})`);
  }
  return names[0]!;
}

export async function resolveBundleTarget(target: string, requestedBundle?: string): Promise<ResolvedBundleTarget> {
  const absoluteTarget = path.resolve(target);
  const manifestPath = await discoverOkfManifest(absoluteTarget);
  if (manifestPath === null) {
    if (requestedBundle !== undefined) {
      throw new Error(`no ${OKF_MANIFEST_PATH} found from ${target}`);
    }
    const bundle = await FilesystemBundle.open(absoluteTarget);
    return { bundle, name: null, manifestPath: null, projectRoot: bundle.root, manifest: null };
  }

  const manifest = await loadOkfManifest(manifestPath);
  const projectRoot = await realpath(path.dirname(path.dirname(manifestPath)));
  const canonicalTarget = await realpath(absoluteTarget);
  const resolvedRoots = new Map<string, string>();
  for (const name of Object.keys(manifest.bundles)) {
    const configuredRoot = manifest.bundles[name]!.root;
    resolvedRoots.set(name, await confinedProjectPath(projectRoot, configuredRoot, `bundle ${name}.root`));
  }
  const exactNames = [...resolvedRoots]
    .filter(([, configuredRoot]) => configuredRoot === canonicalTarget)
    .map(([name]) => name);

  let name: string;
  if (requestedBundle !== undefined) {
    name = selectBundleName(manifest, requestedBundle);
    if (exactNames.length > 0 && !exactNames.includes(name)) {
      throw new Error(`target belongs to bundle ${exactNames.join(", ")}; requested bundle ${name} uses a different root`);
    }
  } else if (exactNames.length === 1) {
    name = exactNames[0]!;
  } else if (exactNames.length > 1) {
    throw new Error(`multiple manifest bundles own the target; select exactly one with --bundle (${exactNames.join(", ")})`);
  } else if (canonicalTarget === projectRoot) {
    name = selectBundleName(manifest, undefined);
  } else if (await exists(path.join(canonicalTarget, "index.md"))) {
    const bundle = await FilesystemBundle.open(canonicalTarget);
    return { bundle, name: null, manifestPath: null, projectRoot: bundle.root, manifest: null };
  } else {
    name = selectBundleName(manifest, undefined);
  }

  const configuredRoot = manifest.bundles[name]!.root;
  const bundleRoot = resolvedRoots.get(name)
    ?? await confinedProjectPath(projectRoot, configuredRoot, `bundle ${name}.root`);
  const bundle = await FilesystemBundle.open(bundleRoot);
  return { bundle, name, manifestPath, projectRoot, manifest };
}

export async function readBundleContext(target: ResolvedBundleTarget): Promise<ContextDocument[]> {
  if (target.manifest === null || target.name === null) {
    return [];
  }
  const configured = [
    ...(target.manifest.instructions?.common ?? []),
    ...(target.manifest.instructions?.bundles?.[target.name] ?? []),
  ];
  const unique = [...new Set(configured)];
  const documents: ContextDocument[] = [];
  for (const configuredPath of unique) {
    const candidate = await confinedProjectPath(target.projectRoot, configuredPath, `instruction path ${configuredPath}`);
    const metadata = await lstat(candidate);
    if (!metadata.isFile()) {
      throw new Error(`instruction path must be a regular file: ${configuredPath}`);
    }
    const bytes = await readFile(candidate);
    documents.push({
      path: configuredPath.split(path.sep).join("/"),
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      revision: contentRevision(bytes),
    });
  }
  return documents;
}
