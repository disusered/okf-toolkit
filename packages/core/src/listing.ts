import { byCodePoint, InvalidBundlePathError, validateBundlePath } from "./paths.js";

export type BundleListingEntryType = "directory" | "markdown";

export interface BundleListingEntry {
  readonly path: string;
  readonly type: BundleListingEntryType;
}

/**
 * Fold a bundle's document paths into the entries one `list` call returns.
 *
 * Every adapter answers `list` from the paths it already knows, so the depth and prefix
 * policy lives here rather than in each adapter: R2 and the filesystem must not disagree
 * about what `depth: 2` means. `requested` is `.` for the bundle root, otherwise a confined
 * bundle-relative directory path.
 */
export function listBundleEntries(
  documentPaths: readonly string[],
  requested: string,
  depth: number,
): BundleListingEntry[] {
  let confined = "";
  if (requested !== ".") {
    try {
      confined = validateBundlePath(requested);
    } catch {
      throw new InvalidBundlePathError(`list path is not confined: ${requested}`);
    }
  }
  const prefix = confined ? `${confined}/` : "";
  const entries = new Map<string, BundleListingEntryType>();
  for (const documentPath of documentPaths) {
    if (!documentPath.startsWith(prefix)) continue;
    const relative = documentPath.slice(prefix.length);
    const parts = relative.split("/");
    if (parts.length - 1 <= depth) entries.set(documentPath, "markdown");
    const directories = parts.slice(0, -1);
    for (let index = 0; index < Math.min(directories.length, depth); index += 1) {
      entries.set(`${prefix}${directories.slice(0, index + 1).join("/")}`, "directory");
    }
  }
  return [...entries]
    .map(([path, type]) => ({ path, type }))
    .sort((left, right) => byCodePoint(left.path, right.path));
}
