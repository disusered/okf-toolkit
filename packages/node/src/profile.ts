import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ValidationProfile } from "okf-core";

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationProfile(value: unknown): value is ValidationProfile {
  return mapping(value) && typeof value.id === "string" && typeof value.validate === "function";
}

/**
 * Import a consumer's executable validation profile. The base directory is a parameter rather
 * than `process.cwd()` because a harness starts a server from an unpredictable directory: a CLI
 * passes the invocation directory, a server passes the resolved bundle's project root.
 *
 * Importing the module executes it, so only pass a specifier the deployment already trusts.
 */
export async function loadValidationProfile(
  baseDirectory: string,
  moduleSpecifier: string,
): Promise<ValidationProfile> {
  const specifier = moduleSpecifier.startsWith("file:")
    ? moduleSpecifier
    : pathToFileURL(path.resolve(baseDirectory, moduleSpecifier)).href;
  const loaded: unknown = await import(specifier);
  const candidate = mapping(loaded) ? loaded.profile : undefined;
  if (!validationProfile(candidate)) {
    throw new Error("profile module must export `profile` with string id and validate(context) function");
  }
  return candidate;
}
