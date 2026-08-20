import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { InvalidBundlePathError, validateBundlePath } from "okf-core";
import { errorCode } from "./errors.js";

export class BundlePathError extends Error {
  readonly code = "OKF_UNSAFE_PATH";

  constructor(message: string) {
    super(message);
    this.name = "BundlePathError";
  }
}

export function normalizeBundlePath(value: string): string {
  try {
    return validateBundlePath(value);
  } catch (error) {
    if (error instanceof InvalidBundlePathError) {
      throw new BundlePathError(error.message);
    }
    throw error;
  }
}

export function nativePath(root: string, relativePath: string): string {
  const normalized = normalizeBundlePath(relativePath);
  return path.join(root, ...normalized.split("/"));
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export async function assertExistingPathConfined(root: string, relativePath: string): Promise<string> {
  const candidate = nativePath(root, relativePath);
  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink()) {
    throw new BundlePathError(`symbolic links are not allowed in a bundle: ${relativePath}`);
  }
  const canonical = await realpath(candidate);
  if (!isWithinRoot(root, canonical)) {
    throw new BundlePathError(`bundle path escapes its root: ${relativePath}`);
  }
  return canonical;
}

export async function assertWritablePathConfined(root: string, relativePath: string): Promise<string> {
  const candidate = nativePath(root, relativePath);
  let cursor = path.dirname(candidate);
  while (cursor !== root) {
    if (!isWithinRoot(root, cursor)) {
      throw new BundlePathError(`bundle path escapes its root: ${relativePath}`);
    }
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) {
        throw new BundlePathError(`symbolic links are not allowed in a bundle path: ${relativePath}`);
      }
      const canonical = await realpath(cursor);
      if (!isWithinRoot(root, canonical)) {
        throw new BundlePathError(`bundle path escapes its root: ${relativePath}`);
      }
      break;
    } catch (error) {
      if (error instanceof BundlePathError) {
        throw error;
      }
      if (errorCode(error) !== "ENOENT") {
        throw error;
      }
      cursor = path.dirname(cursor);
    }
  }
  return candidate;
}
