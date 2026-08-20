const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:\//;

export class InvalidBundlePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBundlePathError";
  }
}

export type PathResolution =
  | { readonly kind: "fragment"; readonly fragment: string }
  | { readonly kind: "external" }
  | { readonly kind: "escape" }
  | { readonly kind: "invalid" }
  | { readonly kind: "internal"; readonly path: string; readonly fragment: string | null };

/** Code-point ordering is stable across runtimes and locales. */
export function byCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Validate one confined Bundle-relative path and return its exact authored bytes.
 *
 * Unicode and whitespace are storage-key data, so this function never trims or
 * normalizes them. Storage adapters decide separately whether a particular
 * operation requires a `.md` suffix.
 */
export function validateBundlePath(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidBundlePathError("bundle path must not be empty");
  }
  if (value.includes("\0") || value.includes("\\")) {
    throw new InvalidBundlePathError(`unsafe bundle path: ${value}`);
  }
  if (value.startsWith("/") || WINDOWS_ABSOLUTE.test(value)) {
    throw new InvalidBundlePathError(`bundle path must be relative: ${value}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new InvalidBundlePathError(`unsafe bundle path: ${value}`);
  }
  return value;
}

/** Alias that emphasizes that the validated storage key is the canonical value. */
export function canonicalizeBundlePath(value: string): string {
  return validateBundlePath(value);
}

/** Validate a change target, preserving its exact key and requiring the OKF suffix. */
export function canonicalizeOperationPath(value: string): string {
  const path = validateBundlePath(value);
  if (!path.endsWith(".md")) {
    throw new InvalidBundlePathError(`OKF operation path must end in .md: ${path}`);
  }
  return path;
}

export function isSafeMarkdownPath(path: string): boolean {
  try {
    return canonicalizeOperationPath(path) === path;
  } catch {
    return false;
  }
}

/** Resolve an authored Markdown destination without ever addressing outside one bundle. */
export function resolveWithinBundle(source: string, href: string): PathResolution {
  let value = href.trim();
  if (!value) {
    return { kind: "invalid" };
  }
  try {
    value = decodeURIComponent(value);
  } catch {
    return { kind: "invalid" };
  }
  if (value.startsWith("#")) {
    return { kind: "fragment", fragment: value.slice(1) };
  }
  if (SCHEME.test(value) || value.startsWith("//")) {
    return { kind: "external" };
  }

  const hash = value.indexOf("#");
  const query = value.indexOf("?");
  const end = [hash, query].filter((index) => index >= 0).reduce((a, b) => Math.min(a, b), value.length);
  const clean = value.slice(0, end);
  const fragment = hash >= 0 ? value.slice(hash + 1) : null;
  if (!clean) {
    return fragment === null ? { kind: "invalid" } : { kind: "fragment", fragment };
  }

  const base = clean.startsWith("/") ? [] : source.split("/").slice(0, -1);
  const resolved: string[] = [];
  for (const segment of [...base, ...clean.replace(/^\/+/, "").split("/")]) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolved.length === 0) {
        return { kind: "escape" };
      }
      resolved.pop();
      continue;
    }
    if (segment.includes("\\")) {
      return { kind: "invalid" };
    }
    resolved.push(segment);
  }
  const path = resolved.join("/");
  return path ? { kind: "internal", path, fragment } : { kind: "invalid" };
}
